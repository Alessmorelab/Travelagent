import asyncio

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api.chat import create_chat_router
from backend.app.repositories.chat import ChatRepository
from backend.app.services.chat import ChatService


def setup_client(filename, runner):
    app = FastAPI()
    app.include_router(create_chat_router(ChatService(ChatRepository(filename), runner)), prefix='/api/v1/chat')
    return TestClient(app)


def device(client):
    token = client.post('/api/v1/chat/devices').json()['token']
    return token, {'Authorization': 'Bearer ' + token}


def start(token, request_id='request-1', conversation_id=None, query='规划京都旅行'):
    return dict(type='start', token=token, request_id=request_id, conversation_id=conversation_id,
                agent='team', query=query, preferences='武汉出发，2人同行')


def collect(client, payload):
    with client.websocket_connect('/api/v1/chat/ws') as socket:
        socket.send_json(payload)
        events = []
        while True:
            event = socket.receive_json()
            events.append(event)
            if event['type'] in {'done', 'error', 'cancelled'}:
                return events


def test_stream_history_restart_and_device_isolation(tmp_path):
    calls = []
    async def runner(agent, history, query):
        calls.append((agent, history, query))
        yield dict(type='status', key='hotel', label='查询住宿', state='running')
        yield dict(type='delta', content='京都')
        yield dict(type='delta', content='旅行建议')
        yield dict(type='final', content='京都旅行建议')

    filename = tmp_path / 'chat.db'
    with setup_client(filename, runner) as client:
        token, headers = device(client)
        events = collect(client, start(token))
        assert [item['type'] for item in events] == ['accepted', 'status', 'delta', 'delta', 'final', 'done']
        cid = events[0]['conversation_id']
        detail = client.get('/api/v1/chat/conversations/' + cid, headers=headers).json()
        assert [item['content'] for item in detail['messages']] == ['规划京都旅行', '京都旅行建议']
        collect(client, start(token, 'request-2', cid, '改成三天'))
        assert len(calls[1][1]) == 2
        assert '武汉出发' in calls[1][1][0]['content']
        _, other = device(client)
        assert client.get('/api/v1/chat/conversations', headers=other).json()['conversations'] == []
        assert client.get('/api/v1/chat/conversations/' + cid, headers=other).status_code == 404
        assert client.delete('/api/v1/chat/conversations/' + cid, headers=other).status_code == 404
        assert client.get('/api/v1/chat/conversations').status_code == 401
    with setup_client(filename, runner) as restarted:
        records = restarted.get('/api/v1/chat/conversations', headers=headers).json()['conversations']
        assert len(records) == 1 and records[0]['id'] == cid
        assert restarted.get('/api/v1/chat/conversations/' + cid, headers=headers).json()['messages'][-1]['content'] == '京都旅行建议'
        assert restarted.delete('/api/v1/chat/conversations/' + cid, headers=headers).json()['deleted']
        assert restarted.get('/api/v1/chat/conversations', headers=headers).json()['conversations'] == []


def test_retry_is_idempotent_even_when_accepted_frame_was_lost(tmp_path):
    calls = []
    async def runner(*args):
        calls.append(1)
        yield dict(type='final', content='已完成的真实结果')
    with setup_client(tmp_path / 'chat.db', runner) as client:
        token, _ = device(client)
        first = collect(client, start(token))
        replay = collect(client, start(token))
        assert first[0]['conversation_id'] == replay[0]['conversation_id']
        assert replay[-2]['content'] == '已完成的真实结果'
        assert len(calls) == 1
        conflict = collect(client, start(token, query='用同一编号偷换问题'))
        assert conflict[-1]['code'] == 409


def test_cancel_saves_partial_answer_and_retry_reuses_user_turn(tmp_path):
    attempts = []
    async def runner(*args):
        attempts.append(1)
        yield dict(type='delta', content='部分回复')
        if len(attempts) == 1:
            await asyncio.sleep(10)
        yield dict(type='final', content='完整回复')
    with setup_client(tmp_path / 'chat.db', runner) as client:
        token, headers = device(client)
        with client.websocket_connect('/api/v1/chat/ws') as socket:
            socket.send_json(start(token))
            cid = socket.receive_json()['conversation_id']
            assert socket.receive_json()['content'] == '部分回复'
            socket.send_json({'type': 'cancel'})
            assert socket.receive_json()['type'] == 'cancelled'
        detail = client.get('/api/v1/chat/conversations/' + cid, headers=headers).json()
        assert detail['messages'][-1]['status'] == 'interrupted'
        assert collect(client, start(token, conversation_id=cid))[-1]['type'] == 'done'
        messages = client.get('/api/v1/chat/conversations/' + cid, headers=headers).json()['messages']
        assert len(messages) == 2 and messages[-1]['content'] == '完整回复'


def test_runner_failure_has_explicit_error_and_never_marks_partial_complete(tmp_path):
    async def runner(*args):
        yield dict(type='delta', content='还没完成')
        raise RuntimeError('private provider config should not be exposed')
    with setup_client(tmp_path / 'chat.db', runner) as client:
        token, headers = device(client)
        events = collect(client, start(token))
        assert events[-1]['type'] == 'error'
        assert 'private provider' not in events[-1]['message']
        detail = client.get('/api/v1/chat/conversations/' + events[0]['conversation_id'], headers=headers).json()
        assert detail['messages'][-1]['status'] == 'interrupted'


def test_parallel_turns_and_unknown_threads_are_rejected(tmp_path):
    from backend.app.core.errors import ChatError
    repo = ChatRepository(tmp_path / 'chat.db')
    owner = repo.authenticate(repo.create_device())
    turn, _ = repo.begin(owner, 'team', None, 'one', '问题', '问题')
    with pytest.raises(ChatError, match='正在执行'):
        repo.begin(owner, 'team', turn['conversation_id'], 'two', '另一个问题', '另一个问题')
    with pytest.raises(ChatError, match='不存在'):
        repo.begin(owner, 'team', 'missing', 'three', '问题', '问题')
