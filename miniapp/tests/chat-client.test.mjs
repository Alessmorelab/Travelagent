import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '../src/services/chat-client.mjs';
import { createMiniController } from '../src/services/wechat.mjs';
import { createTravelStore } from '../src/domain/travel.mjs';

function fixture({ promised = false, deferred = false, rejected = false } = {}) {
  const values = new Map(), calls = [], sockets = [];
  const storage = { async getItem(key) { return values.get(key) || null; }, async setItem(key, value) { values.set(key, value); } };
  let ready;
  const connected = new Promise((resolve) => { ready = resolve; });
  let created, resolveSocket;
  const socketCreated = new Promise((resolve) => { created = resolve; });
  const deferredSocket = new Promise((resolve) => { resolveSocket = resolve; });
  const client = createChatClient({ storage, fetch: async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, async json() { return url.endsWith('/devices') ? { token: 'private-device-token' } : { conversations: [] }; } };
  }, connectSocket(options) {
    const handlers = {}, sent = [];
    const socket = { options, handlers, sent, closed: false,
      onOpen(fn) { handlers.open = fn; queueMicrotask(() => { handlers.open?.(); ready(socket); }); },
      onMessage(fn) { handlers.message = fn; }, onError(fn) { handlers.error = fn; }, onClose(fn) { handlers.close = fn; },
      send(value) { sent.push(JSON.parse(value.data)); }, close() { this.closed = true; handlers.close?.(); } };
    sockets.push(socket); created(socket);
    if (deferred) return deferredSocket;
    if (rejected) return Promise.reject(new Error('native connection failure'));
    return promised ? Promise.resolve(socket) : socket;
  } });
  return { client, storage, calls, sockets, connected, socketCreated, resolveSocket };
}
const input = () => ({ apiUrl: 'https://travel.example', agent: 'team', query: '京都旅行', preferences: '两个人', requestId: 'request-1', signal: createMiniController().signal });

test('WebSocket 逐步接收回复，凭证放在握手消息中，收到 done 才确认成功', async () => {
  const f = fixture(), events = [];
  const pending = f.client.stream(input(), (event) => events.push(event));
  const socket = await f.connected; await Promise.resolve();
  assert.equal(socket.options.url, 'wss://travel.example/api/v1/chat/ws');
  assert.ok(!socket.options.url.includes('private-device-token'));
  assert.equal(socket.sent[0].token, 'private-device-token');
  for (const event of [{ type: 'accepted', conversation_id: 'conversation-1' }, { type: 'status', key: 'hotel', label: '查询酒店', state: 'running' }, { type: 'delta', content: '京都' }, { type: 'delta', content: '建议' }, { type: 'done', conversation_id: 'conversation-1' }]) socket.handlers.message({ data: JSON.stringify(event) });
  assert.deepEqual(await pending, { response: '京都建议', thread_id: 'conversation-1' });
  assert.equal(events.filter((event) => event.type === 'delta').length, 2);
  await f.client.list('https://travel.example', 'team');
  assert.equal(f.calls.filter((call) => call.url.endsWith('/devices')).length, 1);
  assert.equal(f.calls.at(-1).init.headers.Authorization, 'Bearer private-device-token');
});

test('收到部分回复后断线属于失败，可以用同一个请求编号重试', async () => {
  const f = fixture();
  const pending = f.client.stream(input(), () => {});
  const socket = await f.connected;
  socket.handlers.message({ data: JSON.stringify({ type: 'delta', content: '尚未完成' }) });
  socket.handlers.close();
  await assert.rejects(pending, /完成前断开/);
});

test('停止等待会发送 cancel 且关闭实时连接', async () => {
  const f = fixture(), controller = createMiniController();
  const pending = f.client.stream({ ...input(), signal: controller.signal }, () => {});
  const socket = await f.connected; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(socket.sent.some((message) => message.type === 'cancel'));
});

test('Taro Promise<SocketTask> 完成后绑定事件、发送握手并接收真实协议事件', async () => {
  const f = fixture({ promised: true }), events = [];
  const pending = f.client.stream(input(), (event) => events.push(event));
  const socket = await f.connected;
  assert.equal(socket.sent[0].type, 'start');
  for (const event of [{ type: 'accepted', conversation_id: 'async-1' },
    { type: 'status', key: 'map_search_places', label: '百度地图：查找地点', state: 'complete' },
    { type: 'final', content: '黄鹤楼位于武汉市武昌区。' }, { type: 'done', conversation_id: 'async-1' }]) {
    socket.handlers.message({ data: JSON.stringify(event) });
  }
  assert.deepEqual(await pending, { response: '黄鹤楼位于武汉市武昌区。', thread_id: 'async-1' });
  assert.equal(events.length, 3);
  assert.equal(socket.closed, true);
});

test('等待异步 SocketTask 时取消，迟到的任务会关闭且不会发送握手', async () => {
  const f = fixture({ deferred: true }), controller = createMiniController();
  const pending = f.client.stream({ ...input(), signal: controller.signal }, () => {});
  const socket = await f.socketCreated;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  f.resolveSocket(socket);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(socket.closed, true);
  assert.deepEqual(socket.sent, []);
});

test('Taro 异步连接失败会结束等待并返回可读提示', async () => {
  const f = fixture({ rejected: true });
  await assert.rejects(f.client.stream(input(), () => {}), /实时连接失败/);
});

test('示例对话可以流式显示、归档、恢复，开启新对话不删除旧记录', async (t) => {
  const f = fixture();
  const store = createTravelStore(f.storage, { demoDelay: 0, demoStreaming: true });
  t.after(() => store.dispose()); await store.hydrate();
  let partial = false;
  store.subscribe((state) => { if (state.busy && state.messages.at(-1)?.content) partial = true; });
  await store.sendMessage('规划京都');
  assert.ok(partial);
  assert.equal(store.getState().messages.at(-1).status, 'complete');
  store.newConversation(); assert.equal(store.getState().messages.length, 0);
  const archived = store.getChatHistory()[0];
  assert.equal(archived.title, '规划京都');
  await store.sendMessage('换成东京');
  store.restoreConversation(archived);
  assert.equal(store.getState().messages[0].content, '规划京都');
  assert.equal(store.getChatHistory().length, 2);
  await store.flush();
  const reopened = createTravelStore(f.storage); t.after(() => reopened.dispose()); await reopened.hydrate();
  assert.equal(reopened.getChatHistory().length, 2);
});

test('流式失败保留部分回复，重试沿用请求编号且不重复添加提问', async (t) => {
  const f = fixture(), ids = []; let fail = true;
  const store = createTravelStore(f.storage, { stream: async (request, event) => {
    ids.push(request.requestId);
    event({ type: 'accepted', conversation_id: 'remote-1' });
    event({ type: 'delta', content: '部分内容' });
    if (fail) throw new Error('连接中断');
    event({ type: 'final', content: '完整内容' });
    return { response: '完整内容', thread_id: 'remote-1' };
  } });
  t.after(() => store.dispose()); await store.hydrate();
  store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  await store.sendMessage('查询酒店');
  assert.equal(store.getState().messages.at(-1).status, 'interrupted');
  fail = false; await store.sendMessage(store.getState().lastQuery, true);
  assert.equal(ids[0], ids[1]);
  assert.equal(store.getState().messages.length, 2);
  assert.equal(store.getState().messages.at(-1).content, '完整内容');
});

test('停止尚未出字的回复后保留停止状态，迟到的分片不会覆盖消息', async (t) => {
  const f = fixture(); let deliver, reject;
  const store = createTravelStore(f.storage, { stream: async (request, event) => {
    deliver = event;
    return new Promise((_resolve, fail) => { reject = fail; });
  } });
  t.after(() => store.dispose()); await store.hydrate();
  store.setConnection({ mode: 'live', apiUrl: 'https://travel.example' });
  const waiting = store.sendMessage('规划武汉三日游');
  store.cancelMessage();
  deliver({ type: 'delta', content: '不应显示的迟到消息' });
  reject(new Error('Request aborted')); await waiting;
  assert.equal(store.getState().busy, false);
  assert.equal(store.getState().messages.length, 2);
  assert.equal(store.getState().messages.at(-1).status, 'interrupted');
  assert.equal(store.getState().messages.at(-1).content, '');
  assert.equal(store.getState().error, '');
});

test('从专业助手开启统一新对话时保留原有示例历史', async (t) => {
  const f = fixture();
  const store = createTravelStore(f.storage, { demoDelay: 0 });
  t.after(() => store.dispose()); await store.hydrate();
  await store.sendMessage('整趟行程');
  store.setAgent('hotels'); await store.sendMessage('附近住哪里');
  store.newConversation('team');
  assert.equal(store.getState().agent, 'team');
  assert.equal(store.getState().messages.filter((item) => item.agent === 'team').length, 0);
  assert.equal(store.getChatHistory()[0].title, '整趟行程');
  store.setAgent('hotels');
  assert.equal(store.getChatHistory()[0].title, '附近住哪里');
});
