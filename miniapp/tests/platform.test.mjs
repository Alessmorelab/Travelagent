import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createTravelStore } from '../src/domain/travel.mjs';
import { createMiniController, createMiniFetch, createMiniStorage, validateMiniConnection } from '../src/services/wechat.mjs';

function storageFixture() {
  const data = new Map();
  return { data, getStorageSync(key) { return data.get(key) || ''; }, setStorageSync(key, value) { data.set(key, value); } };
}
function options(platform) {
  return { fetch: createMiniFetch(platform), createAbortController: createMiniController, validateConnection: validateMiniConnection, demoDelay: 0 };
}

test('微信请求保留方法、JSON 内容与接口状态，HTTP 失败不会伪装成成功', async () => {
  const calls = [];
  const fetch = createMiniFetch({ request(request) {
    calls.push(request); queueMicrotask(() => request.success({ statusCode: 503, data: { detail: '服务暂不可用' } }));
    return { abort() {} };
  } });
  const result = await fetch('https://travel.example/api/v1/chat/devices', { method: 'POST', body: '{"query":"京都"}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(result.status, 503); assert.equal(result.ok, false);
  assert.equal(calls[0].method, 'POST'); assert.equal(calls[0].data, '{"query":"京都"}');
  assert.equal(calls[0].header['Content-Type'], 'application/json');
  assert.deepEqual(await result.json(), { detail: '服务暂不可用' });
});

test('停止等待会调用微信 RequestTask.abort，并拒绝迟到的结果', async () => {
  let callback, aborted = 0;
  const fetch = createMiniFetch({ request(request) { callback = request; return { abort() { aborted++; } }; } });
  const controller = createMiniController();
  const pending = fetch('https://travel.example/', { signal: controller.signal });
  controller.abort(); controller.abort();
  callback.success({ statusCode: 200, data: { response: '迟到的结果' } });
  await assert.rejects(pending, (error) => error.name === 'AbortError');
  assert.equal(aborted, 1);
});

test('已取消的请求不会触发网络调用', async () => {
  let calls = 0;
  const fetch = createMiniFetch({ request() { calls++; return { abort() {} }; } });
  const controller = createMiniController(); controller.abort();
  await assert.rejects(fetch('https://travel.example/', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('微信域名校验与网络错误显示具体提示', async () => {
  const fetch = createMiniFetch({ request(request) { queueMicrotask(() => request.fail({ errMsg: 'request:fail url not in domain list' })); return { abort() {} }; } });
  await assert.rejects(fetch('https://travel.example/'), /服务域名未获微信允许/);
});

test('小程序地址校验无需 URL 全局，并过滤非 HTTP 地址、账号及无效端口', () => {
  assert.deepEqual(validateMiniConnection({ mode: 'live', apiUrl: ' HTTPS://Travel.Example/api/ ' }), { mode: 'live', apiUrl: 'https://travel.example/api' });
  assert.equal(validateMiniConnection({ mode: 'live', apiUrl: 'http://192.168.1.8:8000/' }).apiUrl, 'http://192.168.1.8:8000');
  for (const apiUrl of ['file:///etc/config', 'https://user:secret@travel.example', 'https://travel.example?key=secret', 'https://travel.example:99999', 'https://travel.example\\other', 'https://travel..example']) {
    assert.throws(() => validateMiniConnection({ mode: 'live', apiUrl }));
  }
});

test('微信本地存储与共用业务逻辑可以恢复收藏和行程草稿', async (t) => {
  const platform = storageFixture();
  const store = createTravelStore(createMiniStorage(platform), options({ request() { throw new Error('示例模式不应联网'); } }));
  t.after(() => store.dispose()); await store.hydrate();
  store.toggleFavorite('tokyo');
  store.createTrip({ ...store.getState().preferences, destination: '东京', travelers: 3 });
  await store.sendMessage('去东京'); await store.flush();
  const restored = createTravelStore(createMiniStorage(platform), options({ request() {} }));
  t.after(() => restored.dispose()); await restored.hydrate();
  assert.ok(restored.getState().favorites.includes('tokyo'));
  assert.equal(restored.getState().trips[0].destination, '东京');
  assert.equal(restored.getState().trips[0].travelers, 3);
  assert.equal(restored.getState().messages.length, 2);
});

test('在没有 fetch、URL、AbortController 的小程序环境中可运行示例与流式对话', async (t) => {
  const source = (await readFile(new URL('../src/domain/travel.mjs', import.meta.url), 'utf8')).replace(/^export /gm, '');
  const sandbox = { setTimeout, clearTimeout }; vm.createContext(sandbox);
  const create = vm.runInContext(`${source}\ncreateTravelStore`, sandbox);
  const calls = []; const platform = { ...storageFixture(), request() { throw new Error('不应调用旧接口'); } };
  const store = create(createMiniStorage(platform), { ...options(platform), stream: async (input) => { calls.push(input); return { response: '测试服务回复', thread_id: 'wechat-thread' }; } });
  t.after(() => store.dispose()); await store.hydrate(); await store.sendMessage('想去京都');
  assert.equal(calls.length, 0); store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  store.setAgent('flights'); await store.sendMessage('查询机票'); await store.sendMessage('再看看直飞');
  assert.equal(calls[0].query, '查询机票'); assert.equal(calls[1].threadId, 'wechat-thread'); assert.equal(store.getState().messages.at(-1).content, '测试服务回复');
});

test('小程序流式请求超时可恢复发送状态，不产生成功回复', async (t) => {
  let aborts = 0; const platform = { request() { throw new Error('不应调用旧接口'); } };
  const stream = (input) => new Promise((_resolve, reject) => input.signal.addEventListener('abort', () => { aborts++; const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }));
  const store = createTravelStore(createMiniStorage(storageFixture()), { ...options(platform), stream, timeout: 8 });
  t.after(() => store.dispose()); await store.hydrate(); store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' }); await store.sendMessage('查询酒店');
  assert.match(store.getState().error, /超时/); assert.equal(store.getState().busy, false); assert.equal(aborts, 1); assert.equal(store.getState().messages.length, 1);
});
