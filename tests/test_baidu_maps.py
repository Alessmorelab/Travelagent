import json
from urllib.parse import parse_qs, urlsplit

import pytest
import requests
from langchain_core.messages import AIMessage
from langchain_core.language_models.fake_chat_models import FakeListChatModel, FakeMessagesListChatModel
from langchain_core.tools import ToolException

from backend.app.services.baidu_maps import BaiduMaps, encoded_query
from backend.app.tools.baidu import get_baidu_weather, plan_baidu_route
from backend.app.tools.catalog import tools_for, travel_services_status


@pytest.fixture(autouse=True)
def direct_api_mode(monkeypatch):
    monkeypatch.setenv('BAIDU_MAP_TRANSPORT', 'webapi')


def response(payload, status=200):
    class Result:
        status_code = status
        def json(self):
            return payload
    return Result()


def test_sn_matches_official_baidu_signature_example():
    # Public example in Baidu's Web API appendix, not application credentials.
    query = encoded_query('/geocoder/v2/', {'address': '百度大厦'}, 'yourak', 'yoursk')
    assert parse_qs(query)['sn'] == ['7de5a22212ffaa9e326444c75a58f9a0']
    assert query.endswith('&sn=7de5a22212ffaa9e326444c75a58f9a0')
    assert 'yoursk' not in query


def test_place_results_preserve_coordinates_and_never_become_hotel_quotes():
    calls = []
    def transport(url, **options):
        calls.append((url, options))
        return response({'status': 0, 'results': [
            {'name': '测试酒店', 'address': '测试路', 'location': {'lat': 30.5, 'lng': 114.3}, 'price': 99},
            {'name': '无坐标结果'}]})
    data = BaiduMaps('private-ak', transport=transport).search('酒店', '武汉')
    assert data['places'][0]['coordinate_system'] == 'bd09ll'
    assert data['places'][0]['latitude'] == 30.5
    assert len(data['places']) == 1
    assert 'price' not in data['places'][0]
    assert '实时房态' in data['note']
    assert 'private-ak' not in json.dumps(data)
    parsed = urlsplit(calls[0][0])
    assert parsed.scheme == 'https' and parsed.netloc == 'api.map.baidu.com'
    assert parse_qs(parsed.query)['city_limit'] == ['true']
    assert calls[0][1]['timeout'] == (5, 15) and calls[0][1]['allow_redirects'] is False


def test_weather_preserves_returned_dates_and_unavailable_observations():
    def transport(url, **options):
        parameters = parse_qs(urlsplit(url).query)
        assert parameters['city'] == ['武汉市'] and parameters['district'] == ['武昌区']
        return response({'status': 0, 'result': {'location': {'city': '武汉市', 'name': '武昌区'},
                        'now': {'text': '晴', 'temp': 999999, 'uptime': '20261017180000'},
                        'forecasts': [{'date': '2026-10-18', 'text_day': '多云', 'high': 25, 'low': 17}]}})
    data = BaiduMaps('private-ak', transport=transport).weather('武汉市', '武昌区')
    assert data['now']['temp'] is None
    assert data['forecasts'][0]['date'] == '2026-10-18'
    assert data['now']['uptime'] == '20261017180000'


def test_route_uses_baidu_latitude_longitude_order_and_cleans_instructions():
    def transport(url, **options):
        parameters = parse_qs(urlsplit(url).query)
        assert parameters['origin'] == ['30.500000,114.300000']
        assert parameters['destination'] == ['30.600000,114.400000']
        assert parameters['coord_type'] == ['bd09ll']
        return response({'status': 0, 'result': {'routes': [{'distance': 1000, 'duration': 800,
                        'steps': [{'instruction': '沿<b>测试路</b>步行&amp;转弯', 'distance': 300}]}]}})
    data = BaiduMaps('private-ak', transport=transport).route(30.5, 114.3, 30.6, 114.4)
    assert data['routes'][0]['distance_m'] == 1000
    assert data['routes'][0]['steps'][0]['instruction'] == '沿测试路步行&转弯'
    with pytest.raises(ToolException, match='坐标无效'):
        BaiduMaps('private-ak', transport=transport).route(200, 114, 30, 114)


@pytest.mark.parametrize('status,expected', [(220, 'Referer'), (210, '出口 IP'), (211, 'BAIDU_MAP_SK'), (240, '勾选'), (302, '配额')])
def test_provider_errors_are_actionable_and_cannot_echo_credentials(status, expected):
    client = BaiduMaps('private-ak', 'private-sk', transport=lambda *a, **k: response(
        {'status': status, 'message': 'secret private-ak private-sk'}))
    with pytest.raises(ToolException, match=expected) as error:
        client.weather('武汉')
    assert 'private-ak' not in str(error.value) and 'private-sk' not in str(error.value)


def test_network_error_drops_the_sensitive_provider_url_and_exception_context():
    def transport(*args, **kwargs):
        raise requests.ConnectionError('https://api.map.baidu.com/?ak=private-ak')
    with pytest.raises(ToolException, match='网络') as error:
        BaiduMaps('private-ak', transport=transport).weather('武汉')
    assert 'private-ak' not in str(error.value)
    assert error.value.__context__ is None


def test_tool_validation_and_provider_selection(monkeypatch):
    monkeypatch.setenv('BAIDU_MAP_AK', 'private-ak')
    monkeypatch.delenv('AMADEUS_CLIENT_ID', raising=False)
    monkeypatch.delenv('AMADEUS_CLIENT_SECRET', raising=False)
    assert {tool.name for tool in tools_for('destinations')} == {
        'travel_services_status', 'search_baidu_places', 'get_baidu_weather', 'plan_baidu_route'}
    assert {tool.name for tool in tools_for('flights')} == {'travel_services_status'}
    assert {tool.name for tool in tools_for('hotels')} == {'travel_services_status', 'search_baidu_places'}
    assert 'private-ak' not in json.dumps(travel_services_status.invoke({}))
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        plan_baidu_route.invoke({'origin_latitude': 100, 'origin_longitude': 114,
                                'destination_latitude': 30, 'destination_longitude': 114})


@pytest.mark.asyncio
async def test_real_graph_calls_baidu_tool_and_reports_only_public_events(monkeypatch):
    from backend.app.graphs import travel
    monkeypatch.setenv('BAIDU_MAP_AK', 'private-ak')
    monkeypatch.delenv('AMADEUS_CLIENT_ID', raising=False)
    monkeypatch.delenv('AMADEUS_CLIENT_SECRET', raising=False)
    monkeypatch.setattr(BaiduMaps, 'weather', lambda self, city, district='': {'now': {'text': '晴'}, 'source': '百度地图'})
    class Worker(FakeMessagesListChatModel):
        def bind_tools(self, tools, **kwargs):
            assert get_baidu_weather in tools
            return self
    models = iter([Worker(responses=[AIMessage(content='', tool_calls=[{'name': 'get_baidu_weather',
                   'args': {'city': '武汉市', 'district': '武昌区'}, 'id': 'weather-call', 'type': 'tool_call'}]),
                   AIMessage(content='PRIVATE_WORKER 天气晴')]), FakeListChatModel(responses=['武汉天气晴，来源：百度地图。'])])
    graph = travel.build_graph('destinations', model_factory=lambda _: next(models))
    monkeypatch.setattr(travel, 'graph_for', lambda _: graph)
    events = [event async for event in travel.stream_travel('destinations', [], '查询武汉天气')]
    assert any(item.get('label') == '百度地图：查询天气' for item in events)
    assert 'PRIVATE_WORKER' not in str(events) and 'private-ak' not in str(events)
    assert next(item for item in events if item['type'] == 'final')['content'] == '武汉天气晴，来源：百度地图。'
