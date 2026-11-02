"""回归测试：地点拆分、查询依据脱敏和流式回答核验。"""
from datetime import datetime
import json
from zoneinfo import ZoneInfo

from backend.app.services.activity_slots import expand_activities, title_parts
from backend.app.services.evidence import clean_tool_text, query_receipts
from backend.app.services.grounding import GroundedAnswerText, correct_relative_dates, guard_answer
from backend.app.services.itinerary import itinerary_from_answer

NOW = datetime(2026, 11, 1, 13, tzinfo=ZoneInfo('Asia/Shanghai'))


def test_joint_stops_and_alternatives_preserve_their_meaning():
    assert title_parts('黄鹤楼 & 户部巷') == (['黄鹤楼', '户部巷'], False)
    assert title_parts('美术馆（汉口馆）或 公园') == (['美术馆（汉口馆）', '公园'], True)
    assert title_parts('书店（A & B馆）') == (['书店（A & B馆）'], False)
    assert title_parts('R&B咖啡') == (['R&B咖啡'], False)
    assert title_parts('公园A + 公园B 或 美术馆') == (['公园A + 公园B 或 美术馆'], False)
    result = expand_activities([{'title': '黄鹤楼 & 户部巷', 'time': '上午', 'detail': '', 'place': {'name': '黄鹤楼'}}])
    assert len(result) == 2 and 'place' in result[0] and 'place' not in result[1]
    answer = '## 🧭 武汉2日精华行程\n### Day 1 · 老城\n**上午｜黄鹤楼 + 户部巷**\n游览建议。\n### Day 2 · 城市漫步\n**下午｜美术馆或公园**\n按兴趣选择。'
    itinerary = itinerary_from_answer(answer)
    assert itinerary['destination'] == '武汉'
    assert [item['title'] for item in itinerary['days'][0]] == ['黄鹤楼', '户部巷']
    assert itinerary['days'][1][0]['alternatives'] == ['美术馆', '公园']


def test_query_receipts_keep_fields_but_redact_credentials(monkeypatch):
    secret = 'unit-test-credential-value'
    monkeypatch.setenv('BAIDU_MAP_AK', secret)
    raw = json.dumps({'source': 'fixture', 'ak': secret, 'apiKey': secret,
        'headers': {'authorization': 'Bearer token-not-for-display'},
        'url': 'https://example.invalid/query?ak=' + secret,
        'results': [{'name': '酒店甲', 'detail_info': {'overall_rating': '4.5'}}]}, ensure_ascii=False)
    sources = query_receipts(['地点查询 的工具返回：\n' + clean_tool_text(raw)], NOW)
    serialized = json.dumps(sources, ensure_ascii=False)
    assert secret not in serialized and 'token-not-for-display' not in serialized and '?ak=' not in serialized
    fact = next(item for item in sources[0]['facts'] if item['kind'] == 'rating')
    assert fact['value'] == '4.5' and fact['subject'] == '酒店甲'
    assert fact['field'] == 'results[0].detail_info.overall_rating'


def test_rating_cannot_be_reused_for_another_hotel_or_rounded_up():
    sources = query_receipts(['地点查询 的工具返回：\n' + json.dumps({
        'results': [{'name': '酒店甲', 'overall_rating': '4.8'}]}, ensure_ascii=False)], NOW)
    answer, notes = guard_answer('酒店甲评分4.8 [E1]\n酒店乙评分4.8 [E1]\n酒店甲评分5 [E1]', sources, NOW)
    assert '酒店甲评分4.8' in answer and '酒店乙评分待确认' in answer and '酒店甲评分待确认' in answer
    assert notes


def test_stream_and_final_both_hide_unsupported_precise_details():
    raw = '<think>PRIVATE</think>行程建议\n打车20–30元，步行97米，耗时50分钟，评分4.8，14路，C口出。\n黄鹤楼开放08:30-18:00。[E99]'
    expected, _ = guard_answer(raw, [], NOW)
    for boundary in range(len(raw) + 1):
        guard = GroundedAnswerText([], NOW)
        public = guard.feed(raw[:boundary]) + guard.feed(raw[boundary:]) + guard.finish()
        assert public == expected
        assert not any(value in public for value in ('20–30元', '97米', '50分钟', '评分4.8', '14路', 'C口', '08:30', 'PRIVATE', '[E99]'))


def test_current_clock_corrects_relative_dates_and_old_weather_is_not_evidence():
    assert correct_relative_dates('11月1日（明天）', NOW) == '11月1日（今天）'
    assert correct_relative_dates('11月2日（今天）', NOW) == '11月2日（明天）'
    assert correct_relative_dates('2027年11月1日（明天）', NOW) == '2027年11月1日'
    leap = datetime(2028, 2, 29, tzinfo=ZoneInfo('Asia/Shanghai'))
    assert correct_relative_dates('2月29日（明天）', leap) == '2月29日（今天）'
    answer, notes = guard_answer('根据之前查询，11月1日（明天）中雨。', [], NOW)
    assert '中雨' not in answer and '待确认' in answer and notes


def test_user_budgets_and_proposed_visit_lengths_are_not_quotes():
    text = '总预算8000元，建议停留2小时。'
    assert guard_answer(text, [], NOW)[0] == text
