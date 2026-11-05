from fastapi import APIRouter, Header, HTTPException
from langchain_core.exceptions import OutputParserException
from pydantic import ValidationError

from backend.app.api.identity import authenticated
from backend.app.core.failures import failure_for
from backend.app.services.day_adjustment import (
    AdjustmentRequest, AdjustmentResponse, InvalidAdjustment, propose_day_adjustment,
)

router = APIRouter()
_active_owners: set[str] = set()


@router.post('/adjust-day', response_model=AdjustmentResponse)
async def adjust_day(request: AdjustmentRequest, authorization: str = Header(default='')):
    owner = await authenticated(authorization)
    if owner in _active_owners or len(_active_owners) >= 3:
        raise HTTPException(429, '已有行程调整正在生成，请稍后再试')
    _active_owners.add(owner)
    try:
        return await propose_day_adjustment(request)
    except (InvalidAdjustment, ValidationError, OutputParserException):
        raise HTTPException(502, '模型未生成符合范围的改动，请简化要求后重试') from None
    except Exception as error:
        failure = failure_for(error, 'day_adjustment', '生成行程改动')
        code = {'rate_limit': 429, 'timeout': 504}.get(failure.kind, 503)
        raise HTTPException(code, failure.message) from None
    finally:
        _active_owners.discard(owner)
