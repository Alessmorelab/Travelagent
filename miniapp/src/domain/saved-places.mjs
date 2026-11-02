import { validPlace } from './map-data.mjs';

export function samePlace(left, right) {
  if (!left || !right) return false;
  if (left.uid && right.uid) return left.uid === right.uid;
  return left.name === right.name && Number(left.latitude).toFixed(6) === Number(right.latitude).toFixed(6)
    && Number(left.longitude).toFixed(6) === Number(right.longitude).toFixed(6);
}

export function cleanSavedPlace(place, city = '') {
  if (!validPlace(place)) throw new Error('请先查询并确认实际地点后再收藏');
  const cityName = String(city || place.city || '').trim();
  if (cityName.length > 50) throw new Error('城市名称最多50字');
  return { name: place.name, address: place.address, latitude: place.latitude, longitude: place.longitude,
    coordinate_system: 'gcj02', source: place.source.slice(0, 100), retrieved_at: place.retrieved_at.slice(0, 80), city: cityName,
    ...(typeof place.uid === 'string' && place.uid.length <= 100 ? { uid: place.uid } : {}) };
}

export function readSavedPlaces(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value.slice(0, 200)) {
    try {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 100 || !Number.isFinite(item.savedAt) || item.savedAt < 0) continue;
      const place = { ...cleanSavedPlace(item, item.city || ''), id: item.id, savedAt: item.savedAt };
      if (!result.some((previous) => previous.id === place.id || samePlace(previous, place))) result.push(place);
    } catch {}
  }
  return result;
}
