import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore, STORAGE_KEY } from '../src/domain/travel.mjs';
import { comparableDayLegs, dayRevision, makeDayAdjustmentRequest, previewDayAdjustment } from '../src/domain/day-adjustment.mjs';
import { formatTripText } from '../src/domain/trip-details.mjs';
import { createChatClient } from '../src/services/chat-client.mjs';
import { createMiniController } from '../src/services/wechat.mjs';

const answer = { role: 'assistant', mode: 'live', status: 'complete', content: '### Day 1 · 城市漫游\n**上午｜测试博物馆**\n已预约\n**下午｜测试公园**\n散步\n**晚上｜测试餐厅**\n晚餐\n### Day 2 · 返程\n**上午｜测试车站**\n乘车' };
const change = { index: 1, title: '测试科技馆', time: '下午', detail: '室内参观' };
const place = (name, latitude) => ({ name, address: '测试路', city: '武汉', latitude, longitude: 114.3, source: 'fixture', retrieved_at: 'test', coordinate_system: 'gcj02' });
const memory = () => { const data = new Map(); return { async getItem(key) { return data.get(key) || null; }, async setItem(key, value) { data.set(key, value); } }; };
async function setup(t) {
  const storage = memory(), store = createTravelStore(storage);
  t.after(() => store.dispose()); await store.hydrate();
  const id = store.saveAssistantTrip(answer, '武汉');
  return { storage, store, id, trip: () => store.getState().trips.find((item) => item.id === id) };
}

test('移动、拆分和删除安排时，完成进度跟随对应活动，不清空同一天', async (t) => {
  const { store, id, trip } = await setup(t);
  store.toggleActivity(id, '0-1'); store.toggleActivity(id, '1-0');
  store.moveActivity(id, 0, 1, 1);
  assert.equal(trip().days[0][2].title, '测试公园');
  assert.deepEqual(trip().completed, ['0-2', '1-0']);
  store.editActivity(id, 0, 0, { title: '测试甲地 + 测试乙地', time: '上午', detail: '' });
  assert.equal(trip().days[0][3].title, '测试公园');
  assert.deepEqual(trip().completed, ['0-3', '1-0']);
  store.removeActivity(id, 0, 1);
  store.editActivity(id, 0, 2, { title: '测试公园', time: '14:00', detail: '补备注' });
  assert.deepEqual(trip().completed, ['0-2', '1-0']);
  store.removeActivity(id, 0, 2);
  assert.deepEqual(trip().completed, ['1-0']);
});

test('锁定可重新打开恢复，锁定或完成的活动不能加入请求或保存改动', async (t) => {
  const { store, id, storage } = await setup(t);
  store.setActivityLocked(id, 0, 0, true); store.toggleActivity(id, '0-2'); await store.flush();
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  const trip = reopened.getState().trips.find((item) => item.id === id);
  assert.equal(trip.days[0][0].locked, true);
  assert.throws(() => makeDayAdjustmentRequest(trip, 0, [0], '调整'), /未锁定/);
  assert.throws(() => makeDayAdjustmentRequest(trip, 0, [2], '调整'), /未完成/);
  assert.throws(() => reopened.applyDayAdjustment(id, 0, dayRevision(trip, 0), [1], [{ ...change, index: 0 }]), /超出选择范围/);
  assert.equal(reopened.getState().trips.find((item) => item.id === id), trip);
});

test('预览不写入，确认只替换指定活动，撤销恢复原地点并保留其他天的改动', async (t) => {
  const { store, id, trip } = await setup(t);
  store.setActivityLocked(id, 0, 0, true); store.toggleActivity(id, '0-2');
  store.bindMapPlace('trip', id, 0, 1, '测试公园', place('测试公园', 30.5));
  const before = trip(), revision = dayRevision(before, 0);
  const request = makeDayAdjustmentRequest(before, 0, [1], '换室内景点');
  assert.deepEqual(request.activities.map((activity) => activity.protected), [true, false, true]);
  assert.equal(request.activities.length, 3); assert.equal('sourceText' in request, false);
  assert.equal(previewDayAdjustment(before, 0, [1], [change])[1].place, undefined);
  assert.equal(trip(), before);
  const confirmed = place('测试科技馆', 30.6);
  store.applyDayAdjustment(id, 0, revision, [1], [change], { 1: confirmed });
  assert.equal(trip().days[0][0], before.days[0][0]);
  assert.equal(trip().days[0][2], before.days[0][2]);
  assert.equal(trip().days[1], before.days[1]);
  assert.equal(trip().days[0][1].place, confirmed);
  assert.deepEqual(trip().completed, ['0-2']); assert.equal(trip().sourceText, before.sourceText);
  store.editActivity(id, 1, 0, { title: '保留新安排', time: '上午', detail: '' });
  assert.equal(store.canUndoDayAdjustment(id, 0), true);
  store.undoDayAdjustment(id, 0);
  assert.deepEqual(trip().days[0], before.days[0]); assert.equal(trip().days[1][0].title, '保留新安排');
  assert.equal(store.canUndoDayAdjustment(id, 0), false);
});

test('预览或撤销不会覆盖同日之后的手动改动', async (t) => {
  const { store, id, trip } = await setup(t);
  const originalRevision = dayRevision(trip(), 0);
  store.editActivity(id, 0, 0, { title: '手动更新', time: '上午', detail: '' });
  assert.throws(() => store.applyDayAdjustment(id, 0, originalRevision, [1], [change]), /重新生成/);
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [change]);
  store.setActivityLocked(id, 0, 1, true);
  assert.equal(store.canUndoDayAdjustment(id, 0), false);
  assert.throws(() => store.undoDayAdjustment(id, 0), /不能直接撤销/);
  assert.equal(trip().days[0][1].locked, true);
});

test('多份行程按天保留撤销记录，重启后可恢复长备注、锁定与地点，再次打开保留撤销结果', async (t) => {
  const { store, id, trip, storage } = await setup(t);
  store.setActivityLocked(id, 0, 0, true);
  store.bindMapPlace('trip', id, 0, 0, '测试博物馆', place('测试博物馆', 30.4));
  store.editActivity(id, 0, 1, { title: '测试公园', time: '下午', detail: '调整前的私人提醒。'.repeat(100) });
  store.bindMapPlace('trip', id, 0, 1, '测试公园', place('测试公园', 30.5));
  store.toggleActivity(id, '0-2');
  const before = trip();
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [change]);
  store.applyDayAdjustment(id, 1, dayRevision(trip(), 1), [0], [{ index: 0, title: '测试书店', time: '上午', detail: '阅读' }]);
  const secondId = store.saveAssistantTrip(answer, '武汉');
  const secondTrip = store.getState().trips.find((item) => item.id === secondId);
  store.applyDayAdjustment(secondId, 0, dayRevision(secondTrip, 0), [1], [change]);
  await store.flush();

  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.equal(reopened.canUndoDayAdjustment(id, 0), true);
  assert.equal(reopened.canUndoDayAdjustment(id, 1), true);
  assert.equal(reopened.canUndoDayAdjustment(secondId, 0), true);
  const current = reopened.getState().trips.find((item) => item.id === id);
  assert.doesNotMatch(JSON.stringify(makeDayAdjustmentRequest(current, 0, [1], '调整时间')), /调整前的私人提醒/);
  assert.doesNotMatch(formatTripText(current), /调整前的私人提醒/);
  reopened.undoDayAdjustment(id, 0);
  const undone = reopened.getState().trips.find((item) => item.id === id);
  assert.deepEqual(undone.days[0], before.days[0]);
  assert.deepEqual(undone.completed, before.completed);
  assert.equal(undone.days[1][0].title, '测试书店');
  await reopened.flush();

  const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
  assert.equal(restored.canUndoDayAdjustment(id, 0), false);
  assert.equal(restored.canUndoDayAdjustment(id, 1), true);
  assert.equal(restored.canUndoDayAdjustment(secondId, 0), true);
  assert.deepEqual(restored.getState().trips.find((item) => item.id === id).days[0], before.days[0]);
  restored.undoDayAdjustment(id, 1);
  restored.undoDayAdjustment(secondId, 0);
  assert.deepEqual(restored.getState().trips.find((item) => item.id === id).days, before.days);
  assert.equal(restored.getState().trips.find((item) => item.id === secondId).days[0][1].title, '测试公园');
});

test('同一天只撤销最近一次有效调整，无变化的结果不会覆盖撤销记录', async (t) => {
  const { store, id, trip, storage } = await setup(t);
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [change]);
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [{ ...change, time: '15:00' }]);
  const latest = trip();
  assert.throws(() => store.applyDayAdjustment(id, 0, dayRevision(latest, 0), [1], [{ ...change, time: '15:00' }]), /没有可保存/);
  assert.equal(trip(), latest);
  await store.flush();
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  reopened.undoDayAdjustment(id, 0);
  const activity = reopened.getState().trips.find((item) => item.id === id).days[0][1];
  assert.equal(activity.title, change.title);
  assert.equal(activity.time, change.time);
  assert.equal(reopened.canUndoDayAdjustment(id, 0), false);
});

test('重新打开后，撤销仍保护后续编辑、完成状态、日期和地点变化', async (t) => {
  const mutations = [
    (store, id) => store.editActivity(id, 0, 1, { title: '手动安排', time: '上午', detail: '' }),
    (store, id) => store.setActivityLocked(id, 0, 1, true),
    (store, id) => store.toggleActivity(id, '0-1'),
    (store, id) => store.bindMapPlace('trip', id, 0, 1, change.title, place(change.title, 30.6)),
    (store, id, trip) => store.saveTripDetails(id, { ...trip, startDate: '2026-12-31', endDate: '2027-01-01' }),
  ];
  for (const mutate of mutations) {
    const { store, id, trip, storage } = await setup(t);
    store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [change]);
    mutate(store, id, trip());
    await store.flush();
    const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
    const current = reopened.getState().trips.find((item) => item.id === id);
    assert.equal(reopened.canUndoDayAdjustment(id, 0), false);
    assert.throws(() => reopened.undoDayAdjustment(id, 0), /不能直接撤销/);
    assert.equal(reopened.getState().trips.find((item) => item.id === id), current);
  }
});

test('损坏或旧版缺失的撤销记录不影响当前行程恢复，也不影响其他日期的有效记录', async (t) => {
  const { store, id, trip, storage } = await setup(t);
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [change]);
  store.applyDayAdjustment(id, 1, dayRevision(trip(), 1), [0], [{ index: 0, title: '测试书店', time: '上午', detail: '' }]);
  await store.flush();
  const saved = JSON.parse(await storage.getItem(STORAGE_KEY));
  const valid = saved.trips.find((item) => item.id === id).adjustmentUndo;
  const malformed = [
    null, [], {}, { ...valid[0], before: null }, { ...valid[0], before: [null, null, null] },
    { ...valid[0], before: valid[0].before.slice(1) },
    { ...valid[0], before: valid[0].before.map((activity) => ({ ...activity, place: { latitude: 'invalid' } })) },
    { ...valid[0], after: '过期版本' },
  ];
  for (const invalid of malformed) {
    saved.trips.find((item) => item.id === id).adjustmentUndo = { 0: invalid, 1: valid[1], '-1': valid[0], '30': valid[0] };
    await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
    const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
    assert.deepEqual(reopened.getState().trips.find((item) => item.id === id).days, trip().days);
    assert.equal(reopened.canUndoDayAdjustment(id, 0), false);
    assert.equal(reopened.canUndoDayAdjustment(id, 1), true);
  }
  delete saved.trips.find((item) => item.id === id).adjustmentUndo;
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const legacy = createTravelStore(storage); t.after(() => legacy.dispose()); await legacy.hydrate();
  assert.deepEqual(legacy.getState().trips.find((item) => item.id === id).days, trip().days);
  assert.equal(legacy.canUndoDayAdjustment(id, 0), false);
});

test('只调整活动时间时保留完整长备注，仍可保存明确改写的备注', async (t) => {
  const { store, id, trip, storage } = await setup(t);
  const detail = `${'预约说明。'.repeat(119)}     请携带身份证原件。`;
  store.editActivity(id, 0, 1, { title: '测试公园', time: '下午', detail });

  const original = trip();
  const request = makeDayAdjustmentRequest(original, 0, [1], '只改到15:00');
  const timeChange = { index: 1, title: '测试公园', time: '15:00', detail: request.activities[1].detail.trim() };
  assert.ok(timeChange.detail.length < detail.length);
  assert.equal(previewDayAdjustment(original, 0, [1], [timeChange])[1].detail, detail);
  store.applyDayAdjustment(id, 0, dayRevision(original, 0), [1], [timeChange]);
  assert.equal(trip().days[0][1].time, '15:00');
  assert.equal(trip().days[0][1].detail, detail);

  await store.flush();
  const reopened = createTravelStore(storage);
  t.after(() => reopened.dispose());
  await reopened.hydrate();
  assert.equal(reopened.getState().trips.find((item) => item.id === id).days[0][1].detail, detail);

  const rewrite = { ...timeChange, detail: '从东门入园' };
  assert.equal(previewDayAdjustment(trip(), 0, [1], [rewrite])[1].detail, rewrite.detail);
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [1], [rewrite]);
  assert.equal(trip().days[0][1].detail, rewrite.detail);
});

test('只比较新旧两侧均有实际坐标的受影响相邻路段', async (t) => {
  const { store, id, trip } = await setup(t);
  store.bindMapPlace('trip', id, 0, 0, '测试博物馆', place('测试博物馆', 30.4));
  store.bindMapPlace('trip', id, 0, 1, '测试公园', place('测试公园', 30.5));
  const before = trip().days[0];
  assert.deepEqual(comparableDayLegs(before, previewDayAdjustment(trip(), 0, [1], [change])), []);
  const pairs = comparableDayLegs(before, previewDayAdjustment(trip(), 0, [1], [change], { 1: place('测试科技馆', 30.6) }));
  assert.deepEqual(pairs.map((pair) => pair.index), [0]);
  assert.equal(pairs[0].original[1].latitude, 30.5); assert.equal(pairs[0].updated[1].latitude, 30.6);
});

test('改动客户端复用安装凭证，并拦截服务端意外返回的越界改动', async () => {
  const requests = [];
  let result = [change];
  const client = createChatClient({ storage: memory(), connectSocket() {}, fetch: async (url, init) => {
    requests.push({ url, init });
    return { ok: true, status: 200, async json() { return url.endsWith('/devices') ? { token: 'fixture-token' } : { changes: result }; } };
  } });
  const request = { targets: [1], instruction: '换室内' };
  assert.deepEqual(await client.adjustDay('https://fixture.example', request), [change]);
  assert.equal(requests[1].url, 'https://fixture.example/api/v1/trips/adjust-day');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer fixture-token');
  result = [{ ...change, index: 0 }];
  await assert.rejects(client.adjustDay('https://fixture.example', request), /超出选择范围/);
  assert.equal(requests.filter(({ url }) => url.endsWith('/devices')).length, 1);
});

test('等待共用凭证时取消调整，凭证就绪后只发送新的有效请求', async () => {
  const calls = [];
  let finishToken, signalTokenStarted;
  const tokenStarted = new Promise((resolve) => { signalTokenStarted = resolve; });
  const client = createChatClient({ storage: memory(), connectSocket() {}, fetch: async (url) => {
    calls.push(url);
    if (url.endsWith('/devices')) {
      await new Promise((resolve) => { finishToken = resolve; signalTokenStarted(); });
      return { ok: true, async json() { return { token: 'fixture-token' }; } };
    }
    return { ok: true, async json() { return { changes: [change] }; } };
  } });
  const controller = createMiniController();
  const request = { targets: [1], instruction: '换成室内' };
  const cancelled = client.adjustDay('https://fixture.example', request, controller.signal);
  await tokenStarted;
  controller.abort();
  const retried = client.adjustDay('https://fixture.example', request);
  finishToken();
  await assert.rejects(cancelled, { name: 'AbortError' });
  assert.deepEqual(await retried, [change]);
  assert.deepEqual(calls, ['https://fixture.example/api/v1/chat/devices', 'https://fixture.example/api/v1/trips/adjust-day']);
  await assert.rejects(client.adjustDay('https://fixture.example', request, controller.signal), { name: 'AbortError' });
  assert.equal(calls.length, 2);
});
