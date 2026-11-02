export function titleParts(title) {
  const pieces = [], operators = [];
  let start = 0, depth = 0;
  const pattern = /[()（）\[\]【】]|或者|或|[+＋&＆、]|\s+(?:and|or|与|和|及)\s+/gi;
  for (const match of title.matchAll(pattern)) {
    const token = match[0];
    if ('(（[【'.includes(token)) { depth++; continue; }
    if (')）]】'.includes(token)) { depth = Math.max(0, depth - 1); continue; }
    if (depth) continue;
    const left = title[match.index - 1] || '', right = title[match.index + token.length] || '';
    if ('+＋&＆'.includes(token) && !(/\s/.test(left) || /\s/.test(right) || /[\u4e00-\u9fff]/.test(left) && /[\u4e00-\u9fff]/.test(right))) continue;
    pieces.push(title.slice(start, match.index).trim());
    operators.push(['or', '或', '或者'].includes(token.trim().toLowerCase()) ? 'or' : 'and');
    start = match.index + token.length;
  }
  pieces.push(title.slice(start).trim());
  return pieces.some((item) => !item) || pieces.length > 6 || operators.includes('or') && operators.includes('and')
    ? { parts: [title], choice: false } : { parts: pieces, choice: operators.includes('or') };
}

export function expandActivities(activities) {
  return activities.flatMap((activity) => {
    const { parts, choice } = titleParts(activity.title);
    if (parts.length === 1) return [{ ...activity }];
    if (choice) return [{ ...activity, alternatives: parts }];
    return parts.map((title) => {
      const item = { ...activity, title, groupTitle: activity.title };
      delete item.alternatives;
      if (item.place?.name !== title) delete item.place;
      return item;
    });
  });
}

export function expandTrip(trip) {
  const completed = [], days = trip.days.map((activities, day) => {
    const result = [];
    activities.forEach((activity, index) => {
      const expanded = expandActivities([activity]);
      if (trip.completed.includes(`${day}-${index}`)) expanded.forEach((_, offset) => completed.push(`${day}-${result.length + offset}`));
      result.push(...expanded);
    });
    return result;
  });
  return { ...trip, days, completed };
}
