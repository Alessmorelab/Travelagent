import { titleParts } from './activity-slots.mjs';
import { validPlace } from './map-data.mjs';
import { tripEndDate } from './trip-details.mjs';

export const MAX_DAY_ACTIVITIES = 12;
export const MAX_ADJUSTMENT_TARGETS = 4;

export function isProtectedActivity(trip, day, index) {
  return trip.days[day]?.[index]?.locked === true || trip.completed.includes(`${day}-${index}`);
}

export function dayRevision(trip, day) {
  return JSON.stringify([trip.id, trip.destination, trip.startDate, trip.days[day],
    trip.completed.filter((key) => key.startsWith(`${day}-`)).sort()]);
}

function checkTargets(trip, day, targets) {
  const activities = trip.days[day];
  if (trip.sample || !Number.isInteger(day) || !activities?.length || activities.length > MAX_DAY_ACTIVITIES) {
    throw new Error('请选择包含1–12项安排的非示例行程日期');
  }
  if (!Array.isArray(targets) || !targets.length || targets.length > MAX_ADJUSTMENT_TARGETS || new Set(targets).size !== targets.length
      || targets.some((i) => !Number.isInteger(i) || !activities[i] || isProtectedActivity(trip, day, i))) {
    throw new Error('请选择1–4项未锁定且未完成的安排');
  }
  return activities;
}

export function makeDayAdjustmentRequest(trip, day, targets, instruction) {
  const activities = checkTargets(trip, day, targets);
  const request = instruction.trim();
  if (!request || request.length > 600) throw new Error('请填写调整要求，最多600字');
  return { destination: trip.destination, day: day + 1, date: tripEndDate(trip.startDate, day + 1) || null,
    instruction: request, targets: [...targets], activities: activities.map((item, index) => ({ title: item.title,
      time: item.time || '时间待定', detail: item.detail.slice(0, 600), protected: isProtectedActivity(trip, day, index) })) };
}

export function readDayChanges(value, targets) {
  if (!Array.isArray(value) || value.length > MAX_ADJUSTMENT_TARGETS) throw new Error('改动结果格式异常，请重新生成');
  const seen = new Set();
  return value.map((item) => {
    const { index, title, time, detail } = item || {};
    if (!Number.isInteger(index) || !targets.includes(index) || seen.has(index) || typeof title !== 'string' || !title.trim() || title.length > 100
        || typeof time !== 'string' || !time.trim() || time.length > 40 || typeof detail !== 'string' || detail.length > 600) {
      throw new Error('改动结果超出选择范围或格式无效，请重新生成');
    }
    seen.add(index);
    return { index, title: title.trim(), time: time.trim(), detail: detail.trim() };
  }).sort((a, b) => a.index - b.index);
}

export function previewDayAdjustment(trip, day, targets, changes, places = {}) {
  const activities = checkTargets(trip, day, targets);
  const replacements = new Map(readDayChanges(changes, targets).map(({ index, ...fields }) => [index, fields]));
  return activities.map((activity, index) => {
    const replacement = replacements.get(index);
    if (!replacement) return activity;
    if (replacement.title === activity.title) return { ...activity, ...replacement };
    if (titleParts(replacement.title).parts.length !== 1) throw new Error('一项改动只能替换一个活动');
    const place = places[index];
    // 模型只提供文字；换地点时，旧绑定失效，只有用户在候选列表确认后才绑定。
    return { ...replacement, icon: 'compass-outline', ...(validPlace(place) && place.city === trip.destination ? { place } : {}) };
  });
}

export function comparableDayLegs(before, after) {
  const result = [];
  const equal = (a, b) => a.latitude === b.latitude && a.longitude === b.longitude;
  for (let index = 0; index < before.length - 1; index++) {
    const original = [before[index].place, before[index + 1].place];
    const updated = [after[index].place, after[index + 1].place];
    if (!original.every(validPlace) || !updated.every(validPlace) || original.every((point, i) => equal(point, updated[i]))) continue;
    result.push({ index, original, updated });
  }
  return result;
}

export function remapDayCompletion(completed, day, newIndex) {
  const prefix = `${day}-`;
  return completed.flatMap((key) => {
    if (!key.startsWith(prefix)) return [key];
    const index = newIndex(Number(key.slice(prefix.length)));
    return Number.isInteger(index) && index >= 0 ? [`${prefix}${index}`] : [];
  });
}
