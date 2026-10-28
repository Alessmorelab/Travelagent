// Extract only explicit day sections. Keep the original answer for review.
const cn = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
function dayNumber(value) {
  if (/^\d+$/.test(value)) return Number(value);
  if (cn[value]) return cn[value];
  const match = /^([一二]?)十([一二三四五六七八九]?)$/.exec(value);
  return match ? (match[1] ? cn[match[1]] * 10 : 10) + (match[2] ? cn[match[2]] : 0) : 0;
}
function clean(value) { return value.replace(/^\s*(?:[-*+]\s+)?/, '').replace(/\*\*/g, '').trim(); }

export function parseItinerary(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 30000) return null;
  const days = [], notes = [];
  let current = null, inCode = false, inNotes = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { inCode = !inCode; (current && !inNotes ? current.lines : notes).push(line); continue; }
    const heading = !inCode && /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:day\s*(\d+)|第\s*([\d一二三四五六七八九十]+)\s*天)(?:\*\*)?(?:\s*[·：:、—-]\s*|\s+)?(.*?)\s*$/i.exec(line);
    if (heading) {
      const number = dayNumber(heading[1] || heading[2]);
      if (inNotes || number !== days.length + 1 || number > 30) return null;
      current = { theme: clean(heading[3] || ''), lines: [] }; days.push(current); continue;
    }
    if (!inCode && current && /^\s*#{1,3}\s*(?:📌\s*)?(?:实用提醒|注意事项|温馨提示|预算|交通建议)/.test(line)) inNotes = true;
    (current && !inNotes ? current.lines : notes).push(line);
  }
  if (!days.length) return null;
  const result = [];
  for (const day of days) {
    const activities = []; let activity = null;
    for (const line of day.lines) {
      // Time slots are the headings produced by the current assistant prompt.
      const match = /^\s*(?:[-*+]\s+)?\*\*(上午|下午|中午|晚上|傍晚|早上|早晨|\d{1,2}:\d{2})\s*[｜|：:]\s*([^*\n]+)\*\*\s*(.*)$/.exec(line) || /^\s*(?:[-*+]\s+)?(上午|下午|中午|晚上|傍晚|早上|早晨|\d{1,2}:\d{2})\s*[｜|：:]\s*([^\n]+)$/.exec(line);
      if (match) {
        activity = { time: match[1], title: clean(match[2]), detail: (match[3] || '').trim(), icon: 'compass-outline' };
        if (!activity.title) return null;
        activities.push(activity);
      } else if (line.trim()) {
        if (!activity) { activity = { time: '时间待定', title: day.theme || '当天安排', detail: '', icon: 'compass-outline' }; activities.push(activity); }
        activity.detail = [activity.detail, line.trim()].filter(Boolean).join('\n');
      }
    }
    if (!activities.length && day.theme) activities.push({ time: '时间待定', title: day.theme, detail: '', icon: 'compass-outline' });
    if (!activities.length || activities.length > 50) return null;
    result.push(activities);
  }
  return { days: result, notes: notes.join('\n').trim(), sourceText: text };
}
