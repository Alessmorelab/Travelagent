import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore, initialState, STORAGE_KEY, validatePreferences, validateConnection } from '../src/domain/travel.mjs';
import { dayRevision } from '../src/domain/day-adjustment.mjs';

function memoryStorage() {
  const values = new Map();
  return { values, async getItem(key) { return values.get(key) || null; }, async setItem(key, value) { values.set(key, value); } };
}
async function fixture(options = {}) {
  const storage = memoryStorage();
  const store = createTravelStore(storage, { demoDelay: 0, ...options });
  await store.hydrate();
  return { store, storage };
}

test('收藏、偏好、行程完成进度与对话在重新打开后恢复', async (t) => {
  const { store, storage } = await fixture(); t.after(() => store.dispose());
  store.setConnection({ ...store.getState().connection, mode: 'demo' });
  store.toggleFavorite('coast');
  store.savePreferences({ ...store.getState().preferences, origin: '上海', travelers: 3 });
  store.createTrip({ ...store.getState().preferences, destination: '东京', startDate: '2026-12-01', endDate: '2026-12-03' });
  const trip = store.getState().trips[0];
  store.toggleActivity(trip.id, '0-0');
  await store.sendMessage('想去东京'); await store.flush();
  const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
  assert.equal(restored.getState().preferences.origin, '上海');
  assert.equal(restored.getState().preferencesConfirmed, true);
  assert.ok(restored.getState().favorites.includes('coast'));
  assert.equal(restored.getState().trips[0].days.length, 3);
  assert.deepEqual(restored.getState().trips[0].completed, ['0-0']);
  assert.equal(restored.getState().messages.length, 2);
  assert.match(restored.getState().messages[1].content, /示例回复/);
});

test('真实请求按助手分别保存会话，并携带旅行偏好', async (t) => {
  const calls = [];
  const { store } = await fixture({ stream: async (input) => { calls.push(input); return { response: `${input.agent}真实结果`, thread_id: `thread-${input.agent}` }; } });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'https://travel.example/' }); store.savePreferences(store.getState().preferences);
  for (const agent of ['team', 'flights', 'hotels', 'destinations', 'flights']) { store.setAgent(agent); await store.sendMessage('查询旅行信息'); }
  assert.deepEqual(calls.map((call) => call.agent), ['team', 'flights', 'hotels', 'destinations', 'flights']);
  assert.deepEqual(calls.map((call) => call.threadId), [undefined, undefined, undefined, undefined, 'thread-flights']);
  assert.match(calls[0].preferences, /武汉出发/); assert.match(calls[0].preferences, /总预算人民币8000元/);
  assert.equal(store.getState().messages.at(-1).mode, 'live');
});

test('真实请求排除默认示例偏好，主动保存后才附带且重新打开后保持', async (t) => {
  const calls = []; const options = { stream: async (input) => { calls.push(input); return { response: '武汉建议' }; } };
  const { store, storage } = await fixture(options); t.after(() => store.dispose());
  store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' }); await store.sendMessage('想去武汉玩几天');
  assert.equal(calls[0].query, '想去武汉玩几天'); assert.equal(calls[0].preferences, ''); assert.doesNotMatch(JSON.stringify(calls[0]), /京都|8000/);
  store.savePreferences({ ...store.getState().preferences, destination: '武汉', budget: 3000 }); await store.flush();
  const restored = createTravelStore(storage, options); t.after(() => restored.dispose()); await restored.hydrate(); await restored.sendMessage('查景点');
  assert.match(calls[1].preferences, /前往武汉/); assert.match(calls[1].preferences, /3000元/);
});

test('旧版本自动保存的京都示例偏好不会迁移为用户确认的偏好', async (t) => {
  const storage = memoryStorage();
  const saved = { ...initialState(), version: 1 };
  delete saved.preferencesConfirmed;
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const requests = [];
  const store = createTravelStore(storage, { stream: async (input) => { requests.push(input); return { response: '武汉建议' }; } });
  t.after(() => store.dispose()); await store.hydrate();
  store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  await store.sendMessage('想去武汉玩几天');
  assert.equal(store.getState().preferencesConfirmed, false);
  assert.equal(requests[0].preferences, '');
});

test('后端失败不伪造成功回复，重试不重复添加用户消息', async (t) => {
  let fail = true;
  const { store } = await fixture({ stream: async () => { if (fail) throw new Error('旅行服务暂不可用'); return { response: '恢复后的真实回复', thread_id: 'recovered' }; } });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'http://localhost:8000' });
  await store.sendMessage('查询机票');
  assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().error, '旅行服务暂不可用'); assert.equal(store.getState().busy, false);
  fail = false; await store.sendMessage(store.getState().lastQuery, true);
  assert.equal(store.getState().messages.length, 2); assert.equal(store.getState().error, '');
});

test('切换服务会取消旧请求，迟到的结果不会污染新会话', async (t) => {
  let resolve;
  const { store } = await fixture({ stream: () => new Promise((done) => { resolve = done; }) });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'https://first.example' });
  const request = store.sendMessage('旧请求');
  store.setConnection({ mode: 'live', apiUrl: 'https://second.example' });
  resolve({ response: '不应出现', thread_id: 'old-thread' }); await request;
  assert.equal(store.getState().messages.length, 0); assert.deepEqual(store.getState().threads, {});
  assert.equal(store.getState().busy, false);
});

test('日期、人数、预算与地址在提交前验证', () => {
  const p = initialState().preferences;
  assert.throws(() => validatePreferences({ ...p, startDate: '2026-02-30' }), /有效日期/);
  assert.throws(() => validatePreferences({ ...p, endDate: '2026-11-06' }), /返程日期/);
  assert.throws(() => validatePreferences({ ...p, travelers: 1.5 }), /人数/);
  assert.throws(() => validatePreferences({ ...p, budget: -1 }), /预算/);
  assert.throws(() => validateConnection({ mode: 'live', apiUrl: 'file:///tmp/service' }), /HTTP/);
  assert.throws(() => validateConnection({ mode: 'live', apiUrl: 'https://user:secret@example.com' }), /密码/);
});

test('损坏的本地记录恢复为可用状态，不导致启动崩溃', async (t) => {
  const storage = memoryStorage(); await storage.setItem(STORAGE_KEY, '{broken');
  const store = createTravelStore(storage); t.after(() => store.dispose()); await store.hydrate();
  assert.equal(store.getState().hydrated, true); assert.equal(store.getState().connection.mode, 'live');
  assert.match(store.getState().toast, /初始体验/);
});

test('保存失败持续提示，重试保存最新内容并在重新打开后恢复行程和撤销记录', async (t) => {
  const storage = memoryStorage();
  let failing = false;
  const store = createTravelStore({ ...storage, async setItem(key, value) {
    if (failing) throw new Error('fixture storage full with private details');
    await storage.setItem(key, value);
  } });
  t.after(() => store.dispose()); await store.hydrate();
  const id = store.saveAssistantTrip({ role: 'assistant', mode: 'live', status: 'complete',
    content: '### Day 1\n**上午｜测试公园**\n散步\n### Day 2\n**上午｜测试书店**\n阅读' }, '武汉');
  const trip = () => store.getState().trips.find((item) => item.id === id);
  store.applyDayAdjustment(id, 0, dayRevision(trip(), 0), [0], [{ index: 0, title: '测试博物馆', time: '下午', detail: '参观' }]);
  await store.flush();
  const previousSaved = await storage.getItem(STORAGE_KEY);
  failing = true;
  store.editActivity(id, 1, 0, { title: '测试书店', time: '10:00', detail: '请保留这条新备注' });
  store.savePreferences({ ...store.getState().preferences, origin: '上海' });
  await store.flush();
  const failure = store.getState().saveError;
  assert.ok(failure);
  assert.doesNotMatch(failure, /private details/);
  assert.equal(store.getState().saving, false);
  assert.equal(await storage.getItem(STORAGE_KEY), previousSaved);
  store.toast('已复制行程'); store.setTab('favorites'); store.toast('');
  assert.equal(store.getState().saveError, failure);
  await store.retrySave();
  assert.equal(store.getState().saveError, failure);
  assert.equal(trip().days[1][0].detail, '请保留这条新备注');
  failing = false;
  await store.retrySave();
  assert.equal(store.getState().saveError, '');
  assert.equal(store.getState().saving, false);
  const saved = JSON.parse(await storage.getItem(STORAGE_KEY));
  assert.equal('saveError' in saved, false);
  assert.equal('saving' in saved, false);
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.equal(reopened.getState().preferences.origin, '上海');
  assert.equal(reopened.getState().trips.find((item) => item.id === id).days[1][0].detail, '请保留这条新备注');
  assert.equal(reopened.canUndoDayAdjustment(id, 0), true);
  reopened.undoDayAdjustment(id, 0);
  assert.equal(reopened.getState().trips.find((item) => item.id === id).days[0][0].title, '测试公园');
});

test('连续写入时只有最新结果能清除失败提示，重复重试复用当前保存任务', async (t) => {
  const storage = memoryStorage(), writes = [];
  let failFirst = true;
  const store = createTravelStore({ ...storage, async setItem(key, value) {
    if (failFirst) { failFirst = false; throw new Error('fixture write failure'); }
    await new Promise((resolve, reject) => writes.push({ value, resolve, reject }));
    await storage.setItem(key, value);
  } });
  t.after(() => store.dispose()); await store.hydrate();
  store.toggleFavorite('coast'); await store.flush();
  const failure = store.getState().saveError;
  const retry = store.retrySave();
  assert.equal(store.retrySave(), retry);
  await new Promise(setImmediate);
  assert.equal(writes.length, 1);
  store.savePreferences({ ...store.getState().preferences, budget: 9000 });
  const latest = store.flush();
  assert.equal(writes.length, 1, '按顺序写入，避免旧数据最后覆盖新数据');
  writes[0].resolve(); await retry;
  await new Promise(setImmediate);
  assert.equal(store.getState().saving, true);
  assert.equal(store.getState().saveError, failure, '旧快照成功后仍有新修改待保存');
  assert.equal(writes.length, 2);
  assert.equal(JSON.parse(writes[1].value).preferences.budget, 9000);
  writes[1].reject(new Error('fixture second failure')); await latest;
  assert.equal(store.getState().saving, false);
  assert.equal(store.getState().saveError, failure);

  // 后续正常编辑同样可以恢复保存，前一次失败不会阻断写入队列。
  store.savePreferences({ ...store.getState().preferences, budget: 10000 });
  await new Promise(setImmediate);
  writes[2].resolve(); await store.flush();
  assert.equal(store.getState().saveError, '');
  assert.equal(store.getState().saving, false);
  assert.equal(JSON.parse(await storage.getItem(STORAGE_KEY)).preferences.budget, 10000);
});

test('旧版升级写回失败后可重试，保留原有行程和设置', async (t) => {
  const storage = memoryStorage();
  const saved = { ...initialState(), version: 1 };
  saved.preferences.origin = '上海';
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  let failing = true;
  const store = createTravelStore({ ...storage, async setItem(key, value) {
    if (failing) throw new Error('fixture storage failure');
    await storage.setItem(key, value);
  } });
  t.after(() => store.dispose()); await store.hydrate(); await store.flush();
  assert.ok(store.getState().saveError);
  assert.equal(store.getState().preferences.origin, '上海');
  assert.equal(JSON.parse(await storage.getItem(STORAGE_KEY)).version, 1);
  failing = false;
  await store.retrySave();
  const reopened = createTravelStore(storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.equal(JSON.parse(await storage.getItem(STORAGE_KEY)).version, 2);
  assert.equal(reopened.getState().preferences.origin, '上海');
  assert.deepEqual(reopened.getState().trips.map((trip) => trip.id), saved.trips.map((trip) => trip.id));
  assert.equal(reopened.getState().saveError, '');
});

test('部分损坏的行程与消息会被过滤，完整记录仍能恢复', async (t) => {
  const storage = memoryStorage();
  const saved = { ...initialState(), version: 1 };
  saved.preferences.origin = '上海';
  saved.trips.push({ ...saved.trips[0], id: 'broken-trip', days: [] });
  saved.trips.push({ id: 'incomplete-trip', days: [[]], completed: [] });
  saved.messages = [null, { id: 'valid-message', role: 'assistant', content: '示例回复', agent: 'team', mode: 'demo' }];
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const store = createTravelStore(storage); t.after(() => store.dispose()); await store.hydrate();
  assert.equal(store.getState().preferences.origin, '上海');
  assert.deepEqual(store.getState().trips.map((trip) => trip.id), ['kyoto-sample']);
  assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().hydrated, true);
});

test('等待超时后可再次发送，且不生成虚假的查询结果', async (t) => {
  const { store } = await fixture({ timeout: 10, stream: (request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  await store.sendMessage('查询酒店');
  assert.match(store.getState().error, /超时/); assert.equal(store.getState().busy, false);
  assert.equal(store.getState().messages.filter((m) => m.role === 'assistant').length, 0);
});

test('每条回复保留自己的查询步骤，恢复历史后仍可查看', async (t) => {
  let round = 0;
  const { store, storage } = await fixture({ stream: async (_input, emit) => {
    round++;
    emit({ type: 'status', key: 'search', label: `查询地点${round}`, kind: 'tool', state: 'running' });
    emit({ type: 'status', key: 'route', label: `查询路线${round}`, kind: 'tool', state: 'running' });
    emit({ type: 'status', key: 'search', label: `查询地点${round}`, kind: 'tool', state: 'complete' });
    emit({ type: 'status', key: 'route', label: `查询路线${round}`, kind: 'tool', state: 'complete' });
    return { response: `结果${round}`, thread_id: 'thread' };
  } });
  t.after(() => store.dispose());
  store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  await store.sendMessage('第一问'); await store.sendMessage('第二问'); await store.flush();
  const replies = store.getState().messages.filter((message) => message.role === 'assistant');
  assert.deepEqual(replies.map((message) => message.progress.map((step) => step.label)), [['查询地点1', '查询路线1'], ['查询地点2', '查询路线2']]);
  assert.ok(replies.every((message) => message.progress.every((step) => step.state === 'complete')));
  const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
  assert.deepEqual(restored.getState().messages.filter((message) => message.role === 'assistant').map((message) => message.progress), replies.map((message) => message.progress));
});

test('查询期间出错时保留步骤并标记中断', async (t) => {
  const { store } = await fixture({ stream: async (_input, emit) => {
    emit({ type: 'status', key: 'search', label: '查询地点', state: 'running' });
    throw new Error('网络中断');
  } });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  await store.sendMessage('查景点');
  const reply = store.getState().messages.at(-1);
  assert.equal(reply.status, 'interrupted'); assert.equal(reply.progress[0].state, 'interrupted');
  assert.equal(store.getState().error, '网络中断');
});

test('按天回复导入草稿，可编辑并恢复，保留原始回复', async (t) => {
  const { store, storage } = await fixture(); t.after(() => store.dispose());
  const content = '## 武汉行程\n### Day 1 · 城市漫游\n**上午｜黄鹤楼** 参观\n**下午｜东湖** 散步\n### Day 2 · 博物馆\n**上午｜省博物馆** 注意预约\n### 📌 实用提醒\n门票待确认';
  const id = store.saveAssistantTrip({ role: 'assistant', mode: 'live', status: 'complete', content }, '武汉');
  let trip = store.getState().trips.find((item) => item.id === id);
  assert.equal(trip.days.length, 2); assert.equal(trip.days[0][0].title, '黄鹤楼'); assert.equal(trip.days[0][0].detail, '参观');
  assert.equal(trip.budget, 0); assert.equal(trip.startDate, ''); assert.equal(trip.sourceText, content);
  store.editActivity(id, 0, 0, { title: '黄鹤楼公园', time: '09:00', detail: '提前预约' });
  store.editActivity(id, 1, -1, { title: '东湖', time: '下午', detail: '散步' }); await store.flush();
  const restored = createTravelStore(storage); t.after(() => restored.dispose()); await restored.hydrate();
  trip = restored.getState().trips.find((item) => item.id === id);
  assert.equal(trip.days[0][0].title, '黄鹤楼公园'); assert.equal(trip.days[1][1].title, '东湖'); assert.equal(trip.sourceText, content);
});

test('非行程、未完成回复不会保存，示例回复保留示例标识', async (t) => {
  const { store } = await fixture(); t.after(() => store.dispose());
  const content = '### Day 1 · 游览\n**上午｜景点** 待核对';
  assert.throws(() => store.saveAssistantTrip({ role: 'assistant', status: 'interrupted', content }, '武汉'), /完整回复/);
  assert.throws(() => store.saveAssistantTrip({ role: 'assistant', content: '你好' }, '武汉'), /未识别/);
  assert.throws(() => store.saveAssistantTrip({ role: 'assistant', content }, ''), /目的地/);
  const id = store.saveAssistantTrip({ role: 'assistant', mode: 'demo', content }, '武汉');
  assert.equal(store.getState().trips.find((trip) => trip.id === id).sample, true);
});
