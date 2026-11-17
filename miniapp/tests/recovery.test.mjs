import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore, initialState, STORAGE_KEY } from '../src/domain/travel.mjs';
import { dayRevision } from '../src/domain/day-adjustment.mjs';
import { validateMiniConnection } from '../src/services/wechat.mjs';

const content = '### Day 1\n**上午｜测试博物馆**\n已预约\n**下午｜测试公园**\n散步\n### Day 2\n**上午｜测试书店**\n阅读';

async function savedFixture(t) {
  const values = new Map();
  const storage = { async getItem(key) { return values.get(key) || null; }, async setItem(key, value) { values.set(key, value); } };
  const store = createTravelStore(storage, { stream: async () => ({ response: content, thread_id: 'fixture-thread' }) });
  t.after(() => store.dispose()); await store.hydrate();
  store.removeTrip('kyoto-sample');
  store.setConnection({ mode: 'live', apiUrl: 'https://original.fixture.example' });
  store.savePreferences({ ...store.getState().preferences, origin: '上海', destination: '武汉' });
  await store.sendMessage('安排武汉两天行程');
  const id = store.saveAssistantTrip(store.getState().messages.at(-1), '武汉');
  const place = { name: '测试公园', address: '测试路', city: '武汉', latitude: 30.5, longitude: 114.3,
    source: 'fixture', retrieved_at: 'test', coordinate_system: 'gcj02' };
  store.toggleSavedPlace(place);
  store.toggleFavorite('coast');
  store.setActivityLocked(id, 0, 0, true);
  store.toggleActivity(id, '1-0');
  store.bindMapPlace('trip', id, 0, 1, '测试公园', place);
  const trip = store.getState().trips.find((item) => item.id === id);
  store.saveTripDetails(id, { ...trip, userNotes: '测试出行备注' });
  store.applyDayAdjustment(id, 0, dayRevision(trip, 0), [1], [{ index: 1, title: '测试公园', time: '15:00', detail: '散步' }]);
  await store.flush();
  return { storage, id, saved: JSON.parse(await storage.getItem(STORAGE_KEY)) };
}

test('旅行偏好损坏时仍恢复行程、地点、进度、撤销与对话，默认偏好需再次确认', async (t) => {
  for (const invalid of [null, {}, 'invalid', { ...initialState().preferences, startDate: '2026-02-30' }]) {
    const { storage, id, saved } = await savedFixture(t);
    saved.preferences = invalid;
    saved.preferencesConfirmed = true;
    const raw = JSON.stringify(saved);
    await storage.setItem(STORAGE_KEY, raw);
    const calls = [];
    const reopened = createTravelStore(storage, { validateConnection: validateMiniConnection,
      stream: async (input) => { calls.push(input); return { response: '继续查询' }; } });
    t.after(() => reopened.dispose()); await reopened.hydrate();
    assert.deepEqual(reopened.getState().trips, saved.trips);
    assert.deepEqual(reopened.getState().savedPlaces, saved.savedPlaces);
    assert.deepEqual(reopened.getState().favorites, saved.favorites);
    assert.equal(reopened.getState().messages.at(-1).content, content);
    assert.equal(reopened.canUndoDayAdjustment(id, 0), true);
    assert.deepEqual(reopened.getState().connection, saved.connection);
    assert.deepEqual(reopened.getState().preferences, initialState().preferences);
    assert.equal(reopened.getState().preferencesConfirmed, false);
    assert.match(reopened.getState().toast, /部分设置/);
    assert.equal(await storage.getItem(STORAGE_KEY), raw, '读取 v2 记录时保留磁盘原始内容');
    await reopened.sendMessage('继续查景点');
    assert.equal(calls[0].apiUrl, saved.connection.apiUrl);
    assert.equal(calls[0].threadId, 'fixture-thread');
    assert.equal(calls[0].preferences, '');
    reopened.savePreferences({ ...reopened.getState().preferences, destination: '武汉' });
    await reopened.sendMessage('再查景点');
    assert.match(calls[1].preferences, /前往武汉/);
    await reopened.flush();
    const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
    assert.deepEqual(restored.getState().trips, saved.trips);
    assert.equal(restored.getState().preferencesConfirmed, true);
    restored.undoDayAdjustment(id, 0);
    assert.equal(restored.getState().trips.find((item) => item.id === id).days[0][1].time, '下午');
  }
});

test('服务设置损坏时保留本地内容与有效偏好，默认服务不复用旧会话编号', async (t) => {
  for (const invalid of [null, {}, { mode: 'live' }, { mode: 'live', apiUrl: 'https://api.example.com' },
    { mode: 'live', apiUrl: 'file:///fixture' }, { mode: 'live', apiUrl: 'https://fixture.example/?invalid=1' }]) {
    const { storage, id, saved } = await savedFixture(t);
    saved.connection = invalid;
    saved.activeChats = { team: 'fixture-active-chat' };
    await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const calls = [];
    const reopened = createTravelStore(storage, { apiUrl: 'https://default.fixture.example', validateConnection: validateMiniConnection,
      stream: async (input) => { calls.push(input); return { response: '新服务回复' }; } });
    t.after(() => reopened.dispose()); await reopened.hydrate();
    assert.deepEqual(reopened.getState().trips, saved.trips);
    assert.deepEqual(reopened.getState().savedPlaces, saved.savedPlaces);
    assert.equal(reopened.getState().messages.at(-1).content, content);
    assert.equal(reopened.canUndoDayAdjustment(id, 0), true);
    assert.deepEqual(reopened.getState().preferences, saved.preferences);
    assert.equal(reopened.getState().preferencesConfirmed, true);
    assert.deepEqual(reopened.getState().connection, { mode: 'live', apiUrl: 'https://default.fixture.example' });
    assert.deepEqual(reopened.getState().threads, {});
    assert.deepEqual(reopened.getState().activeChats, {});
    assert.match(reopened.getState().toast, /部分设置/);
    await reopened.sendMessage('新服务查询');
    assert.equal(calls[0].apiUrl, 'https://default.fixture.example');
    assert.equal(calls[0].threadId, undefined);
    assert.match(calls[0].preferences, /前往武汉/);
  }
});

test('偏好与服务设置同时损坏时保留主动选择的示例模式，重新保存设置后可重开', async (t) => {
  const { storage, saved } = await savedFixture(t);
  saved.preferences = null;
  saved.connection = { mode: 'demo', apiUrl: 'file:///fixture' };
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const reopened = createTravelStore(storage, { demoDelay: 0, validateConnection: validateMiniConnection,
    stream: async () => { assert.fail('已选择示例模式'); } });
  t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.deepEqual(reopened.getState().trips, saved.trips);
  assert.deepEqual(reopened.getState().connection, { mode: 'demo', apiUrl: 'http://127.0.0.1:8000' });
  assert.equal(reopened.getState().preferencesConfirmed, false);
  await reopened.sendMessage('试试示例');
  assert.match(reopened.getState().messages.at(-1).content, /示例回复/);
  reopened.setConnection({ mode: 'live', apiUrl: 'https://new.fixture.example' });
  reopened.savePreferences({ ...reopened.getState().preferences, destination: '武汉' });
  await reopened.flush();
  const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
  assert.deepEqual(restored.getState().trips, saved.trips);
  assert.deepEqual(restored.getState().connection, { mode: 'live', apiUrl: 'https://new.fixture.example' });
  assert.equal(restored.getState().preferences.destination, '武汉');
  assert.equal(restored.getState().preferencesConfirmed, true);
  assert.doesNotMatch(restored.getState().toast, /部分设置/);
});

test('旧版记录的设置损坏时可完成升级，并保存恢复出的有效行程', async (t) => {
  const { storage, id, saved } = await savedFixture(t);
  saved.version = 1;
  delete saved.preferences;
  delete saved.connection;
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const reopened = createTravelStore(storage, { validateConnection: validateMiniConnection });
  t.after(() => reopened.dispose()); await reopened.hydrate(); await reopened.flush();
  assert.deepEqual(reopened.getState().trips, saved.trips);
  assert.equal(reopened.canUndoDayAdjustment(id, 0), true);
  assert.equal(reopened.getState().preferencesConfirmed, false);
  assert.equal(JSON.parse(await storage.getItem(STORAGE_KEY)).version, 2);
  const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
  assert.deepEqual(restored.getState().trips, saved.trips);
  assert.equal(restored.canUndoDayAdjustment(id, 0), true);
  assert.deepEqual(restored.getState().savedPlaces, saved.savedPlaces);
});
