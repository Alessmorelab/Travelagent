from typing import Literal

from langchain_core.tools import tool
from pydantic import BaseModel, Field

from backend.app.services.baidu_maps import BaiduMaps


class PlaceQuery(BaseModel):
    query: str = Field(min_length=1, max_length=45, description='单个地点名称或类别，如黄鹤楼、景点、酒店')
    city: str = Field(min_length=1, max_length=50, description='用户指定的国内城市，不要擅自用旅行偏好替换用户地点')
    limit: int = Field(default=3, ge=1, le=5)


class WeatherQuery(BaseModel):
    city: str = Field(min_length=1, max_length=50, description='国内城市名称，如武汉市')
    district: str = Field(default='', max_length=50, description='具体区县，如武昌区；用户未指定时可留空')


class RouteQuery(BaseModel):
    origin_latitude: float = Field(ge=-90, le=90, description='起点 BD-09 纬度，必须来自百度地点查询结果')
    origin_longitude: float = Field(ge=-180, le=180, description='起点 BD-09 经度，必须来自百度地点查询结果')
    destination_latitude: float = Field(ge=-90, le=90, description='终点 BD-09 纬度，必须来自百度地点查询结果')
    destination_longitude: float = Field(ge=-180, le=180, description='终点 BD-09 经度，必须来自百度地点查询结果')
    mode: Literal['walking', 'driving', 'transit'] = 'walking'


@tool(args_schema=PlaceQuery)
def search_baidu_places(query: str, city: str, limit: int = 3) -> dict:
    """查询国内景点、餐厅、酒店等地点的名称、地址和百度BD-09坐标。不能查询房态或实时预订价。

    只查询当前问题所需的地点，避免重复检索消耗额度；结果为空时如实说明，不能编造坐标。
    """
    return BaiduMaps().search(query, city, limit)


@tool(args_schema=WeatherQuery)
def get_baidu_weather(city: str, district: str = '') -> dict:
    """查询国内城市/区县实况与近期天气预报。必须依据返回日期作答，不能预测预报范围以外的日期。"""
    return BaiduMaps().weather(city, district)


@tool(args_schema=RouteQuery)
def plan_baidu_route(origin_latitude: float, origin_longitude: float, destination_latitude: float,
                     destination_longitude: float, mode: str = 'walking') -> dict:
    """查询国内两个地点间的步行、驾车或公交路线、距离及预计耗时。

    必须先通过search_baidu_places获得起终点百度BD-09坐标，不得使用猜测或其他坐标系的值。
    不提供高铁余票、航班库存、订票或支付功能。
    """
    return BaiduMaps().route(origin_latitude, origin_longitude, destination_latitude, destination_longitude, mode)
