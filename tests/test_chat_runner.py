import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel, FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import tool

from backend.app.graphs import travel as runner


class WorkerModel(FakeMessagesListChatModel):
    def bind_tools(self, tools, **kwargs):
        return self


@pytest.mark.asyncio
async def test_actual_langgraph_streams_only_public_answer_and_tool_progress(monkeypatch):
    @tool
    def lookup_hotel(city: str) -> str:
        """Look up test hotel data."""
        return 'test evidence'

    models = iter([
        WorkerModel(responses=[AIMessage(content='', tool_calls=[{'name': 'lookup_hotel', 'args': {'city': '京都'}, 'id': 'call-1', 'type': 'tool_call'}]),
                               AIMessage(content=[{'type': 'reasoning', 'text': 'PRIVATE_WORKER_REASONING'},
                                                  {'type': 'text', 'text': 'PRIVATE_WORKER_SUMMARY'}])]),
        FakeListChatModel(responses=['<think>PRIVATE_PUBLIC_REASONING</think>公开的京都建议'])
    ])
    graph = runner.build_graph('hotels', model_factory=lambda _: next(models), tool_factory=lambda _: [lookup_hotel])
    monkeypatch.setattr(runner, 'graph_for', lambda _: graph)
    events = [event async for event in runner.stream_travel('hotels', [], '帮我找酒店')]
    streamed = ''.join(event['content'] for event in events if event['type'] == 'delta')
    assert streamed == '公开的京都建议'
    assert 'PRIVATE_WORKER_SUMMARY' not in str(events)
    assert 'PRIVATE_WORKER_REASONING' not in str(events)
    assert 'PRIVATE_PUBLIC_REASONING' not in str(events)
    assert '<think>' not in str(events)
    assert any(event.get('label') == '查询旅行资料' for event in events)
    assert next(event for event in events if event['type'] == 'final')['content'] == streamed


@pytest.mark.parametrize(('raw', 'expected'), [
    ('<think>PRIVATE</think>武汉三日游', '武汉三日游'),
    ('建议：<ANALYSIS>PRIVATE<think>PRIVATE</think></ANALYSIS>黄鹤楼', '建议：黄鹤楼'),
    ('<thinking>PRIVATE，尚未结束', ''),
    ('正常回复：步行 < 3 公里，1 < 2。', '正常回复：步行 < 3 公里，1 < 2。'),
])
def test_reasoning_filter_handles_every_chunk_boundary(raw, expected):
    from backend.app.core.answers import PublicAnswerText, public_answer
    assert public_answer(raw) == expected
    for boundary in range(len(raw) + 1):
        parser = PublicAnswerText()
        parts = [parser.feed(raw[:boundary]), parser.feed(raw[boundary:])]
        assert ''.join(parts) == expected
        assert all('PRIVATE' not in part for part in parts)


@pytest.mark.parametrize(('base', 'model', 'extra'), [
    ('https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3.8-flash', {'enable_thinking': False}),
    ('https://dashscope-intl.aliyuncs.com/compatible-mode/v1', 'qwen-plus', {'enable_thinking': False}),
    ('https://api.example.com/v1', 'qwen3.8-flash', None),
    ('https://dashscope.aliyuncs.com/compatible-mode/v1', 'deepseek-r1', None),
])
def test_direct_answer_option_is_scoped_to_supported_dashscope_models(monkeypatch, base, model, extra):
    for key in ('TEAM_AGENT_MODEL_ID', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setenv('TRAVEL_API_BASE', base)
    monkeypatch.setenv('TRAVEL_API_KEY', 'unit-test-key')
    monkeypatch.setenv('TRAVEL_MODEL', model)
    assert runner.model_for('team').extra_body == extra


@pytest.mark.asyncio
@pytest.mark.parametrize(('query', 'weather_available'), [
    ('想去武汉玩几天', False), ('武汉明天会下雨吗？', True), ('What is the weather in Wuhan?', True),
    ('武汉明天冷不冷？', True),
])
async def test_general_itinerary_does_not_expand_into_unrequested_weather_calls(query, weather_available):
    bound = []

    @tool
    def map_weather(city: str) -> str:
        """Query weather for a city."""
        return 'weather'

    class RecordingWorker(WorkerModel):
        def bind_tools(self, tools, **kwargs):
            bound.extend(item.name for item in tools)
            return self

    models = iter([RecordingWorker(responses=[AIMessage(content='武汉行程')]), FakeListChatModel(responses=['武汉三天建议'])])
    graph = runner.build_graph('destinations', model_factory=lambda _: next(models), tool_factory=lambda _: [map_weather])
    from langchain_core.messages import HumanMessage
    await graph.ainvoke({'messages': [HumanMessage(content=query)], 'remaining': [], 'evidence': []})
    assert ('map_weather' in bound) is weather_available


def test_provider_configuration_missing_is_explicit(monkeypatch):
    from backend.app.core.errors import ChatError
    for name in ['TRAVEL_API_BASE', 'TRAVEL_API_KEY', 'DASHSCOPE_API_KEY', 'TOGETHER_API_KEY']:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(ChatError, match='尚未配置'):
        runner.model_for('team')


def test_importing_real_tools_does_not_contact_providers(monkeypatch):
    import importlib
    import requests
    import sys
    def forbidden(*args, **kwargs):
        raise AssertionError('Importing a tool must not make an external request')
    monkeypatch.setattr(requests.Session, 'request', forbidden)
    monkeypatch.delenv('TAVILY_API_KEY', raising=False)
    for module in ['src.tools.search_flights', 'src.tools.hotels_tools', 'src.tools.destination_tools']:
        if module in sys.modules:
            importlib.reload(sys.modules[module])
    assert all(runner.tools_for(agent) for agent in runner.WORKERS)


def test_shared_amadeus_tools_are_available_when_configured(monkeypatch):
    monkeypatch.setenv('AMADEUS_CLIENT_ID', 'test-client')
    monkeypatch.setenv('AMADEUS_CLIENT_SECRET', 'test-secret')
    assert 'search_flight' in {tool.name for tool in runner.tools_for('flights')}
    assert 'search_hotels' in {tool.name for tool in runner.tools_for('hotels')}
    assert 'city_search_amadeus' in {tool.name for tool in runner.tools_for('destinations')}

@pytest.mark.asyncio
@pytest.mark.parametrize(('tool_name', 'query', 'payload'), [
    ('map_search_places', '武汉有哪些景点', {'source': '百度地图 MCP', 'retrieved_at': '2026-10-28', 'data': {'results': [{'name': '黄鹤楼', 'address': '武汉市武昌区'}]}}),
    ('map_weather', '武汉明天天气怎么样', {'source': '百度地图 MCP', 'retrieved_at': '2026-10-28', 'data': {'forecasts': [{'date': '2026-10-29', 'text_day': '晴'}]}}),
    ('map_directions', '黄鹤楼到省博怎么走', {'source': '百度地图 MCP', 'retrieved_at': '2026-10-28', 'data': {'routes': [{'distance': 1234}]}}),
])
async def test_final_model_receives_real_tool_evidence_not_worker_claim(tool_name, query, payload):
    import json
    from langchain_core.messages import HumanMessage
    captured = []

    @tool(tool_name)
    def lookup(city: str) -> dict:
        """Return fixture data for a travel information lookup."""
        return payload

    class FinalModel(FakeListChatModel):
        async def ainvoke(self, messages, config=None, **kwargs):
            captured.append(messages[-1].content)
            return await super().ainvoke(messages, config=config, **kwargs)

    worker = WorkerModel(responses=[AIMessage(content='', tool_calls=[{'name': tool_name, 'args': {'city': '武汉'}, 'id': 'lookup', 'type': 'tool_call'}]),
                                    AIMessage(content='WORKER_INVENTED_FACT：门票999元')])
    models = iter([worker, FinalModel(responses=['根据查询结果回答'])])
    graph = runner.build_graph('destinations', model_factory=lambda _: next(models), tool_factory=lambda _: [lookup])
    result = await graph.ainvoke({'messages': [HumanMessage(content=query)], 'remaining': [], 'evidence': []})
    assert result['response'] == '根据查询结果回答'
    assert captured and 'WORKER_INVENTED_FACT' not in captured[0] and '门票999元' not in captured[0]
    assert payload['source'] in captured[0]
    assert json.dumps(payload, ensure_ascii=False).replace('"', '\\"') in captured[0]


@pytest.mark.asyncio
@pytest.mark.parametrize('case', ['failed', 'empty', 'not_called'])
async def test_unavailable_evidence_never_passes_invented_worker_result_to_final_model(case):
    from langchain_core.messages import HumanMessage
    from langchain_core.tools import ToolException

    @tool('map_search_places')
    def lookup(city: str) -> dict:
        """Return an empty result or a safe error."""
        if case == 'failed':
            raise ToolException('fixture provider unavailable')
        return {'source': '百度地图', 'data': {'results': []}}

    calls = [] if case == 'not_called' else [{'name': 'map_search_places', 'args': {'city': '武汉'}, 'id': 'lookup', 'type': 'tool_call'}]
    responses = [AIMessage(content='', tool_calls=calls), AIMessage(content='伪造：黄鹤楼门票999元')] if calls else [AIMessage(content='伪造：黄鹤楼门票999元')]
    def model_factory(_):
        if worker_used:
            raise AssertionError('No final model should be invoked when no reliable evidence exists')
        worker_used.append(True)
        return WorkerModel(responses=responses)
    worker_used = []
    graph = runner.build_graph('destinations', model_factory=model_factory, tool_factory=lambda _: [lookup])
    result = await graph.ainvoke({'messages': [HumanMessage(content='武汉有哪些景点')], 'remaining': [], 'evidence': []})
    assert '999' not in result['response']
    assert '未能完成' in result['response'] if case == 'failed' else '没有取得可核实的查询结果' in result['response']


@pytest.mark.asyncio
@pytest.mark.parametrize('workers', [[], ['destinations'], ['flights', 'hotels', 'destinations'], ['hotels', 'hotels'], ['unknown']])
async def test_team_routing_stream_uses_validated_tool_calls_without_serializer_warning(monkeypatch, workers):
    """Exercise the real OpenAI adapter and LangGraph stream with a local SSE fixture."""
    import json
    import warnings
    import httpx
    from langchain_openai import ChatOpenAI

    requests = []
    def respond(request):
        payload = json.loads(request.content)
        requests.append(payload)
        assert 'response_format' not in payload
        assert payload['tools'][0]['function']['name'] == 'RoutingPlan'
        assert payload['stream'] is True
        args = json.dumps({'workers': workers})
        boundary = len(args) // 2
        deltas = [
            {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'routing-1', 'type': 'function',
                'function': {'name': 'RoutingPlan', 'arguments': args[:boundary]}}]},
            {'tool_calls': [{'index': 0, 'function': {'arguments': args[boundary:]}}]},
            {},
        ]
        chunks = [{'id': 'routing-response', 'object': 'chat.completion.chunk', 'created': 0,
                   'model': 'fixture-model', 'choices': [{'index': 0, 'delta': delta,
                       'finish_reason': 'tool_calls' if index == 2 else None}]}
                  for index, delta in enumerate(deltas)]
        return httpx.Response(200, headers={'content-type': 'text/event-stream'},
            content=''.join('data: ' + json.dumps(chunk) + '\n\n' for chunk in chunks) + 'data: [DONE]\n\n')

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        planner = ChatOpenAI(model='fixture-model', api_key='test-key', base_url='http://fixture.invalid/v1',
                             http_async_client=client, http_socket_options=())
        team_calls = []
        def model_factory(agent):
            if agent == 'team':
                team_calls.append(agent)
                return planner if len(team_calls) == 1 else FakeListChatModel(responses=['你好，我是远行旅行助手。'])
            return WorkerModel(responses=[AIMessage(content='PRIVATE_WORKER_SUMMARY')])
        graph = runner.build_graph('team', model_factory=model_factory, tool_factory=lambda _: [])
        monkeypatch.setattr(runner, 'graph_for', lambda _: graph)
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter('always')
            if workers == ['unknown']:
                from pydantic import ValidationError
                with pytest.raises(ValidationError):
                    _ = [event async for event in runner.stream_travel('team', [], '你好')]
            else:
                events = [event async for event in runner.stream_travel('team', [], '你好')]
        assert not any('Pydantic serializer warnings' in str(w.message) for w in caught)
        assert len(requests) == 1
        if workers == ['unknown']:
            return
        selected = [event['key'] for event in events if event.get('key') in runner.WORKERS and event.get('state') == 'running']
        assert selected == list(dict.fromkeys(workers))
        assert next(event for event in events if event['type'] == 'final')['content'] == '你好，我是远行旅行助手。'
        assert 'PRIVATE_WORKER_SUMMARY' not in str(events)


@pytest.mark.asyncio
@pytest.mark.parametrize(('query', 'required'), [('想去武汉玩几天', True), ('武汉三天怎么玩', True), ('你好', False)])
async def test_factual_request_actually_queries_provider_before_answering(monkeypatch, query, required):
    """An OpenAI-compatible worker that skips optional tools reproduces the failure."""
    import json
    import httpx
    from langchain_openai import ChatOpenAI
    from backend.app.tools.catalog import travel_services_status

    requests, lookups = [], []
    @tool('map_search_places')
    def lookup(city: str) -> dict:
        """Find places in the requested city."""
        lookups.append(city)
        return {'source': 'fixture provider', 'data': {'results': [{'name': '黄鹤楼'}]}}

    def respond(request):
        payload = json.loads(request.content); requests.append(payload)
        if payload.get('tool_choice') == 'required':
            assert {item['function']['name'] for item in payload['tools']} == {'map_search_places'}
            delta = {'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'lookup', 'type': 'function',
                'function': {'name': 'map_search_places', 'arguments': json.dumps({'city': '武汉'})}}]}
            finish = 'tool_calls'
        else:
            delta, finish = {'role': 'assistant', 'content': 'PRIVATE_WORKER_REPLY_WITHOUT_TOOL'}, 'stop'
        chunks = [{'id': 'worker-response', 'object': 'chat.completion.chunk', 'created': 0, 'model': 'fixture-model',
                   'choices': [{'index': 0, 'delta': delta, 'finish_reason': None}]},
                  {'id': 'worker-response', 'object': 'chat.completion.chunk', 'created': 0, 'model': 'fixture-model',
                   'choices': [{'index': 0, 'delta': {}, 'finish_reason': finish}]}]
        return httpx.Response(200, headers={'content-type': 'text/event-stream'},
            content=''.join('data: ' + json.dumps(chunk) + '\n\n' for chunk in chunks) + 'data: [DONE]\n\n')

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        worker = ChatOpenAI(model='fixture-model', api_key='test-key', base_url='http://fixture.invalid/v1',
                            http_async_client=client, http_socket_options=())
        models = iter([worker, FakeListChatModel(responses=['武汉行程建议' if required else '你好'])])
        graph = runner.build_graph('destinations', model_factory=lambda _: next(models), tool_factory=lambda _: [travel_services_status, lookup])
        monkeypatch.setattr(runner, 'graph_for', lambda _: graph)
        events = [event async for event in runner.stream_travel('destinations', [], query)]
    assert lookups == (['武汉'] if required else [])
    assert len(requests) == (2 if required else 1)
    if required:
        assert requests[0]['tool_choice'] == 'required' and requests[1].get('tool_choice') != 'required'
        assert any(event.get('kind') == 'tool' and event['state'] == 'complete' for event in events)
    assert next(event for event in events if event['type'] == 'final')['content'] == ('武汉行程建议' if required else '你好')
    assert 'PRIVATE_WORKER_REPLY' not in str(events)
