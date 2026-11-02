import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore, STORAGE_KEY } from '../src/domain/travel.mjs';
import { formatTripText, tripEndDate, validateTripDetails } from '../src/domain/trip-details.mjs';
import { readSavedPlaces, samePlace } from '../src/domain/saved-places.mjs';

const memory = () => { const data = new Map(); return { async getItem(key) { return data.get(key) || null; }, async setItem(key, value) { data.set(key, value); } }; };
const place = (name = '测试公园') => ({ name, address: '测试路1号', latitude: 30.5, longitude: 114.3, source: '测试地图', retrieved_at: '2026-11-02T12:00:00+08:00', coordinate_system: 'gcj02', uid: `place-${name}` });
const answer = { role: 'assistant', mode: 'live', status: 'complete', content: '### Day 1 · 公园\n**上午｜测试公园**\n散步\n### Day 2 · 城市漫游\n**下午｜测试博物馆**\n参观' };
async function setup(t) {
  const storage = memory(), store = createTravelStore(storage);
  t.after(() => store.dispose()); await store.hydrate();
  return { storage, store, id: store.saveAssistantTrip(answer, '武汉') };
}

test('行程日期跨月、跨年和闰年计算准确，不接受无效日期或不一致返程日期', () => {
  assert.equal(tripEndDate('2026-12-31', 2), '2027-01-01');
  assert.equal(tripEndDate('2028-02-28', 3), '2028-03-01');
  assert.equal(tripEndDate('', 2), '');
  const values = { title: '周末游', destination: '武汉', startDate: '', travelers: 0, budget: 0 };
  assert.throws(() => validateTripDetails({ ...values, startDate: '2026-02-30' }, 2), /日期/);
  assert.throws(() => validateTripDetails({ ...values, startDate: '2026-12-31', endDate: '2027-01-02' }, 2), /返程日期/);
  assert.throws(() => validateTripDetails({ ...values, travelers: 21 }, 2), /人数/);
  assert.throws(() => validateTripDetails({ ...values, travelers: NaN }, 2), /人数/);
  assert.throws(() => validateTripDetails({ ...values, budget: Infinity }, 2), /预算/);
  assert.throws(() => validateTripDetails({ ...values, budget: NaN }, 2), /预算/);
  assert.throws(() => validateTripDetails(values, 0), /1–30天/);
});

test('AI行程可填写基本信息，重开后保留每日安排、坐标、完成进度和原始回复', async (t) => {
  const { storage, store, id } = await setup(t);
  store.bindMapPlace('trip', id, 0, 0, '测试公园', place());
  store.toggleActivity(id, '0-0');
  const before = store.getState().trips.find((item) => item.id === id);
  store.saveTripDetails(id, { title: '武汉周末安排', destination: '武汉', startDate: '2026-12-31', travelers: 3, budget: 2500, userNotes: '上午集合' });
  await store.flush();
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  const trip = reopened.getState().trips.find((item) => item.id === id);
  assert.ok(trip); assert.equal(trip.endDate, '2027-01-01'); assert.equal(trip.travelers, 3); assert.equal(trip.budget, 2500);
  assert.equal(trip.userNotes, '上午集合'); assert.equal(trip.sourceText, answer.content);
  assert.deepEqual(trip.days, before.days); assert.deepEqual(trip.completed, ['0-0']);
  assert.equal(reopened.getState().preferencesConfirmed, false);
});

test('更换目的地会清除旧地点绑定，日期人数预算可以继续留空', async (t) => {
  const { storage, store, id } = await setup(t);
  store.bindMapPlace('trip', id, 0, 0, '测试公园', place());
  store.saveTripDetails(id, { title: '另一个旅行安排', destination: '杭州', startDate: '', travelers: 0, budget: 0 });
  await store.flush();
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  const trip = reopened.getState().trips.find((item) => item.id === id);
  assert.ok(trip); assert.equal(trip.days[0][0].place, undefined); assert.equal(trip.days.length, 2);
  assert.equal(trip.startDate, ''); assert.equal(trip.travelers, 0); assert.equal(trip.budget, 0);
});

test('实际地点收藏可恢复并加入指定天，不重复添加，取消收藏保留已加入的安排', async (t) => {
  const { storage, store, id } = await setup(t);
  store.toggleSavedPlace(place(), '武汉');
  const favorite = store.getState().savedPlaces[0];
  store.addSavedPlaceToTrip(favorite.id, id, 1);
  store.setActiveDay(0);
  store.addSavedPlaceToTrip(favorite.id, id, 1);
  assert.equal(store.getState().focusTripId, id); assert.equal(store.getState().activeDay, 1);
  assert.equal(store.getState().trips.find((item) => item.id === id).days[1].length, 2);
  await store.flush();
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.equal(reopened.getState().savedPlaces.length, 1);
  assert.equal(reopened.getState().savedPlaces[0].city, '武汉');
  const activity = reopened.getState().trips.find((item) => item.id === id).days[1][1];
  assert.equal(activity.title, favorite.name); assert.equal(activity.place.coordinate_system, 'gcj02');
  assert.equal(activity.place.source, '测试地图');
  reopened.removeSavedPlace(favorite.id);
  assert.equal(reopened.getState().savedPlaces.length, 0);
  assert.equal(reopened.getState().trips.find((item) => item.id === id).days[1][1].place.latitude, 30.5);
});

test('无效坐标不能收藏，损坏和重复收藏记录不会影响其他本地数据', async (t) => {
  const { storage, store, id } = await setup(t);
  assert.throws(() => store.toggleSavedPlace({ ...place(), coordinate_system: 'bd09ll' }), /确认实际地点/);
  store.toggleSavedPlace(place(), '武汉'); await store.flush();
  const saved = JSON.parse(await storage.getItem(STORAGE_KEY));
  saved.savedPlaces.push({ ...saved.savedPlaces[0] }, { ...saved.savedPlaces[0], id: 'broken', latitude: 999 });
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.equal(reopened.getState().savedPlaces.length, 1);
  assert.ok(reopened.getState().trips.some((item) => item.id === id));
  assert.equal(samePlace(place(), { ...place(), name: '同一地点的新名字' }), true);
  assert.deepEqual(readSavedPlaces({ bad: true }), []);
});

test('已有地点可直接取消收藏，收藏上限和无效行程目标有明确提示', async (t) => {
  const { store, id } = await setup(t);
  store.toggleSavedPlace(place(), '武汉'); const favorite = store.getState().savedPlaces[0];
  assert.throws(() => store.addSavedPlaceToTrip(favorite.id, 'kyoto-sample', 0), /自己的行程/);
  assert.throws(() => store.addSavedPlaceToTrip(favorite.id, id, 9), /天数/);
  store.toggleSavedPlace(place(), '武汉'); assert.equal(store.getState().savedPlaces.length, 0);
  for (let index = 0; index < 200; index++) store.toggleSavedPlace(place(`地点${index}`), '武汉');
  assert.throws(() => store.toggleSavedPlace(place('超出上限的地点'), '武汉'), /200/);
});

test('复制内容来自当前编辑后的行程，包含日期与出行备注并保留示例标识', async (t) => {
  const { store, id } = await setup(t);
  store.saveTripDetails(id, { title: '我的周末', destination: '武汉', startDate: '2026-12-31', travelers: 2, budget: 1500, userNotes: '集合待定' });
  store.editActivity(id, 0, 0, { title: '新的游览地点', time: '10:00', detail: '轻松散步' });
  const text = formatTripText(store.getState().trips.find((item) => item.id === id));
  assert.ok(text.includes('2027-01-01') && text.includes('新的游览地点') && text.includes('人民币1500元') && text.includes('集合待定'));
  assert.ok(formatTripText(store.getState().trips.find((item) => item.sample)).includes('示例行程'));
});
