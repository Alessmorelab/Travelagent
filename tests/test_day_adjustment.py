import asyncio
import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.api import trips
from backend.app.main import app
from backend.app.services import day_adjustment
from backend.app.services.chat import get_chat_service


REQUEST = {
    'destination': '武汉', 'day': 2, 'date': '2026-11-07', 'instruction': '把下午的户外活动改成室内，保持上午预约。',
    'activities': [
        {'title': '博物馆', 'time': '09:00', 'detail': '已预约', 'protected': True},
        {'title': '公园', 'time': '14:00', 'detail': '沿湖散步', 'protected': False},
        {'title': '晚餐', 'time': '18:00', 'detail': '', 'protected': False},
    ],
    'targets': [1],
}
CHANGE = {'index': 1, 'title': '科技馆', 'time': '14:00', 'detail': '室内展览，预约情况待确认'}


@pytest.fixture
def adjustment_api(tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_URL', '')
    monkeypatch.setenv('TRAVEL_CHAT_DB', str(tmp_path / 'adjustments.db'))
    get_chat_service.cache_clear()
    calls = []
    output = {'changes': [CHANGE]}

    class Model:
        def with_structured_output(self, *_args, **_kwargs):
            return self

        async def ainvoke(self, messages):
            calls.append(json.loads(messages[-1].content))
            if isinstance(output.get('error'), Exception):
                raise output['error']
            return output

    monkeypatch.setattr(day_adjustment, 'model_for', lambda _: Model())
    with TestClient(app) as client:
        token = client.post('/api/v1/chat/devices').json()['token']
        yield client, {'Authorization': f'Bearer {token}'}, calls, output


def test_adjustment_passes_only_selected_day_and_does_not_create_chat(adjustment_api):
    client, headers, calls, _ = adjustment_api
    url = '/api/v1/trips/adjust-day'
    assert client.post(url, json=REQUEST).status_code == 401
    response = client.post(url, headers=headers, json=REQUEST)
    assert response.status_code == 200
    assert response.json() == {'changes': [CHANGE]}
    assert calls == [REQUEST]
    assert client.get('/api/v1/chat/conversations', headers=headers).json() == {'conversations': []}


@pytest.mark.parametrize('targets', [[0], [1, 1], [True], [10]])
def test_protected_or_invalid_targets_never_reach_model(adjustment_api, targets):
    client, headers, calls, _ = adjustment_api
    result = client.post('/api/v1/trips/adjust-day', headers=headers, json={**REQUEST, 'targets': targets})
    assert result.status_code == 422
    assert not calls


@pytest.mark.parametrize('changes', [
    [{**CHANGE, 'index': 0}], [{**CHANGE, 'index': 2}], [CHANGE, CHANGE],
    [{**CHANGE, 'title': '科技馆 + 美术馆'}], [{**CHANGE, 'latitude': 30.5}],
])
def test_model_output_cannot_change_protected_or_unselected_activities(adjustment_api, changes):
    client, headers, _, output = adjustment_api
    output['changes'] = changes
    result = client.post('/api/v1/trips/adjust-day', headers=headers, json=REQUEST)
    assert result.status_code == 502
    assert 'changes' not in result.json()


def test_provider_failure_removes_private_details_and_releases_generation_slot(adjustment_api):
    client, headers, _, output = adjustment_api
    output['error'] = TimeoutError('private provider URL and credentials')
    result = client.post('/api/v1/trips/adjust-day', headers=headers, json=REQUEST)
    assert result.status_code == 504
    assert 'private' not in result.text
    del output['error']
    assert client.post('/api/v1/trips/adjust-day', headers=headers, json=REQUEST).status_code == 200


@pytest.mark.asyncio
@pytest.mark.parametrize('interruption', ['disconnect', 'cancel_handler'])
async def test_interrupted_adjustment_cancels_model_and_allows_retry(monkeypatch, interruption):
    started, stopped = asyncio.Event(), asyncio.Event()
    calls = 0
    owner = 'fixture-cancel-owner'

    async def authenticated(_authorization):
        return owner

    class Model:
        def with_structured_output(self, *_args, **_kwargs):
            return self

        async def ainvoke(self, _messages):
            nonlocal calls
            calls += 1
            if calls == 1:
                started.set()
                try:
                    await asyncio.Future()
                finally:
                    stopped.set()
            return {'changes': [CHANGE]}

    monkeypatch.setattr(trips, 'authenticated', authenticated)
    monkeypatch.setattr(day_adjustment, 'model_for', lambda _: Model())
    test_app = FastAPI()
    test_app.include_router(trips.router, prefix='/api/v1/trips')
    incoming = asyncio.Queue()
    await incoming.put({'type': 'http.request', 'body': json.dumps(REQUEST).encode(), 'more_body': False})
    responses = []

    async def send(message):
        responses.append(message)

    path = '/api/v1/trips/adjust-day'
    scope = {
        'type': 'http', 'asgi': {'version': '3.0'}, 'http_version': '1.1', 'method': 'POST',
        'path': path, 'raw_path': path.encode(), 'root_path': '', 'query_string': b'',
        'headers': [(b'content-type', b'application/json')], 'scheme': 'http',
        'server': ('testserver', 80), 'client': ('127.0.0.1', 12345),
    }
    handler = asyncio.create_task(test_app(scope, incoming.get, send))
    try:
        await asyncio.wait_for(started.wait(), timeout=2)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=test_app), base_url='http://testserver') as client:
            busy = await client.post(path, json=REQUEST)
            assert busy.status_code == 429
            if interruption == 'disconnect':
                await incoming.put({'type': 'http.disconnect'})
                await asyncio.wait_for(handler, timeout=2)
                assert responses[0]['status'] == 499
            else:
                handler.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await handler
            assert stopped.is_set()
            assert owner not in trips._active_owners
            retry = await client.post(path, json=REQUEST)
            assert retry.status_code == 200
            assert retry.json() == {'changes': [CHANGE]}
            assert calls == 2
            assert owner not in trips._active_owners
            assert not any(task.get_coro().__name__ == '_wait_for_disconnect' for task in asyncio.all_tasks())
    finally:
        handler.cancel()
        await asyncio.gather(handler, return_exceptions=True)
