import os
import sqlite3
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from pathlib import Path
from urllib.parse import quote

import pytest

from backend.app.core.errors import ChatError
from backend.app.repositories.chat import ChatRepository
from backend.app.schemas.chat import StartMessage
from backend.app.services.chat import ChatService


def test_existing_sqlite_conversations_survive_repository_change(tmp_path):
    filename = tmp_path / 'legacy.sqlite3'
    # This is the schema used before the SQLAlchemy/PostgreSQL repository was introduced.
    with sqlite3.connect(filename) as db:
        db.executescript("""
            CREATE TABLE devices (token_hash TEXT PRIMARY KEY, created REAL NOT NULL);
            CREATE TABLE conversations (id TEXT PRIMARY KEY, owner TEXT NOT NULL, agent TEXT NOT NULL,
                title TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL);
            CREATE TABLE turns (id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
                request_id TEXT NOT NULL, query TEXT NOT NULL, model_query TEXT NOT NULL, response TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL, created REAL NOT NULL, updated REAL NOT NULL, UNIQUE(conversation_id, request_id));
        """)
        owner = ChatRepository.digest('existing-install-token')
        db.execute('INSERT INTO devices VALUES (?, 1)', (owner,))
        db.execute("INSERT INTO conversations VALUES ('conversation', ?, 'team', '旧对话', 1, 1)", (owner,))
        db.execute("INSERT INTO turns VALUES ('turn', 'conversation', 'request', '旧问题', '旧问题', '旧回复', 'complete', 1, 1)")
    repo = ChatRepository(filename)
    try:
        assert repo.authenticate('existing-install-token') == owner
        assert repo.detail(owner, 'conversation')['messages'][-1]['content'] == '旧回复'
        turn, replay = repo.begin(owner, 'team', None, 'request', '旧问题', '旧问题')
        assert replay and turn['response'] == '旧回复'
    finally:
        repo.close()


def check_concurrent_request_and_ownership(repo):
    owner = repo.authenticate(repo.create_device())
    barrier = Barrier(2)
    def begin():
        barrier.wait(timeout=5)
        try:
            return repo.begin(owner, 'team', None, 'request', '京都', '京都')[0]
        except ChatError as error:
            return error.code
    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: begin(), range(2)))
    turn = next(result for result in results if isinstance(result, dict))
    assert 409 in results
    assert len(repo.list(owner)) == 1
    repo.finish(turn['id'], '完整结果', 'complete')
    # Late disconnect cleanup may not overwrite an already committed answer.
    repo.finish(turn['id'], '部分结果', 'interrupted')
    assert repo.begin(owner, 'team', None, 'request', '京都', '京都')[1]
    other = repo.authenticate(repo.create_device())
    with pytest.raises(ChatError, match='无权访问'):
        repo.detail(other, turn['conversation_id'])
    assert repo.detail(owner, turn['conversation_id'])['messages'][-1]['content'] == '完整结果'
    return owner, turn


def test_concurrent_retries_create_one_conversation(tmp_path):
    repo = ChatRepository(tmp_path / 'concurrent.sqlite3')
    try:
        check_concurrent_request_and_ownership(repo)
    finally:
        repo.close()


@pytest.mark.asyncio
async def test_service_closure_retains_partial_and_replay_keeps_completed_answer(tmp_path):
    closed = []
    async def runner(*_):
        try:
            yield {'type': 'delta', 'content': '部分结果'}
            yield {'type': 'final', 'content': '完整结果'}
        finally:
            closed.append(True)
    repo = ChatRepository(tmp_path / 'service.sqlite3')
    service = ChatService(repo, runner)
    token = repo.create_device()
    owner = repo.authenticate(token)
    request = StartMessage(type='start', token=token, request_id='retry', query='京都')
    try:
        stream = service.stream(request)
        accepted = await anext(stream)
        assert (await anext(stream))['content'] == '部分结果'
        await stream.aclose()
        assert closed
        assert repo.detail(owner, accepted['conversation_id'])['messages'][-1]['status'] == 'interrupted'
        events = [event async for event in service.stream(request)]
        assert events[-1]['type'] == 'done'
        replay = service.stream(request)
        await anext(replay)
        await replay.aclose()
        detail = repo.detail(owner, accepted['conversation_id'])
        assert len(detail['messages']) == 2
        assert detail['messages'][-1]['content'] == '完整结果'
        assert detail['messages'][-1]['status'] == 'complete'
    finally:
        repo.close()


def test_postgresql_round_trip_concurrency_restart_and_delete():
    # pgserver supplies the official PostgreSQL binaries. Start only our own disposable
    # instance directly, without its wrapper enumerating all processes on the host.
    pytest.importorskip('pgserver')
    if os.name == 'nt' or os.geteuid() == 0:
        pytest.skip('This isolated Unix-socket fixture requires a non-root POSIX user')
    from pgserver._commands import POSTGRES_BIN_PATH as binaries
    with tempfile.TemporaryDirectory(prefix='roam-pg-', dir='/tmp') as directory:
        area = Path(directory)
        data = area / 'data'
        initialized = subprocess.run([str(binaries / 'initdb'), '-D', str(data), '-U', 'postgres',
                                     '--auth=trust', '--encoding=UTF8', '--locale=C', '--no-sync'],
                                    capture_output=True, text=True, timeout=20)
        if initialized.returncode and 'could not create shared memory segment: Operation not permitted' in initialized.stderr:
            pytest.skip('Host sandbox blocks PostgreSQL shared-memory creation')
        initialized.check_returncode()
        started = False
        try:
            subprocess.run([str(binaries / 'pg_ctl'), '-D', str(data), '-l', str(area / 'postgres.log'),
                            '-w', '-t', '10', '-o', f'-h "" -k {area}', 'start'],
                           check=True, capture_output=True, text=True, timeout=15)
            started = True
            location = 'postgresql+psycopg://postgres@/postgres?host=' + quote(str(area), safe='')
            repo = ChatRepository(location)
            try:
                owner, turn = check_concurrent_request_and_ownership(repo)
            finally:
                repo.close()
            reopened = ChatRepository(location)
            try:
                assert reopened.detail(owner, turn['conversation_id'])['messages'][-1]['content'] == '完整结果'
                reopened.delete(owner, turn['conversation_id'])
                assert reopened.list(owner) == []
                with reopened.engine.connect() as db:
                    from sqlalchemy import select
                    from backend.app.models.chat import turns
                    assert db.execute(select(turns.c.id)).all() == []
            finally:
                reopened.close()
        finally:
            if started:
                subprocess.run([str(binaries / 'pg_ctl'), '-D', str(data), '-m', 'immediate', '-w', 'stop'],
                               check=True, capture_output=True, text=True, timeout=15)
