import { validPoint } from '../domain/map-data.mjs';
import { readDayChanges } from '../domain/day-adjustment.mjs';
const CREDENTIAL_KEY = 'roam.chat.credentials.v1';
const abortError = () => { const error = new Error('Request aborted'); error.name = 'AbortError'; return error; };

export function createChatClient({ fetch, storage, connectSocket, reconnectDelays = [400, 1200], heartbeatTimeout = 25000 }) {
  const pendingTokens = new Map();
  const readTokens = async () => {
    try { const result = JSON.parse(await storage.getItem(CREDENTIAL_KEY) || '{}'); return result && typeof result === 'object' ? result : {}; }
    catch { return {}; }
  };
  const forgetToken = async (apiUrl) => { const tokens = await readTokens(); delete tokens[apiUrl]; await storage.setItem(CREDENTIAL_KEY, JSON.stringify(tokens)); };
  const tokenFor = async (apiUrl) => {
    if (pendingTokens.has(apiUrl)) return pendingTokens.get(apiUrl);
    const promise = (async () => {
      const tokens = await readTokens();
      if (typeof tokens[apiUrl] === 'string') return tokens[apiUrl];
      const response = await fetch(`${apiUrl}/api/v1/chat/devices`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok || typeof data.token !== 'string') throw new Error('无法创建聊天设备凭证，请检查后端是否已更新');
      // Re-read so another endpoint's concurrent credential is not overwritten.
      const latest = await readTokens(); latest[apiUrl] = data.token;
      await storage.setItem(CREDENTIAL_KEY, JSON.stringify(latest));
      return data.token;
    })();
    pendingTokens.set(apiUrl, promise);
    try { return await promise; } finally { pendingTokens.delete(apiUrl); }
  };
  const request = async (apiUrl, path, method = 'GET') => {
    const token = await tokenFor(apiUrl);
    const response = await fetch(`${apiUrl}/api/v1/chat${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) await forgetToken(apiUrl);
      throw new Error(typeof data.detail === 'string' ? data.detail : '读取对话记录失败，请重试');
    }
    return data;
  };
  const post = async (apiUrl, path, body, signal, fallback) => {
    const token = await tokenFor(apiUrl);
    const response = await fetch(`${apiUrl}/api/v1/${path}`, { method: 'POST', signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 401) await forgetToken(apiUrl);
      throw new Error(typeof data.detail === 'string' ? data.detail : fallback);
    }
    return data;
  };
  const mapRequest = (apiUrl, path, body, signal) => post(apiUrl, `map/${path}`, body, signal, '地图查询失败，请重试');
  const normalizedPlaces = (data) => {
    if (typeof data.source !== 'string' || !data.source || typeof data.retrieved_at !== 'string' || !data.retrieved_at || data.coordinate_system !== 'gcj02'
      || !Array.isArray(data.places) || data.places.length > 5 || data.places.some((place) => !validPoint(place) || typeof place.name !== 'string' || !place.name.trim() || place.name.length > 100 || typeof place.address !== 'string' || place.address.length > 200)) {
      throw new Error('地点数据格式异常，无法在地图上显示');
    }
    return data.places.map((place) => ({ ...place, source: data.source, retrieved_at: data.retrieved_at, coordinate_system: 'gcj02' }));
  };
  return {
    async adjustDay(apiUrl, request, signal) {
      const data = await post(apiUrl, 'trips/adjust-day', request, signal, '无法生成改动，请检查后端版本或调整要求');
      return readDayChanges(data?.changes, request.targets);
    },
    async searchPlaces(apiUrl, city, query) {
      const data = await mapRequest(apiUrl, 'places', { city, query });
      normalizedPlaces(data);
      return data;
    },
    async resolvePlaces(apiUrl, city, queries, signal) {
      const data = await mapRequest(apiUrl, 'resolve', { city, queries }, signal);
      if (!Array.isArray(data.results) || data.results.length !== queries.length) throw new Error('地点查询返回格式异常');
      return data.results.map((item, index) => {
        if (item.query !== queries[index]) throw new Error('地点查询返回顺序异常');
        if (item.failure) return { query: item.query, places: [], failure: item.failure };
        return { ...item, places: normalizedPlaces(item).map((place) => ({ ...place, city })) };
      });
    },
    async routeDay(apiUrl, stops, mode, segments, signal) {
      const data = await mapRequest(apiUrl, 'routes', { stops: stops.map(({ latitude, longitude }) => ({ latitude, longitude })), mode, ...(segments ? { segments } : {}) }, signal);
      const expected = segments || stops.slice(1).map((_, index) => index);
      if (data.coordinate_system !== 'gcj02' || data.mode !== mode || !Array.isArray(data.legs) || data.legs.length !== expected.length
        || data.legs.some((leg, index) => leg.index !== expected[index] || (!leg.failure && (typeof leg.source !== 'string' || typeof leg.retrieved_at !== 'string'
          || leg.coordinate_system !== 'gcj02' || !Array.isArray(leg.points) || leg.points.length < 2 || leg.points.length > 2000 || !leg.points.every(validPoint)
          || !Number.isFinite(leg.distance_m) || leg.distance_m < 0 || !Number.isFinite(leg.duration_seconds) || leg.duration_seconds < 0)))) {
        throw new Error('路线数据格式异常，暂时仅显示地点');
      }
      return data.legs;
    },
    async list(apiUrl, agent) {
      const data = await request(apiUrl, `/conversations?agent=${agent}`);
      if (!Array.isArray(data.conversations) || data.conversations.some((item) => !item || typeof item.id !== 'string' || typeof item.title !== 'string')) throw new Error('服务返回的历史记录格式异常，请检查后端版本');
      return data.conversations;
    },
    async get(apiUrl, id) {
      const data = await request(apiUrl, `/conversations/${encodeURIComponent(id)}`);
      if (typeof data.id !== 'string' || !Array.isArray(data.messages)) throw new Error('服务返回的对话格式异常，请重试');
      return data;
    },
    delete(apiUrl, id) { return request(apiUrl, `/conversations/${encodeURIComponent(id)}`, 'DELETE'); },
    async stream(input, onEvent) {
      const token = await tokenFor(input.apiUrl);
      if (input.signal.aborted) throw abortError();
      return new Promise((resolve, reject) => {
        let socket, finished = false, content = '', conversationId = input.threadId;
        let lastSeq = 0, generation = 0, retries = 0, retryTimer, heartbeatTimer, started = false, recovering = false;
        const close = (task) => { try { task?.close({ code: 1000 })?.catch?.(() => {}); } catch {} };
        const finish = (callback, value) => {
          if (finished) return;
          finished = true; generation++; clearTimeout(retryTimer); clearTimeout(heartbeatTimer);
          input.signal.removeEventListener('abort', abort); close(socket); callback(value);
        };
        const abort = () => {
          if (finished) return;
          try { socket?.send({ data: JSON.stringify({ type: 'cancel' }), fail() {} })?.catch?.(() => {}); } catch {}
          // Also works while the socket is offline or closes before cancel arrives.
          void fetch(`${input.apiUrl}/api/v1/chat/requests/${encodeURIComponent(input.requestId)}/cancel`, {
            method: 'POST', headers: { Authorization: `Bearer ${token}` }
          }).catch(() => {});
          finish(reject, abortError());
        };
        const reconnect = (message) => {
          if (finished || retryTimer) return;
          generation++; clearTimeout(heartbeatTimer); close(socket);
          if (retries >= reconnectDelays.length) {
            const error = new Error(message); error.kind = 'network'; error.retryable = true;
            finish(reject, error); return;
          }
          recovering = true; onEvent({ type: 'connection', state: 'reconnecting' });
          retryTimer = setTimeout(() => { retryTimer = undefined; connect(); }, reconnectDelays[retries++]);
        };
        const alive = () => {
          clearTimeout(heartbeatTimer);
          heartbeatTimer = setTimeout(() => reconnect('连接长时间无响应，可以重试恢复结果'), heartbeatTimeout);
        };
        const connect = () => {
          if (finished) return;
          if (input.signal.aborted) { abort(); return; }
          const current = ++generation;
          const failed = () => { if (current === generation) reconnect('实时连接失败，请检查服务地址和微信 socket 合法域名'); };
          const attach = (task) => {
            if (finished || current !== generation) { close(task); return; }
            socket = task;
            if (!socket || typeof socket.onOpen !== 'function') { failed(); return; }
            socket.onOpen(() => {
              if (finished || current !== generation) return;
              alive();
              try {
                const value = socket.send({ data: JSON.stringify({ type: 'start', token, agent: input.agent,
                  conversation_id: conversationId || null, request_id: input.requestId, query: input.query, preferences: input.preferences,
                  resume: started, after_seq: lastSeq }), fail: failed });
                started = true; value?.catch?.(failed);
              } catch { failed(); }
            });
            socket.onMessage((message) => {
              if (finished || current !== generation) return;
              alive();
              try {
                const event = JSON.parse(message.data);
                if (recovering) { recovering = false; onEvent({ type: 'connection', state: 'connected' }); }
                if (event.type === 'heartbeat') return;
                if (Number.isInteger(event.seq) && event.seq > 0) {
                  if (event.seq <= lastSeq) return;
                  if (event.seq !== lastSeq + 1) throw new Error('回复事件不连续，请重新读取对话');
                  lastSeq = event.seq;
                }
                if (event.type === 'accepted') conversationId = event.conversation_id;
                if (event.type === 'delta') content += event.content || '';
                if (event.type === 'final') content = event.content || '';
                if (['accepted', 'status', 'delta', 'final', 'artifact'].includes(event.type)) onEvent(event);
                if (event.type === 'done') {
                  if (!content.trim()) throw new Error('服务返回了空回复，请重试');
                  finish(resolve, { response: content, thread_id: event.conversation_id || conversationId });
                } else if (event.type === 'error') {
                  if (event.code === 401) void forgetToken(input.apiUrl).catch(() => {});
                  const error = new Error(event.message || '旅行服务暂不可用');
                  Object.assign(error, event.failure || {}, { code: event.code });
                  finish(reject, error);
                } else if (event.type === 'cancelled') finish(reject, abortError());
              } catch (error) { finish(reject, error instanceof Error ? error : new Error('聊天消息格式异常')); }
            });
            socket.onError(failed);
            socket.onClose(() => {
              if (finished || current !== generation) return;
              if (!lastSeq && content) finish(reject, new Error('连接在回复完成前断开，可以重试恢复结果'));
              else reconnect('连接在回复完成前断开，可以重试恢复结果');
            });
          };
          try {
            alive();
            const task = connectSocket({ url: `${input.apiUrl.replace(/^http/i, 'ws')}/api/v1/chat/ws`, fail: failed });
            if (typeof task?.onOpen === 'function') { task.catch?.(failed); attach(task); }
            else Promise.resolve(task).then(attach).catch(failed);
          } catch { failed(); }
        };
        input.signal.addEventListener('abort', abort);
        connect();
      });
    }
  };
}
