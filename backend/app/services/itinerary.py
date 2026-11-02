"""Versioned itinerary data extracted from explicit day/slot headings.

Coordinates are deliberately absent here. A place binding can only be added
after a real map lookup, including disambiguation, by the mini-program.
"""
import json
import re
from backend.app.services.activity_slots import expand_activities


def itinerary_from_answer(text, evidence=()):
    if not isinstance(text, str) or len(text) > 30000:
        return None
    days, notes, activity = [], [], None
    in_notes = in_code = False
    destination = ''
    for raw in evidence:
        try:
            data = json.loads(raw.split('\n', 1)[1])
            candidate = data.get('city') or data.get('data', {}).get('city')
            if isinstance(candidate, str) and len(candidate) <= 60:
                destination = candidate
        except (ValueError, TypeError, AttributeError, IndexError):
            pass
    if not destination:
        match = re.search(r'^##\s*[^\w\u4e00-\u9fff]*([\w\u4e00-\u9fff· ]{1,40}?)(?:\d+|[一二三四五六七八九十]+)\s*[日天](?:精华|精选|深度|慢游)?(?:游|行程)', text, re.M)
        if match:
            destination = match[1].strip()
    for line in text.splitlines():
        if re.match(r'^\s*```', line):
            in_code = not in_code
            continue
        if in_code:
            continue
        day = re.match(r'^\s*#{1,6}\s*Day\s*(\d+)\b', line, re.I)
        if day:
            if in_notes or int(day[1]) != len(days) + 1 or len(days) >= 30:
                return None
            days.append([])
            activity = None
            continue
        if days and re.match(r'^\s*#{1,3}\s*(?:📌\s*)?(?:实用提醒|注意事项|温馨提示|预算|交通建议)', line):
            in_notes = True
        slot = re.match(r'^\s*(?:[-*+]\s+)?\*\*(上午|下午|中午|晚上|傍晚|早上|早晨|\d{1,2}:\d{2})\s*[｜|：:]\s*([^*\n]{1,100})\*\*\s*(.*)$', line)
        if slot and days and not in_notes:
            activity = {'time': slot[1], 'title': slot[2].strip(), 'detail': slot[3].strip(), 'icon': 'compass-outline'}
            days[-1].append(activity)
        elif line.strip():
            if activity and not in_notes:
                activity['detail'] = (activity['detail'] + '\n' + line.strip()).strip()
            else:
                notes.append(line)
    days = [expand_activities(day) for day in days]
    if not days or any(not day or len(day) > 50 for day in days):
        return None
    return {'schema_version': 1, 'destination': destination, 'days': days, 'notes': '\n'.join(notes).strip()}
