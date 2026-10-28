import asyncio
import json
import logging
from contextlib import asynccontextmanager
from types import SimpleNamespace

import httpx
import pytest
from langchain_core.language_models.fake_chat_models import FakeListChatModel, FakeMessagesListChatModel
from langchain_core.messages import AIMessage
from langchain_core.tools import ToolException
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.fastmcp import FastMCP
from mcp.types import CallToolResult, TextContent, Tool

from backend.app.services.baidu_mcp import BaiduMCP, RedactMCPURL
from backend.app.tools import catalog


def result(data, error=False):
    return CallToolResult(content=[TextContent(type='text', text=json.dumps(data))], isError=error)


def factory(session):
    @asynccontextmanager
    async def open_session():
        yield session
    return open_session


@pytest.mark.asyncio
async def test_real_mcp_protocol_discovery_schema_and_weather_call():
    server = FastMCP('Baidu test', stateless_http=True, json_response=True)

    @server.tool()
    def map_weather(district_id: str):
        """Read test weather."""
        return {'status': 0, 'district_id': district_id, 'forecasts': [{'date': '2026-10-17', 'text_day': '晴'}]}

    @server.tool()
    def map_mark(text_content: str):
        """Not part of the application's read-only query tools."""
        raise AssertionError('This tool must not be exposed')

    app = server.streamable_http_app()

    @asynccontextmanager
    async def session_factory():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client:
            async with streamable_http_client('http://localhost:8765/mcp', http_client=client) as (read, write, _):
                async with ClientSession(read, write) as session:
                    await session.initialize()
                    yield session

    async with server.session_manager.run():
        adapter = BaiduMCP('private-ak', session_factory=session_factory)
        tools = await adapter.discover()
        assert [tool.name for tool in tools] == ['map_weather']
        data = await tools[0].ainvoke({'district_id': '420106'})
        assert data['data']['district_id'] == '420106'
        assert data['data']['forecasts'][0]['date'] == '2026-10-17'
        assert data['source'] == '百度地图 MCP' and 'private-ak' not in str(data)
        with pytest.raises(ToolException, match='未返回'):
            await adapter.discover('hotels')
        with pytest.raises(ToolException, match='只读'):
            await adapter.call('map_mark', {'text_content': 'private plan'})


@pytest.mark.asyncio
async def test_pagination_hotel_scope_and_each_tools_own_schema():
    calls = []
    class Session:
        async def list_tools(self, cursor=None):
            if cursor is None:
                return SimpleNamespace(tools=[Tool(name='map_search_places', inputSchema={'type': 'object',
                    'properties': {'query': {'type': 'string'}}, 'required': ['query']})], nextCursor='next')
            return SimpleNamespace(tools=[Tool(name='map_weather', inputSchema={'type': 'object',
                'properties': {'district_id': {'type': 'string'}}, 'required': ['district_id']})], nextCursor=None)
        async def call_tool(self, name, args):
            calls.append((name, args))
            return result({'status': 0, 'value': 'private-ak'})
    adapter = BaiduMCP('private-ak', session_factory=factory(Session()))
    tools = await adapter.discover()
    assert [tool.name for tool in await adapter.discover('hotels')] == ['map_search_places']
    assert '[REDACTED]' in str(await tools[0].ainvoke({'query': '黄鹤楼'}))
    await tools[1].ainvoke({'district_id': '420106'})
    assert [name for name, _ in calls] == ['map_search_places', 'map_weather']
    assert '参数' in await tools[1].ainvoke({'district_id': 420106})
    assert len(calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('payload,is_error,expected', [
    ({'status': 220, 'message': 'private-ak'}, False, 'Referer'),
    ({'status': '210'}, True, '出口 IP'),
    ('Failed to automatically open MCP (SSE) service: Service activation timeout', True, '自动开通失败'),
    ('private-ak at https://example.com/?ak=private-ak', True, '工具执行失败'),
    ('', False, '未返回查询数据'),
])
async def test_provider_errors_are_not_reported_as_success_or_leaked(payload, is_error, expected):
    class Session:
        async def call_tool(self, *args):
            return result(payload, is_error)
    with pytest.raises(ToolException, match=expected) as error:
        await BaiduMCP('private-ak', session_factory=factory(Session())).call('map_weather', {})
    assert 'private-ak' not in str(error.value)


@pytest.mark.asyncio
async def test_connection_errors_drop_sensitive_url_and_exception_context():
    @asynccontextmanager
    async def broken():
        raise httpx.ConnectError('https://mcp.map.baidu.com/mcp?ak=private-ak')
        yield
    with pytest.raises(ToolException, match='网络') as error:
        await BaiduMCP('private-ak', session_factory=broken).discover()
    assert 'private-ak' not in str(error.value) and error.value.__context__ is None


@pytest.mark.asyncio
async def test_cancellation_closes_session_and_propagates():
    opened, closed = asyncio.Event(), asyncio.Event()
    class Session:
        async def call_tool(self, *args):
            opened.set()
            await asyncio.Future()
    @asynccontextmanager
    async def session_factory():
        try:
            yield Session()
        finally:
            closed.set()
    task = asyncio.create_task(BaiduMCP('private-ak', session_factory=session_factory).call('map_weather', {}))
    await opened.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert closed.is_set()


def test_logs_redact_urls_and_tracebacks(monkeypatch):
    monkeypatch.setenv('BAIDU_MAP_AK', 'private-ak')
    try:
        raise RuntimeError('https://mcp.map.baidu.com/mcp?ak=private-ak')
    except RuntimeError:
        import sys
        record = logging.LogRecord('httpx', logging.ERROR, '', 0, 'Request %s',
            ('https://mcp.map.baidu.com/mcp?ak=private-ak',), sys.exc_info())
    RedactMCPURL().filter(record)
    assert 'private-ak' not in logging.Formatter().format(record)


@pytest.mark.asyncio
async def test_mcp_graph_calls_read_only_tool_and_streams_public_progress(monkeypatch):
    from backend.app.graphs import travel
    monkeypatch.setenv('BAIDU_MAP_TRANSPORT', 'mcp')
    monkeypatch.setenv('BAIDU_MAP_AK', 'private-ak')
    monkeypatch.delenv('AMADEUS_CLIENT_ID', raising=False)
    monkeypatch.delenv('AMADEUS_CLIENT_SECRET', raising=False)
    class Session:
        async def list_tools(self, cursor=None):
            return SimpleNamespace(tools=[Tool(name='map_weather', inputSchema={'type': 'object',
                'properties': {'district_id': {'type': 'string'}}})], nextCursor=None)
        async def call_tool(self, *args):
            return result('Failed to automatically open MCP (SSE) service', True)
    adapter = BaiduMCP('private-ak', session_factory=factory(Session()))
    monkeypatch.setattr(catalog, 'BaiduMCP', lambda: adapter)
    class Worker(FakeMessagesListChatModel):
        def bind_tools(self, tools, **kwargs):
            assert {tool.name for tool in tools} == {'travel_services_status', 'map_weather'}
            return self
    models = iter([Worker(responses=[AIMessage(content='', tool_calls=[{'name': 'map_weather',
        'args': {'district_id': '420106'}, 'id': 'weather', 'type': 'tool_call'}]),
        AIMessage(content='PRIVATE_WORKER 服务自动开通失败')]), FakeListChatModel(responses=['百度地图服务自动开通失败。'])])
    graph = travel.build_graph('destinations', model_factory=lambda _: next(models))
    monkeypatch.setattr(travel, 'graph_for', lambda _: graph)
    events = [item async for item in travel.stream_travel('destinations', [], '查询天气')]
    assert any(item.get('label') == '百度地图：查询天气' and item['state'] == 'interrupted' for item in events)
    assert 'PRIVATE_WORKER' not in str(events) and 'private-ak' not in str(events)
    assert '未能完成' in next(item for item in events if item['type'] == 'final')['content']
    assert [tool.name for tool in await catalog.load_tools_for('flights')] == ['travel_services_status']
