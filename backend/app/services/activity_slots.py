"""Split explicit joint stops, keeping alternatives as a single choice."""
import re


def title_parts(title):
    # Bracketed names such as “美术馆（汉口馆）” remain intact. Ampersands
    # in Latin brand names (e.g. R&B) are not treated as itinerary separators.
    pieces, operators, start, depth = [], [], 0, 0
    for match in re.finditer(r'[()（）\[\]【】]|或者|或|[+＋&＆、]|\s+(?:and|or|与|和|及)\s+', title, re.I):
        token = match[0]
        if token in '(（[【':
            depth += 1
            continue
        if token in ')）]】':
            depth = max(0, depth - 1)
            continue
        if depth:
            continue
        left = title[match.start() - 1] if match.start() else ''
        right = title[match.end()] if match.end() < len(title) else ''
        if token in '+＋&＆' and not (left.isspace() or right.isspace() or re.match(r'[\u4e00-\u9fff]', left) and re.match(r'[\u4e00-\u9fff]', right)):
            continue
        pieces.append(title[start:match.start()].strip())
        operators.append('or' if token.strip().lower() in {'or', '或', '或者'} else 'and')
        start = match.end()
    pieces.append(title[start:].strip())
    if any(not item for item in pieces) or len(pieces) > 6 or 'or' in operators and 'and' in operators:
        return [title], False
    return pieces, 'or' in operators


def expand_activities(activities):
    result = []
    for activity in activities:
        parts, choice = title_parts(activity['title'])
        if len(parts) == 1:
            result.append(dict(activity))
        elif choice:
            result.append({**activity, 'alternatives': parts})
        else:
            for title in parts:
                item = {**activity, 'title': title, 'groupTitle': activity['title']}
                item.pop('alternatives', None)
                # A legacy binding must not be copied to every split stop.
                if item.get('place', {}).get('name') != title:
                    item.pop('place', None)
                result.append(item)
    return result
