"""Conservative checks for identifiable precise claims, shared by stream/final.

This is a field-level guard, not a general semantic fact checker. Unrecognized
descriptive claims still require the user's judgment and provider verification.
"""
from datetime import datetime, date
import re
from zoneinfo import ZoneInfo

from backend.app.core.answers import PublicAnswerText
from backend.app.services.evidence import METRICS

RELATIVE_DATE = re.compile(r'(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日\s*[（(](今天|明天|后天|昨天)[）)]')
MISSING = {'price': '费用待确认', 'distance': '距离待确认', 'duration': '耗时待确认',
           'rating': '评分待确认', 'exit': '出口待确认', 'transit': '线路待确认', 'hours': '开放时间待确认', 'weather': '天气预报待确认'}


def _number(value):
    try:
        return float(value)
    except (ValueError, TypeError):
        return None


def _metric_values(fact, target_unit):
    value = _number(fact['value'])
    if value is None:
        return {fact['value']}
    unit, kind = fact['unit'].lower(), fact['kind']
    if kind == 'duration':
        seconds = value * (3600 if unit in {'小时', 'hour', 'hours'} else 60 if unit in {'分钟', 'minute', 'minutes'} else 1)
        value = seconds / (3600 if target_unit in {'小时', 'hour', 'hours'} else 60 if target_unit in {'分钟', 'minute', 'minutes'} else 1)
    elif kind == 'distance':
        meters = value * (1000 if unit in {'公里', '千米', 'km'} else 1)
        value = meters / (1000 if target_unit in {'公里', '千米', 'km'} else 1)
    elif kind == 'price':
        currencies = {'元': 'cny', '人民币': 'cny', 'rmb': 'cny', 'cny': 'cny', '美元': 'usd', 'usd': 'usd'}
        if not unit or currencies.get(unit, unit) != currencies.get(target_unit.lower(), target_unit.lower()):
            return set()
    values = {str(value), f'{value:g}'}
    if kind in {'distance', 'duration'}:
        values.update({str(round(value)), str(round(value, 1)), str(round(value, 2))})
    return values


def correct_relative_dates(text, now):
    today = now.date()
    def replace(match):
        try:
            candidates = []
            years = [int(match[1])] if match[1] else (today.year - 1, today.year, today.year + 1)
            for year in years:
                try:
                    candidates.append(date(year, int(match[2]), int(match[3])))
                except ValueError:
                    continue
            actual = min(candidates, key=lambda value: abs((value - today).days))
        except ValueError:
            return '日期待确认'
        prefix = f'{match[1]}年' if match[1] else ''
        absolute = f'{prefix}{int(match[2])}月{int(match[3])}日'
        relative = {-1: '昨天', 0: '今天', 1: '明天', 2: '后天'}.get((actual - today).days)
        return absolute + (f'（{relative}）' if relative else '')
    return RELATIVE_DATE.sub(replace, text)


class GroundedAnswerText:
    def __init__(self, sources, now=None):
        self.sources = sources
        self.now = now or datetime.now(ZoneInfo('Asia/Shanghai'))
        self.parser = PublicAnswerText()
        self.pending = ''
        self.context = ''
        self.heading = ''
        self.notes = {}

    def note(self, kind):
        self.notes[kind] = {'kind': 'unverified_detail', 'message': MISSING.get(kind, '信息待确认'),
                            'retryable': False, 'stage': 'answer_check', 'label': '回答核验'}

    def line(self, text):
        text = correct_relative_dates(text, self.now)
        cited = set(re.findall(r'\[(E\d+)\]', text))
        by_id = {source['id']: source for source in self.sources}
        text = re.sub(r'\[(E\d+)\]', lambda m: m[0] if m[1] in by_id else '［依据待确认］', text)
        sources = [source for source in self.sources if not cited or source['id'] in cited]
        canonical = lambda value: re.sub(r'[\s*#【】\[\]()（）]', '', value).lower()
        current = canonical(text)
        context = canonical(self.heading + text)
        mentioned = {canonical(fact.get('subject', '')) for source in self.sources for fact in source['facts']
                     if fact.get('subject') and canonical(fact['subject']) in current}
        used = set()

        def supported(kind, value, unit):
            for source in sources:
                for fact in source['facts']:
                    if fact['kind'] != kind:
                        continue
                    subject = canonical(fact.get('subject', ''))
                    # A rating for one named hotel cannot establish another's.
                    if subject and (subject not in context or mentioned and subject not in mentioned):
                        continue
                    if not subject and source['id'] not in cited:
                        continue
                    if value in _metric_values(fact, unit):
                        used.add(source['id'])
                        return True
            return False

        for kind, pattern in METRICS.items():
            def replace(match):
                unit = match[2] or '' if match.lastindex >= 2 else ''
                # User budgets and proposed schedules are plans, not quotes.
                prefix = text[max(0, match.start() - 16):match.start()]
                if kind == 'price' and re.search(r'预算|计划花费', prefix):
                    return match[0]
                if kind == 'duration' and re.search(r'(?:建议|安排|计划|预留)(?:游玩|停留|参观|时间|时长|约|为|\s)*$', prefix):
                    return match[0]
                if supported(kind, match[1], unit):
                    return match[0]
                self.note(kind)
                return MISSING[kind]
            text = pattern.sub(replace, text)

        if re.search(r'开放|营业|入园|开馆|闭馆|休馆', text):
            time_pattern = re.compile(r'\d{1,2}[:：]\d{2}(?:\s*[-–—~至]\s*\d{1,2}[:：]\d{2})?')
            def hours(match):
                for source in sources:
                    for fact in source['facts']:
                        if fact['kind'] == 'hours' and match[0].replace('：', ':') in fact['value'].replace('：', ':'):
                            if fact['subject'] and fact['subject'].lower() not in context:
                                continue
                            used.add(source['id']); return match[0]
                self.note('hours'); return MISSING['hours']
            text = time_pattern.sub(hours, text)
            closure = re.compile(r'(?:每)?(?:周|星期)[一二三四五六日天][^。；\n]{0,10}(?:闭馆|休馆)')
            def closed(match):
                for source in sources:
                    if any(fact['kind'] == 'hours' and match[0] in fact['value'] for fact in source['facts']):
                        used.add(source['id']); return match[0]
                self.note('hours'); return '闭馆安排待确认'
            text = closure.sub(closed, text)

        weather = [source for source in self.sources if any(fact['kind'] == 'weather' for fact in source['facts'])]
        specific_weather = re.search(r'中雨|大雨|小雨|暴雨|降雨|转晴|气温\s*(?:为|约)?\s*-?\d|\d\s*[℃°]|(?:今天|明天|后天|\d月\d+日).{0,10}(?:晴|阴|多云)', text)
        hypothetical = re.search(r'如果|若(?:遇|有|是|下)|如遇|遇到|可能|建议.*(?:雨天|晴天)|预报.*(?:待确认|未查询)', text)
        if specific_weather and not hypothetical:
            date_tokens = re.findall(r'(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日', text)
            covered_dates = {fact['date'][5:10] for source in weather for fact in source['facts'] if re.match(r'\d{4}-\d{2}-\d{2}', fact['date'])}
            outside = any(f'{int(month):02}-{int(day):02}' not in covered_dates for _, month, day in date_tokens)
            states = re.findall(r'雷阵雨|大暴雨|暴雨|中雨|小雨|阵雨|晴|多云|阴|大雪|小雪', text)
            actual = ' '.join(fact['value'] for source in weather for fact in source['facts'])
            conflicting = any(state not in actual for state in states)
            temperatures = re.findall(r'(-?\d+(?:\.\d+)?)\s*(?:℃|摄氏度|°)', text)
            actual_temperatures = {value for source in weather for fact in source['facts'] if fact['unit'] == '℃' for value in _metric_values(fact, '℃')}
            conflicting = conflicting or any(value not in actual_temperatures for value in temperatures)
            if not weather or outside or conflicting:
                self.note('weather')
                text = '天气预报待确认：本次没有取得覆盖上述日期的预报，请在出行前查询。'
                used.clear()
            else:
                used.add(weather[0]['id'])
        if used:
            missing = sorted(used - set(re.findall(r'\[(E\d+)\]', text)))
            if missing:
                text += ' ' + ' '.join(f'[{value}]' for value in missing)
        self.context = (self.context + '\n' + text)[-500:]
        if re.match(r'^\s*(?:#{1,6}\s|\*\*[^*]+\*\*\s*$)', text):
            self.heading = text
        return text

    def feed(self, chunk):
        self.pending += self.parser.feed(chunk)
        result = []
        while '\n' in self.pending:
            line, self.pending = self.pending.split('\n', 1)
            result.append(self.line(line) + '\n')
        return ''.join(result)

    def finish(self):
        text, self.pending = self.pending, ''
        return self.line(text) if text else ''


def guard_answer(text, sources, now=None):
    guard = GroundedAnswerText(sources, now)
    answer = guard.feed(text) + guard.finish()
    return answer, list(guard.notes.values())
