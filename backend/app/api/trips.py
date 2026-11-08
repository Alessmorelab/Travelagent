import asyncio

from fastapi import APIRouter, Header, HTTPException, Request, Response
from langchain_core.exceptions import OutputParserException
from pydantic import ValidationError

from backend.app.api.identity import authenticated
from backend.app.core.failures import failure_for
from backend.app.services.day_adjustment import (
    AdjustmentRequest, AdjustmentResponse, InvalidAdjustment, propose_day_adjustment,
)

router = APIRouter()
_active_owners: set[str] = set()


async def _wait_for_disconnect(request: Request):
    # FastAPI 已读取并校验请求体，此处只等待连接断开通知。
    while True:
        message = await request.receive()
        if message['type'] == 'http.disconnect':
            return


@router.post('/adjust-day', response_model=AdjustmentResponse)
async def adjust_day(request: AdjustmentRequest, http_request: Request, authorization: str = Header(default='')):
    owner = await authenticated(authorization)
    if owner in _active_owners or len(_active_owners) >= 3:
        raise HTTPException(429, '已有行程调整正在生成，请稍后再试')
    _active_owners.add(owner)
    generation = asyncio.create_task(propose_day_adjustment(request))
    disconnected = asyncio.create_task(_wait_for_disconnect(http_request))
    try:
        completed, _ = await asyncio.wait({generation, disconnected}, return_when=asyncio.FIRST_COMPLETED)
        if generation in completed:
            return generation.result()
        disconnected.result()
        return Response(status_code=499)
    except (InvalidAdjustment, ValidationError, OutputParserException):
        raise HTTPException(502, '模型未生成符合范围的改动，请简化要求后重试') from None
    except Exception as error:
        failure = failure_for(error, 'day_adjustment', '生成行程改动')
        code = {'rate_limit': 429, 'timeout': 504}.get(failure.kind, 503)
        raise HTTPException(code, failure.message) from None
    finally:
        # 关闭面板或停止请求后，取消本次生成并回收监听任务，再释放并发名额。
        generation.cancel()
        disconnected.cancel()
        await asyncio.gather(generation, disconnected, return_exceptions=True)
        _active_owners.discard(owner)
