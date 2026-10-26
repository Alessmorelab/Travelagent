from __future__ import annotations

import hashlib
import secrets
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import delete, insert, select, update

from backend.app.core.database import create_database
from backend.app.core.errors import ChatError
from backend.app.models.chat import conversations, devices, metadata, turns, turn_steps


class ChatRepository:
    """PostgreSQL for deployment, SQLite for local development; installation identity."""

    def __init__(self, location: str | Path | None = None):
        self.engine = create_database(location)
        metadata.create_all(self.engine)

    def close(self):
        self.engine.dispose()

    @contextmanager
    def transaction(self, owner: str | None = None):
        with self.engine.connect() as db:
            try:
                # Serialize writes per installation in PostgreSQL, across local writers in SQLite.
                # The lock also covers retries without a conversation ID after a lost accepted frame.
                if self.engine.dialect.name == 'sqlite' and owner:
                    db.exec_driver_sql('BEGIN IMMEDIATE')
                else:
                    db.begin()
                    if owner:
                        db.execute(select(devices.c.token_hash).where(devices.c.token_hash == owner).with_for_update())
                yield db
                db.commit()
            except BaseException:
                db.rollback()
                raise

    @staticmethod
    def digest(token: str):
        return hashlib.sha256(token.encode()).hexdigest()

    def create_device(self):
        token = secrets.token_urlsafe(32)
        with self.transaction() as db:
            db.execute(insert(devices).values(token_hash=self.digest(token), created=time.time()))
        return token

    def authenticate(self, token: str):
        if not token or len(token) > 200:
            raise ChatError('设备凭证无效，请重新连接服务', 401)
        owner = self.digest(token)
        with self.engine.connect() as db:
            row = db.execute(select(devices.c.token_hash).where(devices.c.token_hash == owner)).first()
        if not row:
            raise ChatError('设备凭证无效，请重新连接服务', 401)
        return owner

    @staticmethod
    def owned(db, owner: str, conversation_id: str):
        row = db.execute(select(conversations).where(conversations.c.id == conversation_id, conversations.c.owner == owner)).mappings().first()
        if not row:
            raise ChatError('对话不存在或当前设备无权访问', 404)
        return row

    def begin(self, owner: str, agent: str, conversation_id: str | None,
              request_id: str, query: str, model_query: str):
        now = time.time()
        with self.transaction(owner) as db:
            previous = db.execute(select(conversations.c.id, conversations.c.agent).join(turns).where(
                conversations.c.owner == owner, turns.c.request_id == request_id)).mappings().first()
            if previous:
                if previous['agent'] != agent or (conversation_id and previous['id'] != conversation_id):
                    raise ChatError('请求编号已用于另一份对话', 409)
                conversation_id = previous['id']
            if conversation_id:
                conversation = self.owned(db, owner, conversation_id)
                if conversation['agent'] != agent:
                    raise ChatError('这份对话属于另一个旅行助手', 409)
            else:
                conversation_id = str(uuid.uuid4())
                db.execute(insert(conversations).values(id=conversation_id, owner=owner, agent=agent,
                           title=query[:40], created=now, updated=now))
            existing = db.execute(select(turns).where(turns.c.conversation_id == conversation_id,
                                  turns.c.request_id == request_id)).mappings().first()
            if existing and (existing['query'] != query or existing['model_query'] != model_query):
                raise ChatError('重试内容与原请求不一致，请开启新消息', 409)
            if existing and existing['status'] == 'complete':
                return dict(existing), True
            pending = db.execute(select(turns).where(turns.c.conversation_id == conversation_id,
                                 turns.c.status == 'pending')).mappings().first()
            if pending and now - pending['updated'] < 300:
                raise ChatError('这份对话还有请求正在执行，请稍后再试', 409)
            if pending:
                db.execute(update(turns).where(turns.c.id == pending['id']).values(status='interrupted', updated=now))
                db.execute(update(turn_steps).where(turn_steps.c.turn_id == pending['id'], turn_steps.c.state == 'running').values(state='interrupted'))
            if existing:
                turn_id = existing['id']
                db.execute(delete(turn_steps).where(turn_steps.c.turn_id == turn_id))
                db.execute(update(turns).where(turns.c.id == turn_id).values(status='pending', response='', updated=now))
            else:
                turn_id = str(uuid.uuid4())
                db.execute(insert(turns).values(id=turn_id, conversation_id=conversation_id, request_id=request_id,
                           query=query, model_query=model_query, response='', status='pending', created=now, updated=now))
            db.execute(update(conversations).where(conversations.c.id == conversation_id).values(updated=now))
            return dict(db.execute(select(turns).where(turns.c.id == turn_id)).mappings().one()), False

    def finish(self, turn_id: str, response: str, status: str):
        with self.transaction() as db:
            now = time.time()
            result = db.execute(update(turns).where(turns.c.id == turn_id, turns.c.status == 'pending').values(
                                response=response, status=status, updated=now))
            if result.rowcount:
                db.execute(update(turn_steps).where(turn_steps.c.turn_id == turn_id, turn_steps.c.state == 'running').values(
                    state='complete' if status == 'complete' else 'interrupted'))
                db.execute(update(conversations).where(conversations.c.id == select(turns.c.conversation_id).where(
                           turns.c.id == turn_id).scalar_subquery()).values(updated=now))

    def record_step(self, turn_id: str, event: dict):
        if (not isinstance(event.get('key'), str) or not isinstance(event.get('label'), str)
                or event.get('state') not in {'running', 'complete', 'interrupted'}):
            return None
        step = {'key': event['key'][:128], 'label': event['label'][:120], 'state': event['state'],
                'kind': 'tool' if event.get('kind') == 'tool' else 'task'}
        with self.transaction() as db:
            if db.scalar(select(turns.c.status).where(turns.c.id == turn_id)) != 'pending':
                return None
            condition = (turn_steps.c.turn_id == turn_id, turn_steps.c.key == step['key'])
            if db.execute(select(turn_steps.c.key).where(*condition)).first():
                db.execute(update(turn_steps).where(*condition).values(**step))
            else:
                db.execute(insert(turn_steps).values(turn_id=turn_id, created=time.time(), **step))
        return step

    def progress(self, turn_id: str):
        with self.engine.connect() as db:
            return [dict(row) for row in db.execute(select(turn_steps.c.key, turn_steps.c.label, turn_steps.c.kind,
                    turn_steps.c.state).where(turn_steps.c.turn_id == turn_id).order_by(turn_steps.c.created)).mappings()]

    def context(self, conversation_id: str, turn_id: str):
        with self.engine.connect() as db:
            rows = db.execute(select(turns).where(turns.c.conversation_id == conversation_id,
                              turns.c.status == 'complete', turns.c.id != turn_id).order_by(turns.c.created.desc()).limit(20)).mappings().all()
        messages = []
        for row in reversed(rows):
            messages += [{'role': 'user', 'content': row['model_query']}, {'role': 'assistant', 'content': row['response']}]
        return messages

    def list(self, owner: str, agent: str | None = None):
        statement = select(conversations).where(conversations.c.owner == owner)
        if agent:
            statement = statement.where(conversations.c.agent == agent)
        with self.engine.connect() as db:
            rows = db.execute(statement.order_by(conversations.c.updated.desc()).limit(100)).mappings().all()
        return [{key: value for key, value in row.items() if key != 'owner'} for row in rows]

    def detail(self, owner: str, conversation_id: str):
        with self.engine.connect() as db:
            conversation = dict(self.owned(db, owner, conversation_id))
            records = db.execute(select(turns).where(turns.c.conversation_id == conversation_id).order_by(turns.c.created)).mappings().all()
            steps = db.execute(select(turn_steps).where(turn_steps.c.turn_id.in_([row['id'] for row in records]))
                               .order_by(turn_steps.c.created)).mappings().all() if records else []
        conversation.pop('owner')
        progress = {}
        for step in steps:
            progress.setdefault(step['turn_id'], []).append({key: step[key] for key in ('key', 'label', 'kind', 'state')})
        messages = []
        for turn in records:
            messages.append({'id': turn['id'] + '-user', 'role': 'user', 'content': turn['query'], 'agent': conversation['agent'], 'mode': 'live'})
            if turn['response'] or progress.get(turn['id']):
                messages.append({'id': turn['id'] + '-assistant', 'role': 'assistant', 'content': turn['response'],
                                 'agent': conversation['agent'], 'mode': 'live',
                                 'progress': progress.get(turn['id'], []),
                                 'status': 'complete' if turn['status'] == 'complete' else 'interrupted'})
        return conversation | {'messages': messages}

    def delete(self, owner: str, conversation_id: str):
        with self.transaction(owner) as db:
            self.owned(db, owner, conversation_id)
            if db.execute(select(turns.c.id).where(turns.c.conversation_id == conversation_id,
                          turns.c.status == 'pending', turns.c.updated > time.time() - 300)).first():
                raise ChatError('请先停止当前对话的请求，再删除记录', 409)
            db.execute(delete(conversations).where(conversations.c.id == conversation_id))
