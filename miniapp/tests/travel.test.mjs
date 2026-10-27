import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore, initialState, STORAGE_KEY, validatePreferences, validateConnection } from '../src/domain/travel.mjs';

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
  const { store } = await fixture({ fetch: async (url, request) => {
    const body = JSON.parse(request.body); calls.push({ url, body });
    const agent = url.split('/').at(-2);
    return { ok: true, json: async () => ({ response: `${agent}真实结果`, thread_id: `thread-${agent}` }) };
  } }); t.after(() => store.dispose());
  store.setConnection({ mode: 'live', apiUrl: 'https://travel.example/' });
  store.savePreferences(store.getState().preferences);
  for (const agent of ['team', 'flights', 'hotels', 'destinations', 'flights']) { store.setAgent(agent); await store.sendMessage('查询旅行信息'); }
  assert.deepEqual(calls.map((call) => call.url), ['team', 'flights', 'hotels', 'destinations', 'flights'].map((agent) => `https://travel.example/api/v1/${agent}/search`));
  assert.deepEqual(calls.map((call) => call.body.thread_id), [null, null, null, null, 'thread-flights']);
  assert.match(calls[0].body.query, /武汉出发/);
  assert.match(calls[0].body.query, /总预算人民币8000元/);
  assert.equal(store.getState().messages.at(-1).mode, 'live');
});

for (const transport of ['http', 'websocket']) {
  test(`${transport} 真实请求排除默认示例偏好，主动保存后才附带且重新打开后保持`, async (t) => {
    const calls = [];
    const options = transport === 'http' ? { fetch: async (_url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ response: '武汉建议' }) };
    } } : { stream: async (input) => { calls.push(input); return { response: '武汉建议' }; } };
    const { store, storage } = await fixture(options); t.after(() => store.dispose());
    store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
    await store.sendMessage('想去武汉玩几天');
    assert.equal(calls[0].query, '想去武汉玩几天');
    assert.equal(calls[0].preferences || '', '');
    assert.doesNotMatch(JSON.stringify(calls[0]), /京都|8000/);
    store.savePreferences({ ...store.getState().preferences, destination: '武汉', budget: 3000 });
    await store.flush();
    const restored = createTravelStore(storage, options); t.after(() => restored.dispose()); await restored.hydrate();
    await restored.sendMessage('查景点');
    assert.match(calls[1].preferences || calls[1].query, /前往武汉/);
    assert.match(calls[1].preferences || calls[1].query, /3000元/);
  });
}

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
  const { store } = await fixture({ fetch: async () => fail ? { ok: false, status: 503, json: async () => ({ detail: '旅行服务暂不可用' }) } : { ok: true, json: async () => ({ response: '恢复后的真实回复', thread_id: 'recovered' }) } });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'http://localhost:8000' });
  await store.sendMessage('查询机票');
  assert.equal(store.getState().messages.length, 1);
  assert.equal(store.getState().error, '旅行服务暂不可用'); assert.equal(store.getState().busy, false);
  fail = false; await store.sendMessage(store.getState().lastQuery, true);
  assert.equal(store.getState().messages.length, 2); assert.equal(store.getState().error, '');
});

test('切换服务会取消旧请求，迟到的结果不会污染新会话', async (t) => {
  let resolve;
  const { store } = await fixture({ fetch: () => new Promise((done) => { resolve = done; }) });
  t.after(() => store.dispose()); store.setConnection({ mode: 'live', apiUrl: 'https://first.example' });
  const request = store.sendMessage('旧请求');
  store.setConnection({ mode: 'live', apiUrl: 'https://second.example' });
  resolve({ ok: true, json: async () => ({ response: '不应出现', thread_id: 'old-thread' }) }); await request;
  assert.equal(store.getState().messages.length, 1); assert.deepEqual(store.getState().threads, {});
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
  assert.equal(store.getState().hydrated, true); assert.equal(store.getState().connection.mode, 'demo');
  assert.match(store.getState().toast, /初始体验/);
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
  const { store } = await fixture({ timeout: 10, fetch: (_url, request) => new Promise((_resolve, reject) => request.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))) });
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
