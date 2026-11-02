import { parseItinerary } from './itinerary.mjs';
import { expandActivities } from './activity-slots.mjs';

export function validPoint(point) {
  return !!point && typeof point.latitude === 'number' && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === 'number' && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180;
}

export function validPlace(place) {
  return validPoint(place) && place.coordinate_system === 'gcj02' && typeof place.name === 'string' && !!place.name.trim() && place.name.length <= 100
    && typeof place.address === 'string' && place.address.length <= 200 && typeof place.source === 'string' && !!place.source
    && typeof place.retrieved_at === 'string' && !!place.retrieved_at;
}

export function readItinerary(value) {
  if (!value || value.schema_version !== 1 || typeof value.destination !== 'string' || value.destination.length > 60
      || typeof value.notes !== 'string' || value.notes.length > 30000 || !Array.isArray(value.days) || !value.days.length || value.days.length > 30
      || value.days.some((day) => !Array.isArray(day) || !day.length || day.length > 50 || day.some((item) => !item
        || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 100 || typeof item.time !== 'string' || item.time.length > 40
        || typeof item.detail !== 'string' || item.detail.length > 5000))) return null;
  return { schema_version: 1, destination: value.destination, notes: value.notes,
    days: value.days.map((day) => expandActivities(day.map((item) => ({ title: item.title, time: item.time, detail: item.detail, icon: 'compass-outline',
      ...(typeof item.groupTitle === 'string' ? { groupTitle: item.groupTitle.slice(0, 100) } : {}),
      ...(Array.isArray(item.alternatives) && item.alternatives.length >= 2 && item.alternatives.length <= 6 && item.alternatives.every((name) => typeof name === 'string' && name.trim() && name.length <= 100) ? { alternatives: item.alternatives.slice() } : {}),
      ...(validPlace(item.place) ? { place: { ...item.place } } : {}) })))) };
}

export function itineraryForMessage(message) {
  if (!message || message.role !== 'assistant' || ['streaming', 'interrupted'].includes(message.status)) return null;
  const structured = readItinerary(message.itinerary);
  if (structured) return { ...structured, sourceText: message.content };
  const parsed = parseItinerary(message.content);
  return parsed ? { schema_version: 1, destination: '', ...parsed } : null;
}

export function dayFingerprint(day) {
  return JSON.stringify(day.map((item) => [item.title, validPlace(item.place) ? [item.place.latitude, item.place.longitude] : null]));
}
