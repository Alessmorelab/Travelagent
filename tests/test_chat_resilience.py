import asyncio
import json

import httpx
import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel
from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableLambda
from langchain_core.tools import tool, ToolException

from backend.app.core.errors import ChatError
from backend.app.core.failures import failure_for
from backend.app.graphs import travel
from backend.app.repositories.chat import ChatRepository
from backend.app.schemas.chat import StartMessage
from backend.app.services.chat import ChatService
from backend.app.services.itinerary import itinerary_from_answer
from backend.app.services.query_tools import bounded_tool
from tests.test_chat_runner import WorkerModel


@pytest.mark.parametrize('error,kind,retryable', [
    (TimeoutError('private-key'), 'timeout', True),
    (httpx.ConnectError('https://example/?ak=private-key'), 'network', True),
    (ToolException('百度地图 IP 校验未通过，请核对服务器出口 IP 与应用白名单'), 'configuration', False),
    (ToolException('百度地图 MCP 请求失败（HTTP 503）'), 'unavailable', True),
    (ToolException('百度地图当日调用配额已用完'), 'rate_limit', False),
    (ValueError('private-key'), 'unavailable', False),
])
def test_errors_have_stable_categories_without_provider_text(error, kind, retryable):
    failure = failure_for(error, 'tool', '查询地点')
    assert (failure.kind, failure.retryable) == (kind, retryable)
    assert 'private-key' not in json.dumps(failure.public())


@pytest.mark.asyncio
async def test_async_read_only_query_retries_network_once_but_not_authentication():
    calls = []
    @tool
    async def lookup(city: str) -> dict:
        """Read-only lookup."""
        calls.append(city)
        if len(calls) == 1:
            raise httpx.ConnectError('private-url')
        return {'name': city}
    result = await bounded_tool(lookup, '地点查询').ainvoke({'city': '武汉'})
    assert result == {'name': '武汉'} and calls == ['武汉', '武汉']

    @tool
    async def forbidden(city: str) -> dict:
        """A query lacking permission."""
        calls.append('auth')
        raise ToolException('鉴权失败 private-key')
    result = await bounded_tool(forbidden, '地点查询').ainvoke({'city': '武汉'})
    assert json.loads(result)['failure']['kind'] == 'configuration'
    assert calls.count('auth') == 1 and 'private-key' not in result


@pytest.mark.asyncio
async def test_partial_failure_keeps_verified_places_and_does_not_ask_model_to_invent_weather(monkeypatch):
    @tool('map_search_places')
    async def places(city: str) -> dict:
        """Find actual places."""
        return {'source': 'fixture provider', 'retrieved_at': 'fixture time', 'data': {'results': [{'name': '黄鹤楼', 'address': '武昌区'}]}}
    @tool('map_weather')
    async def weather(city: str) -> dict:
        """Read weather."""
        raise TimeoutError('secret weather URL')
    worker = WorkerModel(responses=[AIMessage(content='', tool_calls=[
        {'id': 'p', 'name': places.name, 'args': {'city': '武汉'}},
        {'id': 'w', 'name': weather.name, 'args': {'city': '武汉'}},
    ])])
    models = []
    def factory(_):
        models.append(1)
        assert len(models) == 1, 'Do not generate facts for failed queries'
        return worker
    graph = travel.build_graph('destinations', factory, lambda _: [places, weather])
    monkeypatch.setattr(travel, 'graph_for', lambda _: graph)
    events = [event async for event in travel.stream_travel('destinations', [], '武汉景点和天气')]
    answer = next(event['content'] for event in events if event['type'] == 'final')
    assert '黄鹤楼' in answer and '武昌区' in answer and '超时' in answer and 'fixture time' in answer
    assert 'secret' not in str(events)
    warnings = next(event['warnings'] for event in events if event['type'] == 'artifact')
    assert warnings[0]['kind'] == 'timeout'


@pytest.mark.asyncio
async def test_independent_workers_run_concurrently_without_overwriting_evidence():
    entered = set()
    both = asyncio.Event()
    @tool
    async def lookup(worker: str) -> dict:
        """Wait for both independent queries before returning."""
        entered.add(worker)
        if len(entered) == 2:
            both.set()
        await asyncio.wait_for(both.wait(), .5)
        return {'source': worker, 'places': [{'name': worker}]}
    class Planner:
        def with_structured_output(self, *_, **__):
            return RunnableLambda(lambda _: travel.RoutingPlan(workers=['flights', 'hotels']))
    def factory(name):
        if name == 'team':
            return Planner()
        return WorkerModel(responses=[AIMessage(content='', tool_calls=[{'name': 'lookup', 'id': name, 'args': {'worker': name}}]), AIMessage(content='internal')])
    # Inject a final model separately from the routing model.
    team_calls = []
    def models(name):
        if name == 'team':
            team_calls.append(1)
            return Planner() if len(team_calls) == 1 else FakeListChatModel(responses=['已查到两类信息'])
        return factory(name)
    result = await travel.build_graph('team', models, lambda _: [lookup]).ainvoke({'messages': [HumanMessage(content='查询机票与酒店')]})
    assert result['tool_successes'] == 2 and not result['tool_failures']
    assert entered == {'flights', 'hotels'} and len(result['evidence']) == 2


@pytest.mark.asyncio
async def test_query_model_timeout_retains_prior_tool_results(monkeypatch):
    @tool
    async def lookup(city: str) -> dict:
        """Find a place."""
        return {'places': [{'name': '黄鹤楼'}]}
    class SlowSummary(WorkerModel):
        async def ainvoke(self, messages, config=None, **kwargs):
            if any(getattr(item, 'type', '') == 'tool' for item in messages):
                await asyncio.sleep(10)
            return await super().ainvoke(messages, config, **kwargs)
    monkeypatch.setitem(travel.STAGE_TIMEOUTS, 'model', .02)
    model = SlowSummary(responses=[AIMessage(content='', tool_calls=[{'id': 'one', 'name': lookup.name, 'args': {'city': '武汉'}}])])
    result = await travel.build_graph('destinations', lambda _: model, lambda _: [lookup]).ainvoke({'messages': [HumanMessage(content='武汉景点')]})
    assert '黄鹤楼' in result['response'] and '超时' in result['response']


def test_itinerary_artifact_is_versioned_and_never_accepts_model_coordinates():
    answer = '## 🧭 武汉2日行程\n### Day 1 · 老城\n**上午｜黄鹤楼**\n游览建议\n### Day 2 · 博物馆\n**下午｜湖北省博物馆**\n坐标：999,999\n### 📌 实用提醒\n预约待确认'
    result = itinerary_from_answer(answer)
    assert result['schema_version'] == 1 and result['destination'] == '武汉'
    assert len(result['days']) == 2 and result['days'][0][0]['title'] == '黄鹤楼'
    assert all('place' not in item for day in result['days'] for item in day)
    assert itinerary_from_answer(answer.replace('Day 2', 'Day 3')) is None


@pytest.mark.asyncio
async def test_disconnect_resume_replays_only_missing_events_without_running_again(tmp_path):
    calls = []
    proceed = asyncio.Event()
    async def runner(*_):
        calls.append(1)
        yield {'type': 'delta', 'content': '第一段'}
        await proceed.wait()
        yield {'type': 'artifact', 'itinerary': None, 'warnings': []}
        yield {'type': 'final', 'content': '完整回复'}
    service = ChatService(ChatRepository(tmp_path / 'runs.db'), runner)
    token = service.create_device()
    request = StartMessage(type='start', token=token, request_id='stable', query='武汉行程')
    try:
        stream = service.runs().subscribe(request)
        accepted = await anext(stream)
        partial = await anext(stream)
        await stream.aclose()
        assert not next(iter(service.runs().registry.values())).task.done()
        proceed.set()
        resumed = [event async for event in service.runs().subscribe(request.model_copy(update={'resume': True, 'after_seq': partial['seq']}))]
        assert resumed[-1]['type'] == 'done' and resumed[-1]['elapsed_ms'] >= 0
        assert resumed[0]['seq'] == partial['seq'] + 1 and len(calls) == 1
        assert not any(event.get('content') == '第一段' for event in resumed)
        detail = service.get_conversation(service.authenticate(token), accepted['conversation_id'])
        assert detail['messages'][-1]['status'] == 'complete'
        # Eviction/process restart still replays a completed request from SQL.
        service.runs().registry.clear()
        replay = [event async for event in service.runs().subscribe(request)]
        assert replay[-1]['type'] == 'done' and len(calls) == 1
    finally:
        await service.shutdown()


@pytest.mark.asyncio
async def test_heartbeat_and_cancel_are_distinct_from_disconnect_and_isolated_by_owner(tmp_path):
    async def runner(*_):
        yield {'type': 'delta', 'content': '保留这段'}
        await asyncio.sleep(10)
    service = ChatService(ChatRepository(tmp_path / 'cancel.db'), runner)
    token = service.create_device()
    request = StartMessage(type='start', token=token, request_id='same', query='武汉')
    try:
        service.runs().heartbeat = .01
        stream = service.runs().subscribe(request)
        accepted = await anext(stream)
        assert (await anext(stream))['type'] == 'delta'
        assert (await anext(stream))['type'] == 'heartbeat'
        other = service.authenticate(service.create_device())
        await service.runs().cancel_owner(other, request.request_id)
        assert not next(iter(service.runs().registry.values())).task.done()
        await service.runs().cancel(request)
        assert (await anext(stream))['type'] == 'cancelled'
        await stream.aclose()
        detail = service.get_conversation(service.authenticate(token), accepted['conversation_id'])
        assert detail['messages'][-1]['content'] == '保留这段' and detail['messages'][-1]['status'] == 'interrupted'
    finally:
        await service.shutdown()


@pytest.mark.asyncio
@pytest.mark.parametrize('terminal_error', [False, True])
async def test_saved_answer_missing_done_frame_preserves_resume_cursor(tmp_path, terminal_error):
    repo = ChatRepository(tmp_path / 'crash-window.db')
    token = repo.create_device(); owner = repo.authenticate(token)
    turn, _ = repo.begin(owner, 'team', None, 'one', '武汉', '武汉')
    # Simulate a crash after committing the answer but before sending done.
    for index, event in enumerate([
        {'type': 'accepted', 'conversation_id': turn['conversation_id']},
        {'type': 'delta', 'content': '部分'}, {'type': 'delta', 'content': '文字'},
        {'type': 'final', 'content': '完整答案'},
    ]):
        repo.append_event(turn['id'], {**event, 'seq': index + 1})
    repo.finish(turn['id'], '完整答案', 'complete')
    if terminal_error:
        repo.append_event(turn['id'], {'type': 'error', 'message': '连接异常', 'seq': 5})
    service = ChatService(repo)
    try:
        request = StartMessage(type='start', token=token, request_id='one', query='武汉', resume=True, after_seq=4)
        events = [event async for event in service.runs().subscribe(request)]
        assert events == [{'type': 'done', 'conversation_id': turn['conversation_id'], 'seq': 5}]
    finally:
        await service.shutdown()


@pytest.mark.asyncio
async def test_restart_interrupted_request_can_be_retried_without_waiting_five_minutes(tmp_path):
    repo = ChatRepository(tmp_path / 'restart.db')
    token = repo.create_device(); owner = repo.authenticate(token)
    turn, _ = repo.begin(owner, 'team', None, 'one', '武汉', '武汉')
    repo.append_event(turn['id'], {'type': 'accepted', 'conversation_id': turn['conversation_id'], 'seq': 1})
    repo.append_event(turn['id'], {'type': 'delta', 'content': '已发送的部分', 'seq': 2})
    async def runner(*_):
        yield {'type': 'final', 'content': '重新查询后的完整回复'}
    service = ChatService(repo, runner)
    try:
        request = StartMessage(type='start', token=token, request_id='one', query='武汉')
        with pytest.raises(ChatError, match='中断'):
            _ = [event async for event in service.runs().subscribe(request.model_copy(update={'resume': True, 'after_seq': 2}))]
        assert repo.detail(owner, turn['conversation_id'])['messages'][-1]['content'] == '已发送的部分'
        events = [event async for event in service.runs().subscribe(request)]
        assert events[-1]['type'] == 'done' and events[-2]['content'] == '重新查询后的完整回复'
    finally:
        await service.shutdown()
