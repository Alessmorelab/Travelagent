import test from 'node:test';
import assert from 'node:assert/strict';
import { createTravelStore, initialState, STORAGE_KEY } from '../src/domain/travel.mjs';

function memory() {
  const data = new Map();
  return { async getItem(key) { return data.get(key) || null; }, async setItem(key, value) { data.set(key, value); } };
}

test('首次打开直接使用8000端口真实聊天，不需要保存服务设置', async (t) => {
  const calls = [], storage = memory();
  const store = createTravelStore(storage, { stream: async (input) => { calls.push(input); return { response: '真实模型回复' }; } });
  t.after(() => store.dispose()); await store.hydrate();
  assert.deepEqual(store.getState().connection, { mode: 'live', apiUrl: 'http://127.0.0.1:8000' });
  await store.sendMessage('你好');
  assert.equal(calls.length, 1); assert.equal(calls[0].apiUrl, 'http://127.0.0.1:8000');
  assert.equal(calls[0].preferences, '');
  assert.equal(store.getState().messages.at(-1).content, '真实模型回复');
  assert.equal(store.getState().messages.at(-1).mode, 'live');
});

test('旧示例模式和占位地址自动升级，保留行程、收藏与示例历史', async (t) => {
  const storage = memory();
  const saved = { ...initialState(), version: 1, connection: { mode: 'demo', apiUrl: 'https://api.example.com' } };
  saved.favorites = ['coast'];
  saved.messages = [{ id: 'old-demo', role: 'assistant', agent: 'team', mode: 'demo', content: '历史示例回复' }];
  await storage.setItem(STORAGE_KEY, JSON.stringify(saved));
  const calls = [];
  const store = createTravelStore(storage, { stream: async (input) => { calls.push(input); return { response: '本次真实回复' }; } });
  t.after(() => store.dispose()); await store.hydrate(); await store.flush();
  assert.deepEqual(store.getState().connection, { mode: 'live', apiUrl: 'http://127.0.0.1:8000' });
  assert.deepEqual(store.getState().trips.map((trip) => trip.id), saved.trips.map((trip) => trip.id));
  assert.deepEqual(store.getState().favorites, ['coast']);
  assert.equal(store.getState().messages[0].content, '历史示例回复');
  assert.equal(JSON.parse(await storage.getItem(STORAGE_KEY)).version, 2);
  await store.sendMessage('实际查询'); assert.equal(calls.length, 1);
  assert.equal(store.getState().messages.at(-1).mode, 'live');
});

test('升级保留已配置的真实服务地址与会话编号', async (t) => {
  const storage = memory();
  await storage.setItem(STORAGE_KEY, JSON.stringify({ ...initialState(), version: 1,
    connection: { mode: 'live', apiUrl: 'https://fixture.example' }, threads: { team: 'existing-thread' } }));
  const calls = [];
  const store = createTravelStore(storage, { stream: async (input) => { calls.push(input); return { response: '继续对话' }; } });
  t.after(() => store.dispose()); await store.hydrate(); await store.sendMessage('继续');
  assert.equal(calls[0].apiUrl, 'https://fixture.example'); assert.equal(calls[0].threadId, 'existing-thread');
});

test('升级后主动切换到示例模式，重新打开仍保留用户选择', async (t) => {
  const storage = memory(), store = createTravelStore(storage, { demoDelay: 0 });
  t.after(() => store.dispose()); await store.hydrate();
  store.setConnection({ ...store.getState().connection, mode: 'demo' }); await store.flush();
  const reopened = createTravelStore(storage, { demoDelay: 0, stream: async () => { assert.fail('主动选择示例时不应调用模型'); } });
  t.after(() => reopened.dispose()); await reopened.hydrate(); await reopened.sendMessage('看看示例');
  assert.equal(reopened.getState().connection.mode, 'demo');
  assert.match(reopened.getState().messages.at(-1).content, /示例回复/);
});
