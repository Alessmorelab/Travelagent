"""Read-only Baidu Web API access. Provider URLs and credentials stay in this layer."""

from __future__ import annotations

import hashlib
import html
import os
import re
import time
from datetime import datetime
from typing import Literal
from urllib.parse import quote_plus, urlencode
from zoneinfo import ZoneInfo

import requests
from langchain_core.tools import ToolException

AUTH_ERRORS = {
    4: '百度地图调用额度不足，请检查控制台配额',
    5: '百度地图 AK 无效或尚未生效，请检查服务端 AK',
    9: '百度地图接口权限不足，请在控制台检查已开通的服务',
    101: '百度地图未收到 AK，请检查后端配置',
    200: '百度地图 AK 对应的应用不存在，请检查配置',
    201: '百度地图应用已停用，请检查控制台状态',
    203: '百度地图 AK 类型不匹配，请使用服务端 AK',
    210: '百度地图 IP 校验未通过，请核对服务器出口 IP 与应用白名单',
    211: '百度地图 SN 校验未通过，请核对应用校验方式与 BAIDU_MAP_SK',
    220: '百度地图 Referer 校验未通过，后端请使用服务端类型 AK，核对应用类型后更新 BAIDU_MAP_AK',
    240: '百度地图应用未启用该接口，请在控制台勾选对应服务',
    261: '百度地图接口已停用，请检查供应商文档',
    302: '百度地图当日调用配额已用完，请稍后再试',
    401: '百度地图请求过于频繁，请稍后再试',
}


def encoded_query(path: str, params: dict, ak: str, sk: str = '') -> str:
    """Keep signature parameter order identical to the transmitted query string."""
    query = urlencode({**params, 'output': 'json', 'ak': ak})
    if sk:
        signature = hashlib.md5(quote_plus(path + '?' + query + sk).encode('utf-8')).hexdigest()
        query += '&sn=' + signature
    return query


def provenance():
    return {'source': '百度地图 Web API', 'retrieved_at': datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='seconds')}


def present(value):
    """Baidu uses 999999 / 暂无 for unavailable weather observations."""
    return None if value in (999999, '999999', '暂无', '') else value


class BaiduMaps:
    def __init__(self, ak: str | None = None, sk: str | None = None, transport=None):
        self._ak = (os.getenv('BAIDU_MAP_AK', '') if ak is None else ak).strip()
        self._sk = (os.getenv('BAIDU_MAP_SK', '') if sk is None else sk).strip()
        self._get = transport or requests.get

    def request(self, path: str, params: dict):
        if not self._ak:
            raise ToolException('后端尚未配置 BAIDU_MAP_AK，无法查询百度地图')
        if self._sk:
            params = {**params, 'timestamp': int(time.time())}
        url = 'https://api.map.baidu.com' + path + '?' + encoded_query(path, params, self._ak, self._sk)
        # Never attach raw provider exceptions, which may contain the AK-bearing URL.
        error = None
        data = None
        try:
            response = self._get(url, timeout=(5, 15), allow_redirects=False)
            if response.status_code != 200:
                error = f'百度地图服务请求失败（HTTP {response.status_code}），请稍后重试'
            else:
                data = response.json()
        except requests.Timeout:
            error = '百度地图服务请求超时，请稍后重试'
        except (ValueError, TypeError):
            error = '百度地图返回了无法读取的数据，请稍后重试'
        except requests.RequestException:
            error = '无法连接百度地图，请检查后端网络与代理设置'
        if error:
            raise ToolException(error)
        if not isinstance(data, dict) or not isinstance(data.get('status'), int):
            raise ToolException('百度地图返回格式异常，请稍后重试')
        if data['status'] != 0:
            # Upstream message text is deliberately excluded; it may contain secrets.
            raise ToolException(AUTH_ERRORS.get(data['status'], f'百度地图查询未成功（状态 {data["status"]}），请检查查询参数或服务权限'))
        return data

    def search(self, query: str, city: str, limit: int = 3):
        data = self.request('/place/v2/search', {'query': query, 'region': city, 'city_limit': 'true',
                            'page_size': limit, 'page_num': 0, 'scope': 1, 'extensions_adcode': 'true'})
        places = []
        for item in data.get('results', [])[:limit]:
            location = item.get('location') or {}
            if not isinstance(location.get('lat'), (int, float)) or not isinstance(location.get('lng'), (int, float)):
                continue
            places.append({key: item[key] for key in ['uid', 'name', 'address', 'province', 'city', 'area', 'adcode'] if key in item}
                          | {'latitude': location['lat'], 'longitude': location['lng'], 'coordinate_system': 'bd09ll'})
        return provenance() | {'query': query, 'city': city, 'places': places,
                               'note': '地点信息不代表实时房态、机票库存、门票或酒店预订报价；坐标为百度 BD-09。'}

    def weather(self, city: str, district: str = ''):
        data = self.request('/weather/v1/', {'city': city, 'district': district or city, 'data_type': 'all'})
        result = data.get('result') or {}
        now = result.get('now') or {}
        forecasts = [{key: present(item.get(key)) for key in ['date', 'week', 'text_day', 'text_night', 'high', 'low', 'wc_day', 'wd_day']}
                     for item in (result.get('forecasts') or [])[:7]]
        if not now and not forecasts:
            raise ToolException('未查到该地区天气，请补充具体城市和区县名称')
        return provenance() | {'location': result.get('location') or result.get('address') or {},
                               'now': {key: present(now.get(key)) for key in ['text', 'temp', 'feels_like', 'wind_class', 'wind_dir', 'uptime']},
                               'forecasts': forecasts, 'alerts': [
                                   {key: item.get(key) for key in ['type', 'level', 'title', 'desc']} for item in (result.get('alerts') or [])[:3]],
                               'note': '时间与预报日期为北京时间；只能回答返回日期内的天气，不推断更远日期的实际天气。'}

    def route(self, origin_latitude: float, origin_longitude: float, destination_latitude: float,
              destination_longitude: float, mode: Literal['walking', 'driving', 'transit'] = 'walking'):
        if mode not in {'walking', 'driving', 'transit'}:
            raise ToolException('出行方式仅支持步行、驾车或公交')
        for latitude, longitude in [(origin_latitude, origin_longitude), (destination_latitude, destination_longitude)]:
            if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
                raise ToolException('路线坐标无效，请先查询地点坐标')
        data = self.request('/directionlite/v1/' + mode, {
            'origin': f'{origin_latitude:.6f},{origin_longitude:.6f}',
            'destination': f'{destination_latitude:.6f},{destination_longitude:.6f}', 'coord_type': 'bd09ll'})
        routes = []
        for item in (data.get('result') or {}).get('routes', [])[:2]:
            steps = []
            for step in item.get('steps', []):
                for section in step if isinstance(step, list) else [step]:
                    instruction = section.get('instruction') or section.get('instructions') or ''
                    vehicle = section.get('vehicle') or {}
                    steps.append({'instruction': html.unescape(re.sub('<[^>]+>', '', instruction))[:600],
                                  'line': vehicle.get('name'), 'distance_m': section.get('distance'), 'duration_seconds': section.get('duration')})
            routes.append({'distance_m': item.get('distance'), 'duration_seconds': item.get('duration'), 'steps': steps[:16]})
        if not routes:
            raise ToolException('百度地图未找到该方式的路线，请确认起终点或更换出行方式')
        return provenance() | {'mode': mode, 'coordinate_system': 'bd09ll', 'routes': routes,
                               'note': '距离单位为米，时间单位为秒；路线耗时为查询时估算，实际通行情况会变化。'}
