"""Expose only configured read-only providers; credentials never enter tool results."""

import os

from langchain_core.tools import tool

from backend.app.services.baidu_mcp import BaiduMCP, map_transport


def configured_services():
    return {'baidu_maps': bool(os.getenv('BAIDU_MAP_AK', '').strip()),
            'amadeus': all(os.getenv(key, '').strip() for key in ['AMADEUS_CLIENT_ID', 'AMADEUS_CLIENT_SECRET'])}


@tool
def travel_services_status() -> dict:
    """查看旅行数据能力是否已在服务端配置。仅返回能力状态，不返回密钥；未配置的服务不能查询实时数据。"""
    services = configured_services()
    return {'places_weather_routes': services['baidu_maps'], 'flight_and_hotel_offers': services['amadeus'],
            'railway_tickets': False, 'booking_and_payment': False,
            'note': '地图中的酒店地点不代表实时房态或预订报价。航班/酒店供应商当前为原有 Amadeus 测试接口，需另核对供应商准入。'}


def capability_summary():
    services = configured_services()
    return ('百度地图地点、天气、国内路线：' + ('已配置' if services['baidu_maps'] else '未配置')
            + '；航班与酒店报价工具：' + ('已配置凭据，仍需以实际接口结果为准' if services['amadeus'] else '未配置')
            + '；高铁余票、下单、支付：尚未接入。')

def tools_for(agent: str):
    services = configured_services()
    result = [travel_services_status]
    if services['baidu_maps'] and map_transport() == 'webapi' and agent in {'hotels', 'destinations'}:
        from backend.app.tools.baidu import search_baidu_places, get_baidu_weather, plan_baidu_route
        result += [search_baidu_places]
        if agent == 'destinations':
            result += [get_baidu_weather, plan_baidu_route]
    if not services['amadeus']:
        return result
    if agent == 'flights':
        from src.tools.search_flights import search_flight, get_airport_name_from_iata, get_nearby_airports, check_flight_status, get_checkin_links
        return result + [search_flight, get_airport_name_from_iata, get_nearby_airports, check_flight_status, get_checkin_links]
    if agent == 'hotels':
        from src.tools.hotels_tools import search_hotels, get_hotel_offers
        return result + [search_hotels, get_hotel_offers]
    from src.tools.destination_tools import city_search_amadeus, get_city_coordinates, get_tours_and_activities
    return result + [city_search_amadeus, get_city_coordinates, get_tours_and_activities]


async def load_tools_for(agent: str):
    """Discover hosted MCP tools only when a map-capable worker actually runs."""
    result = tools_for(agent)
    if configured_services()['baidu_maps'] and map_transport() == 'mcp' and agent in {'hotels', 'destinations'}:
        from backend.app.core.errors import ChatError
        from langchain_core.tools import ToolException
        error = None
        try:
            result += await BaiduMCP().discover(agent)
        except ToolException as exc:
            error = str(exc)
        if error:
            raise ChatError(error, 503)
    return result
