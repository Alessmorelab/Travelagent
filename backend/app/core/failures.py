"""Stable public failures. Provider exception text must never cross this boundary."""
from __future__ import annotations

import asyncio
from dataclasses import asdict, dataclass
import json
import re

import httpx
import requests
from langchain_core.tools import ToolException
from pydantic import ValidationError

from backend.app.core.errors import ChatError


@dataclass(frozen=True)
class Failure:
    kind: str
    message: str
    retryable: bool = False
    stage: str = ''
    label: str = ''

    def public(self):
        return asdict(self)


def failure_for(error: Exception, stage='', label='') -> Failure:
    # Inspect types/status codes, never echo response bodies, URLs or SDK messages.
    status = getattr(error, 'status_code', None) or getattr(error, 'code', None)
    response = getattr(error, 'response', None)
    if status is None and response is not None:
        status = getattr(response, 'status_code', None)
    safe = str(error) if isinstance(error, (ToolException, ChatError)) else ''
    if status is None and (match := re.search(r'HTTP\s+(\d{3})', safe)):
        status = int(match[1])
    name = type(error).__name__.lower()
    if status in {401, 403} or re.search(r'鉴权|密钥|AK 无效|SN 校验|白名单|权限|未启用|未配置|应用.*停用|服务.*开通', safe):
        return Failure('configuration', '服务鉴权或配置未通过，请检查服务端配置和接口权限', False, stage, label)
    if status == 429 or re.search(r'额度|配额|过于频繁', safe) or 'ratelimit' in name:
        return Failure('rate_limit', '服务调用受到额度或频率限制，请稍后重试', False, stage, label)
    if isinstance(error, (TimeoutError, httpx.TimeoutException, requests.Timeout)) or 'timeout' in name or '超时' in safe:
        return Failure('timeout', '查询超时，暂未取得结果', True, stage, label)
    if isinstance(error, (httpx.NetworkError, requests.ConnectionError, ConnectionError)) or 'connection' in name or re.search(r'无法连接|网络', safe):
        return Failure('network', '暂时无法连接查询服务', True, stage, label)
    if status == 422 or isinstance(error, ValidationError) or re.search(r'参数|必填|类型|请输入|坐标无效', safe):
        return Failure('invalid_input', '查询参数不完整或无效，请调整后重试', False, stage, label)
    if re.search(r'未找到|未查到|没有.*方案|未返回查询数据', safe):
        return Failure('no_result', '没有查到符合条件的结果，请调整地点或出行方式', False, stage, label)
    if isinstance(status, int) and status >= 500:
        return Failure('unavailable', '查询服务暂不可用', True, stage, label)
    return Failure('unavailable', '本次查询未能完成，请稍后重试', False, stage, label)


def tool_error_text(error: ToolException):
    if isinstance(error, QueryFailure):
        return json.dumps({'failure': error.failure.public()}, ensure_ascii=False)
    return json.dumps({'failure': failure_for(error).public()}, ensure_ascii=False)


class QueryFailure(ToolException):
    def __init__(self, failure: Failure):
        self.failure = failure
        super().__init__(failure.message)


async def stage_call(awaitable, seconds: float):
    async with asyncio.timeout(seconds):
        return await awaitable
