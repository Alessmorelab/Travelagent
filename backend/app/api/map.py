"""Authenticated, read-only location search for the mini-program map."""
import asyncio
from typing import Literal

from fastapi import APIRouter, Header, HTTPException
from langchain_core.tools import ToolException
from pydantic import BaseModel, Field, field_validator
from pydantic import ConfigDict

from backend.app.api.identity import authenticated
from backend.app.core.failures import failure_for, stage_call
from backend.app.services.baidu_maps import BaiduMaps

router = APIRouter()


class ResolvePlaces(BaseModel):
    city: str = Field(min_length=1, max_length=50)
    queries: list[str] = Field(min_length=1, max_length=12)

    @field_validator('city')
    @classmethod
    def city_name(cls, value):
        if not value.strip():
            raise ValueError('请输入城市')
        return value.strip()

    @field_validator('queries')
    @classmethod
    def queries_valid(cls, values):
        if any(not value.strip() or len(value) > 100 for value in values):
            raise ValueError('地点名称最长100字且不能为空')
        return [value.strip() for value in values]


class Point(BaseModel):
    model_config = ConfigDict(strict=True, allow_inf_nan=False)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)


class DayRoute(BaseModel):
    stops: list[Point] = Field(min_length=2, max_length=12)
    mode: Literal['walking', 'driving', 'transit'] = 'walking'
    segments: list[int] | None = Field(default=None, max_length=11)

    @field_validator('segments')
    @classmethod
    def segment_numbers(cls, values, info):
        if values is not None and (not values or len(set(values)) != len(values) or any(isinstance(value, bool) or value < 0 or value >= len(info.data.get('stops', [])) - 1 for value in values)):
            raise ValueError('路段编号无效')
        return values


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
    await authenticated(authorization)
    try:
        return await asyncio.to_thread(BaiduMaps().search_for_wechat, request.query, request.city)
    except ToolException as error:
        raise HTTPException(502, str(error)) from None


@router.post('/resolve')
async def resolve(request: ResolvePlaces, authorization: str = Header(default='')):
    await authenticated(authorization)
    gate = asyncio.Semaphore(2)

    async def search(query):
        async with gate:
            try:
                result = await stage_call(asyncio.to_thread(BaiduMaps().search_for_wechat, query[:45], request.city), 20)
                return {'query': query, **result}
            except Exception as error:
                return {'query': query, 'places': [], 'failure': failure_for(error, 'map_search', '查询地点').public()}

    return {'results': await asyncio.gather(*(search(query) for query in request.queries))}


@router.post('/routes')
async def routes(request: DayRoute, authorization: str = Header(default='')):
    await authenticated(authorization)
    gate = asyncio.Semaphore(2)

    async def segment(index):
        async with gate:
            try:
                result = await stage_call(asyncio.to_thread(BaiduMaps().route_for_wechat,
                    request.stops[index].model_dump(), request.stops[index + 1].model_dump(), request.mode), 20)
                return {'index': index, **result}
            except Exception as error:
                return {'index': index, 'failure': failure_for(error, 'map_route', '查询路线').public()}

    indices = request.segments if request.segments is not None else range(len(request.stops) - 1)
    return {'coordinate_system': 'gcj02', 'mode': request.mode,
            'legs': await asyncio.gather(*(segment(index) for index in indices))}
