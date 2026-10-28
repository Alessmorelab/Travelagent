"""Authenticated, read-only location search for the mini-program map."""
import asyncio

from fastapi import APIRouter, Header, HTTPException
from langchain_core.tools import ToolException
from pydantic import BaseModel, Field, field_validator

from backend.app.core.errors import ChatError
from backend.app.services.baidu_maps import BaiduMaps
from backend.app.services.chat import get_chat_service

router = APIRouter()


class PlaceSearch(BaseModel):
    city: str = Field(min_length=1, max_length=50)
    query: str = Field(min_length=1, max_length=45)

    @field_validator('city', 'query')
    @classmethod
    def nonempty(cls, value: str):
        value = value.strip()
        if not value:
            raise ValueError('请输入城市和地点')
        return value


@router.post('/places')
async def places(request: PlaceSearch, authorization: str = Header(default='')):
    try:
        await asyncio.to_thread(get_chat_service().authenticate, authorization.removeprefix('Bearer '))
    except ChatError as error:
        raise HTTPException(error.code, str(error)) from error
    try:
        return await asyncio.to_thread(BaiduMaps().search_for_wechat, request.query, request.city)
    except ToolException as error:
        raise HTTPException(502, str(error)) from None
