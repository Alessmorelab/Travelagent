import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore } from '../src/domain/travel.mjs';
import { dayFingerprint, readItinerary, validPlace } from '../src/domain/map-data.mjs';
import { createChatClient } from '../src/services/chat-client.mjs';

const place = (name, latitude = 30.5) => ({ name, address: '武汉市', latitude, longitude: 114.3, coordinate_system: 'gcj02', source: 'fixture', retrieved_at: 'fixture-time' });
const itinerary = () => ({ schema_version: 1, destination: '武汉', notes: '预约待确认', days: [[
  { title: '黄鹤楼', time: '上午', detail: '登楼', icon: 'compass-outline' },
  { title: '省博物馆', time: '下午', detail: '参观', icon: 'compass-outline' }
]] });
const storage = () => { const values = new Map(); return { async getItem(key) { return values.get(key) || null; }, async setItem(key, value) { values.set(key, value); } }; };

test('行程结构按版本校验，未验证的坐标不能成为地图绑定', () => {
  const value = itinerary();
  value.days[0][0].place = { ...place('黄鹤楼'), coordinate_system: 'bd09ll' };
  const parsed = readItinerary(value);
  assert.equal(parsed.days[0][0].place, undefined);
  assert.equal(validPlace({ ...place('黄鹤楼'), latitude: NaN }), false);
  assert.equal(readItinerary({ ...value, schema_version: 2 }), null);
  assert.equal(readItinerary({ ...value, days: [[]] }), null);
});

test('地点绑定随保存恢复，修改地点会失效，调整顺序改变路线标识', async (t) => {
  const data = storage(), store = createTravelStore(data);
  t.after(() => store.dispose()); await store.hydrate();
  const message = { id: 'structured', role: 'assistant', mode: 'live', agent: 'team', status: 'complete', content: '结构化行程', itinerary: itinerary() };
  const id = store.saveAssistantTrip(message, '武汉');
  store.bindMapPlace('trip', id, 0, 0, '黄鹤楼', place('黄鹤楼'));
  store.bindMapPlace('trip', id, 0, 1, '省博物馆', place('省博物馆', 30.6));
  await store.flush();
  const reopened = createTravelStore(data); t.after(() => reopened.dispose()); await reopened.hydrate();
  const original = reopened.getState().trips.find((trip) => trip.id === id).days[0];
  assert.equal(original[0].place.name, '黄鹤楼');
  reopened.moveActivity(id, 0, 0, 1);
  const moved = reopened.getState().trips.find((trip) => trip.id === id).days[0];
  assert.equal(moved[1].place.name, '黄鹤楼');
  assert.notEqual(dayFingerprint(moved), dayFingerprint(original));
  reopened.editActivity(id, 0, 1, { title: '东湖', time: '下午', detail: '' });
  assert.equal(reopened.getState().trips.find((trip) => trip.id === id).days[0][1].place, undefined);
  // A late response for the previous title cannot overwrite the edited stop.
  reopened.bindMapPlace('trip', id, 0, 1, '黄鹤楼', place('黄鹤楼'));
  assert.equal(reopened.getState().trips.find((trip) => trip.id === id).days[0][1].place, undefined);
});

test('重新生成创建新请求编号，恢复重试复用旧编号，不重复用户提问', async (t) => {
  const ids = [], store = createTravelStore(storage(), { stream: async (request, event) => {
    ids.push(request.requestId); event({ type: 'artifact', itinerary: itinerary(), warnings: [] });
    return { response: `回复${ids.length}`, thread_id: 'one' };
  } });
  t.after(() => store.dispose()); await store.hydrate(); store.setConnection({ mode: 'live', apiUrl: 'https://fixture.example' });
  await store.sendMessage('武汉两日游');
  await store.sendMessage('武汉两日游', true);
  await store.sendMessage('武汉两日游', 'regenerate');
  assert.equal(ids[0], ids[1]); assert.notEqual(ids[1], ids[2]);
  assert.equal(store.getState().messages.filter((item) => item.role === 'user').length, 1);
  assert.equal(store.getState().messages.filter((item) => item.role === 'assistant').length, 1);
  assert.equal(store.getState().messages.at(-1).itinerary.destination, '武汉');
});

test('地图查询保留部分失败，路段可按编号重试且拒绝无路径或错误坐标系', async () => {
  const calls = [], good = place('黄鹤楼'); let bad = false;
  const client = createChatClient({ storage: storage(), connectSocket() {}, fetch: async (url, init) => {
    calls.push({ url, init });
    const body = url.endsWith('/devices') ? { token: 'test-token' } : url.endsWith('/resolve') ? { results: [
      { query: '黄鹤楼', places: [good], coordinate_system: 'gcj02', source: 'fixture', retrieved_at: 'test' },
      { query: '省博物馆', places: [], failure: { kind: 'timeout', message: '超时' } }
    ] } : { mode: 'walking', coordinate_system: bad ? 'bd09ll' : 'gcj02', legs: [{ index: 1, source: 'fixture', retrieved_at: 'test', coordinate_system: 'gcj02', distance_m: 100, duration_seconds: 80, points: [good, place('终点', 30.6)] }] };
    return { ok: true, status: 200, async json() { return body; } };
  } });
  const resolved = await client.resolvePlaces('https://fixture.example', '武汉', ['黄鹤楼', '省博物馆']);
  assert.equal(resolved[0].places[0].coordinate_system, 'gcj02'); assert.equal(resolved[1].failure.kind, 'timeout');
  await client.routeDay('https://fixture.example', [good, good, good], 'walking', [1]);
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).segments, [1]);
  assert.equal(calls.at(-1).init.headers.Authorization, 'Bearer test-token');
  bad = true;
  await assert.rejects(client.routeDay('https://fixture.example', [good, good, good], 'walking', [1]), /格式异常/);
});
