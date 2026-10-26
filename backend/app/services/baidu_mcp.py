"""Baidu's hosted MCP service, adapted to read-only LangGraph tools."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from urllib.parse import urlencode
from zoneinfo import ZoneInfo

import httpx
from jsonschema import ValidationError, validate
from langchain_core.tools import StructuredTool, ToolException
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from backend.app.services.baidu_maps import AUTH_ERRORS

TOOL_LABELS = {
    'map_geocode': '百度地图：解析地址',
    'map_reverse_geocode': '百度地图：查询坐标地址',
    'map_search_places': '百度地图：查找地点',
    'map_place_details': '百度地图：查询地点详情',
    'map_directions_matrix': '百度地图：比较路程',
    'map_directions': '百度地图：规划路线',
    'map_weather': '百度地图：查询天气',
    'map_district_search': '百度地图：查询行政区划',
    'map_road_traffic': '百度地图：查询路况',
    'map_geoconv': '百度地图：转换坐标',
}
HOTEL_TOOLS = {'map_geocode', 'map_reverse_geocode', 'map_search_places', 'map_place_details', 'map_district_search'}


def map_transport():
    value = os.getenv('BAIDU_MAP_TRANSPORT', 'webapi').strip().lower()
    if value not in {'webapi', 'mcp'}:
        raise ToolException('BAIDU_MAP_TRANSPORT 仅支持 mcp 或 webapi')
    return value


class RedactMCPURL(logging.Filter):
    """The SDK/httpx can log the authenticated URL even on a failed request."""

    def filter(self, record):
        def clean(text):
            text = re.sub(r'([?&]ak=)[^&\s\"\'<>]+', r'\1[REDACTED]', text)
            for key in ('BAIDU_MAP_AK', 'BAIDU_MAP_SK'):
                secret = os.getenv(key, '').strip()
                if secret:
                    text = text.replace(secret, '[REDACTED]')
            return text
        record.msg, record.args = clean(record.getMessage()), ()
        if record.exc_info:
            record.exc_text = clean(''.join(traceback.format_exception(*record.exc_info)))
            record.exc_info = None
        return True


def protect_mcp_logs():
    for name in ('httpx', 'mcp.client.streamable_http'):
        logger = logging.getLogger(name)
        if not any(isinstance(item, RedactMCPURL) for item in logger.filters):
            logger.addFilter(RedactMCPURL())


class BaiduMCP:
    def __init__(self, ak=None, session_factory=None):
        self._ak = (os.getenv('BAIDU_MAP_AK', '') if ak is None else ak).strip()
        self._session_factory = session_factory or self._session

    @asynccontextmanager
    async def _session(self):
        protect_mcp_logs()
        url = 'https://mcp.map.baidu.com/mcp?' + urlencode({'ak': self._ak})
        # A session belongs to one operation and closes on cancellation as well.
        async with httpx.AsyncClient(timeout=httpx.Timeout(25, connect=8), follow_redirects=False) as client:
            async with streamable_http_client(url, http_client=client) as (read, write, _):
                async with ClientSession(read, write, read_timeout_seconds=timedelta(seconds=25)) as session:
                    await session.initialize()
                    yield session

    async def _execute(self, operation):
        if not self._ak:
            raise ToolException('后端尚未配置 BAIDU_MAP_AK，无法连接百度地图 MCP')
        result, error = None, None
        try:
            async with asyncio.timeout(35):
                async with self._session_factory() as session:
                    result = await operation(session)
        except Exception as exc:
            # Do not retain exception messages/context: SDK failures may include AK URLs.
            error = self._connection_error(exc)
        if error:
            raise ToolException(error)
        return result

    @staticmethod
    def _connection_error(error):
        if isinstance(error, BaseExceptionGroup):
            return BaiduMCP._connection_error(error.exceptions[0])
        if isinstance(error, (TimeoutError, httpx.TimeoutException)):
            return '百度地图 MCP 请求超时，尚未取得结果，请检查后端网络或稍后重试'
        if isinstance(error, httpx.HTTPStatusError):
            status = error.response.status_code
            if status in {401, 403}:
                return f'百度地图 MCP 鉴权失败（HTTP {status}），请核对服务端 AK、服务权限与应用校验方式'
            return f'百度地图 MCP 请求失败（HTTP {status}），请检查服务状态'
        return '无法连接百度地图 MCP，请检查后端网络、代理和服务端 AK 配置'

    def _redact(self, text):
        for secret in (self._ak, os.getenv('BAIDU_MAP_SK', '').strip()):
            if secret:
                text = text.replace(secret, '[REDACTED]')
        return re.sub(r'([?&]ak=)[^&\s\"\'<>]+', r'\1[REDACTED]', text)

    async def discover(self, agent='destinations'):
        async def list_all(session):
            tools, cursor = [], None
            for _ in range(10):
                page = await session.list_tools(cursor=cursor)
                tools.extend(page.tools)
                cursor = page.nextCursor
                if not cursor:
                    return tools
            raise ValueError('Too many tool pages')

        available = await self._execute(list_all)
        allowed = HOTEL_TOOLS if agent == 'hotels' else set(TOOL_LABELS)
        result = [self._adapt(item) for item in available if item.name in allowed]
        if not result:
            raise ToolException('百度地图 MCP 未返回可用的旅行查询工具，请检查服务权限')
        return result

    def _adapt(self, remote):
        name, schema = remote.name, remote.inputSchema

        async def invoke(**arguments):
            invalid = False
            try:
                validate(arguments, schema)
            except ValidationError:
                invalid = True
            if invalid:
                raise ToolException('地图查询参数不符合工具要求，请检查必填项与参数类型')
            return await self.call(name, arguments)

        description = self._redact(remote.description or TOOL_LABELS[name])
        description += (' 仅用于信息查询；酒店地点及价格字段不是实时房态或可预订报价。'
                        '坐标必须来自查询结果；按每个字段说明使用经纬度顺序，默认百度 BD-09。'
                        '天气行政区代码须来自用户明确提供的代码或行政区划工具结果，不能猜测；天气仅限返回日期。')
        return StructuredTool.from_function(coroutine=invoke, name=name, description=description,
                                            args_schema=schema, handle_tool_error=True)

    async def call(self, name, arguments):
        if name not in TOOL_LABELS:
            raise ToolException('该地图工具未加入只读旅行工具目录')
        result = await self._execute(lambda session: session.call_tool(name, arguments))
        data = result.structuredContent
        if data is None:
            blocks = []
            for block in result.content:
                if getattr(block, 'type', '') == 'text':
                    try:
                        blocks.append(json.loads(block.text))
                    except (ValueError, TypeError):
                        blocks.append(block.text)
            data = blocks[0] if len(blocks) == 1 else blocks
        # Surface provider failures without echoing arbitrary upstream error text.
        status = data.get('status') if isinstance(data, dict) else None
        if isinstance(status, str) and status.isdigit():
            status = int(status)
        if isinstance(status, int) and status != 0:
            raise ToolException(AUTH_ERRORS.get(status, f'百度地图 MCP 查询未成功（状态 {status}），请检查查询参数或服务权限'))
        if result.isError and 'Failed to automatically open MCP' in str(data):
            raise ToolException('百度地图返回 MCP（SSE）服务自动开通失败，请在百度地图控制台“我的应用”检查该 AK 的 MCP（SSE）服务状态')
        if result.isError:
            raise ToolException('百度地图 MCP 工具执行失败，请核对服务端 AK、服务权限、应用校验方式和查询参数')
        if data in (None, '', []):
            raise ToolException('百度地图 MCP 未返回查询数据，请稍后重试')
        text = self._redact(json.dumps(data, ensure_ascii=False))
        clean = json.loads(text) if len(text) <= 24000 else {'excerpt': text[:24000], 'truncated': True}
        return {'source': '百度地图 MCP',
                'retrieved_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds'),
                'data': clean,
                'note': '经纬度顺序、坐标系以工具字段说明为准，未转换的地点坐标默认为 BD-09。'
                        '天气中的 999999、暂无表示缺测。酒店信息不代表实时房态或预订报价。'}
