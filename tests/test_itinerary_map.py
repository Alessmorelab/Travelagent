import json
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi.testclient import TestClient
from langchain_core.tools import ToolException

from backend.app.services.baidu_maps import BaiduMaps
from tests.test_baidu_maps import response


@pytest.mark.parametrize('mode', ['walking', 'driving', 'transit'])
def test_map_route_uses_returned_gcj02_geometry_instead_of_connecting_stops(mode):
    def transport(url, **_):
        params = parse_qs(urlsplit(url).query)
        assert params['coord_type'] == ['gcj02'] and params['ret_coordtype'] == ['gcj02']
        assert params['steps_info'] == ['1'] and params['origin'] == ['30.500000,114.300000']
        assert urlsplit(url).path.endswith('/' + mode)
        steps = [{'path': '114.30,30.50;114.31,30.51'}, {'path': '114.31,30.51;114.32,30.52'}]
        if mode == 'transit':
            steps = [[item] for item in steps]
        return response({'status': 0, 'result': {'routes': [{'distance': 1800, 'duration': 1000, 'steps': steps}]}})
    route = BaiduMaps('private-ak', transport=transport).route_for_wechat({'latitude': 30.5, 'longitude': 114.3}, {'latitude': 30.52, 'longitude': 114.32}, mode)
    assert route['points'] == [{'longitude': 114.3, 'latitude': 30.5}, {'longitude': 114.31, 'latitude': 30.51}, {'longitude': 114.32, 'latitude': 30.52}]
    assert route['coordinate_system'] == 'gcj02' and route['distance_m'] == 1800
    assert 'private-ak' not in json.dumps(route)


@pytest.mark.parametrize('path', ['', '114.3,30.5', 'NaN,30.5;114.4,30.6', 'oops;114.4,30.6'])
def test_missing_or_invalid_route_geometry_never_becomes_a_straight_line(path):
    client = BaiduMaps('test-ak', transport=lambda *_a, **_k: response({'status': 0, 'result': {'routes': [{'distance': 1, 'duration': 1, 'steps': [{'path': path}]}]}}))
    with pytest.raises(ToolException):
        client.route_for_wechat({'latitude': 30.5, 'longitude': 114.3}, {'latitude': 30.6, 'longitude': 114.4})


def test_authenticated_batch_map_api_preserves_success_and_retries_only_selected_segments(tmp_path, monkeypatch):
    from backend.app.main import app
    from backend.app.services.chat import get_chat_service
    monkeypatch.delenv('DATABASE_URL', raising=False)
    monkeypatch.setenv('TRAVEL_CHAT_DB', str(tmp_path / 'maps.db'))
    calls = []
    def search(_self, query, city):
        if query == '暂不可用':
            raise TimeoutError('private provider URL')
        return {'source': 'fixture', 'retrieved_at': 'test', 'coordinate_system': 'gcj02', 'places': [{'name': query, 'address': city, 'latitude': 30.5, 'longitude': 114.3}]}
    def route(_self, origin, destination, mode):
        calls.append(origin)
        if origin['latitude'] == 30.5:
            raise TimeoutError('private provider URL')
        return {'source': 'fixture', 'retrieved_at': 'test', 'coordinate_system': 'gcj02', 'points': [origin, destination], 'distance_m': 100, 'duration_seconds': 80}
    monkeypatch.setattr(BaiduMaps, 'search_for_wechat', search)
    monkeypatch.setattr(BaiduMaps, 'route_for_wechat', route)
    get_chat_service.cache_clear()
    with TestClient(app) as client:
        assert client.post('/api/v1/map/resolve', json={'city': '武汉', 'queries': ['黄鹤楼']}).status_code == 401
        token = client.post('/api/v1/chat/devices').json()['token']
        headers = {'Authorization': 'Bearer ' + token}
        resolved = client.post('/api/v1/map/resolve', headers=headers, json={'city': '武汉', 'queries': ['黄鹤楼', '暂不可用']}).json()['results']
        assert resolved[0]['places'][0]['name'] == '黄鹤楼'
        assert resolved[1]['failure']['kind'] == 'timeout' and 'private' not in json.dumps(resolved)
        stops = [{'latitude': lat, 'longitude': 114.3} for lat in [30.5, 30.6, 30.7]]
        legs = client.post('/api/v1/map/routes', headers=headers, json={'stops': stops}).json()['legs']
        assert legs[0]['failure']['kind'] == 'timeout' and len(legs[1]['points']) == 2
        calls.clear()
        result = client.post('/api/v1/map/routes', headers=headers, json={'stops': stops, 'segments': [1]})
        assert result.status_code == 200 and len(calls) == 1 and calls[0] == stops[1]
        assert client.post('/api/v1/map/routes', headers=headers, json={'stops': stops, 'segments': [3]}).status_code == 422
        assert client.post('/api/v1/map/routes', headers=headers, json={'stops': [{'latitude': True, 'longitude': 114.3}, stops[1]]}).status_code == 422
