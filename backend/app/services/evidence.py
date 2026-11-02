"""Public query receipts: bounded, redacted fields, never credentials or prompts."""
from datetime import datetime
import json
import math
import os
import re
from urllib.parse import urlsplit, urlunsplit
from zoneinfo import ZoneInfo

SENSITIVE = re.compile(r'(^|[_-])(ak|sk|key|secret|token|password|authorization|cookie|openid|appid)($|[_-])', re.I)
NUMBER = r'\d+(?:\.\d+)?'
METRICS = {
    'price': re.compile(rf'({NUMBER}(?:\s*[-–—~至]\s*{NUMBER})?)\s*(元|人民币|CNY|RMB|USD|美元)', re.I),
    'distance': re.compile(rf'({NUMBER})\s*(公里|千米|米|km|m)(?![a-z])', re.I),
    'duration': re.compile(rf'({NUMBER})\s*(分钟|小时|秒|minutes?|hours?)', re.I),
    'rating': re.compile(rf'(?:评分|rating)\s*[:：]?\s*({NUMBER})\s*(分)?', re.I),
    'exit': re.compile(r'([A-Z]\d?(?:/[A-Z]\d?)?)\s*(?:出口|口)'),
    'transit': re.compile(r'(\d+(?:/\d+)*)\s*(?:号线|路)'),
}


def redact(value):
    secrets = [text.strip() for key, text in os.environ.items()
               if re.search(r'KEY|SECRET|PASSWORD|TOKEN|_AK$|_SK$', key) and len(text.strip()) >= 8]
    budget = [18000]
    def clean_url(match):
        try:
            url = urlsplit(match[0])
            return urlunsplit((url.scheme, url.hostname or '', url.path, '', ''))
        except ValueError:
            return '[链接已省略]'
    def clean_text(text):
        for secret in secrets:
            text = text.replace(secret, '[REDACTED]')
        text = re.sub(r'(?i)\bauthorization\s*[=:]\s*(?:Bearer\s+)?[^\s,;&]+', '[REDACTED]', text)
        text = re.sub(r'(?i)\b(?:api[_-]?key|access[_-]?token|ak|sk)\s*[=:]\s*[^\s,;&]+', '[REDACTED]', text)
        text = re.sub(r'https?://[^\s\"<>]+', clean_url, text)
        text = re.sub(r'/Users/[^\s\"\'<>]+', '[本机路径已省略]', text)
        text = re.sub(r'(?i)\b(?:sk-[a-z0-9_-]{16,}|gh[pousr]_[a-z0-9]{25,}|github_pat_[a-z0-9_]{30,})', '[REDACTED]', text)
        return text
    def visit(item, depth=0):
        if depth > 12 or budget[0] <= 0:
            return '[数据层级已省略]'
        budget[0] -= 4
        if isinstance(item, dict):
            result = {}
            for key, value in list(item.items())[:60]:
                if budget[0] <= 0:
                    break
                if SENSITIVE.search(str(key)) or re.search(r'apikey|accesstoken|secretkey|clientsecret', str(key), re.I):
                    continue
                budget[0] -= len(str(key)) + 8
                result[str(key)[:100]] = visit(value, depth + 1)
            return result
        if isinstance(item, list):
            result = []
            for value in item[:40]:
                if budget[0] <= 0:
                    break
                result.append(visit(value, depth + 1))
            return result
        if isinstance(item, str):
            clean = clean_text(item)[:min(12000, max(0, budget[0]))]
            budget[0] -= len(clean) + 4
            return clean
        if item is None or isinstance(item, (bool, int)):
            return item
        if isinstance(item, float):
            return item if math.isfinite(item) else None
        return clean_text(str(item))[:300]
    return visit(value)


def clean_tool_text(text):
    try:
        return json.dumps(redact(json.loads(text)), ensure_ascii=False)
    except (ValueError, TypeError):
        return redact(text)


def query_receipts(evidence, now=None):
    now = now or datetime.now(ZoneInfo('Asia/Shanghai'))
    receipts = []
    for raw in evidence[:12]:
        label, _, text = raw.partition('\n')
        label = label.split(' 的工具返回', 1)[0]
        try:
            data = redact(json.loads(text))
        except (ValueError, TypeError):
            data = redact(text)
        meta = data if isinstance(data, dict) else {}
        record = {'id': f'E{len(receipts) + 1}', 'label': label[:80],
            'source': str(meta.get('source') or label)[:100],
            'retrieved_at': str(meta.get('retrieved_at') or '')[:80],
            'received_at': now.isoformat(timespec='seconds'), 'facts': []}
        query = meta.get('query') or meta.get('city') or meta.get('mode')
        if isinstance(query, str):
            record['query'] = query[:120]
        facts = record['facts']

        def add(kind, value, unit, path, subject='', date=''):
            if len(facts) < 48:
                facts.append({'kind': kind, 'value': str(value)[:180], 'unit': unit, 'field': path[:140],
                              'subject': subject[:100], 'date': str(date)[:30]})

        def walk(item, path='', subject='', date='', currency=''):
            if isinstance(item, dict):
                subject = str(item.get('name') or item.get('hotel_name') or subject)
                date = item.get('date') or date
                if not date and re.match(r'^\d{8}', str(item.get('uptime', ''))):
                    stamp = str(item['uptime']); date = f'{stamp[:4]}-{stamp[4:6]}-{stamp[6:8]}'
                currency = str(item.get('currency') or currency)
                for key, value in item.items():
                    field = f'{path}.{key}' if path else key
                    lower = key.lower()
                    number = isinstance(value, (int, float)) and not isinstance(value, bool)
                    if isinstance(value, str):
                        number = bool(re.fullmatch(NUMBER, value.strip()))
                    if number:
                        if re.search(r'rating|评分', lower):
                            add('rating', value, '分', field, subject, date)
                        elif re.search(r'distance|距离', lower):
                            add('distance', value, '米', field, subject, date)
                        elif re.search(r'duration|耗时', lower):
                            add('duration', value, '秒', field, subject, date)
                        elif re.search(r'price|fee|fare|cost|价格', lower) or lower in {'total', 'value', 'amount'} and re.search(r'price|fare|fee', path, re.I):
                            add('price', value, currency or ('元' if '百度' in record['source'] else ''), field, subject, date)
                        elif lower in {'temp', 'high', 'low', 'feels_like'} and str(value) != '999999':
                            add('weather', value, '℃', field, subject, date)
                    if isinstance(value, str):
                        if re.search(r'open|business|营业|开放|闭馆', field, re.I):
                            add('hours', value, '', field, subject, date)
                        if re.search(r'price|fee|fare|cost|价格', lower):
                            for match in METRICS['price'].finditer(value):
                                add('price', match[1], match[2], field, subject, date)
                        if lower in {'text_day', 'text_night', 'weather', 'text'} and re.search(r'weather|天气|forecast', label + field, re.I):
                            add('weather', value, '', field, subject, date)
                        # Exact route instructions can establish exits, lines,
                        # distances and duration, but never a hotel rating.
                        if re.search(r'instruction|路线描述', lower):
                            for kind, pattern in METRICS.items():
                                if kind == 'rating':
                                    continue
                                for match in pattern.finditer(value):
                                    add(kind, match[1], match[2] if match.lastindex >= 2 and match[2] else '', field, subject, date)
                    walk(value, field, subject, date, currency)
            elif isinstance(item, list):
                for index, value in enumerate(item[:20]):
                    walk(value, f'{path}[{index}]', subject, date, currency)
        walk(data)
        # Keep a small, redacted receipt rather than an SDK trace or full payload.
        record['excerpt'] = (json.dumps(data, ensure_ascii=False) if not isinstance(data, str) else data)[:1600]
        receipts.append(record)
    return receipts
