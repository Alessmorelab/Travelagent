const CREDENTIAL_KEY = 'roam.chat.credentials.v1';
const abortError = () => { const error = new Error('Request aborted'); error.name = 'AbortError'; return error; };

export function createChatClient({ fetch, storage, connectSocket }) {
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
  return {
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
        const close = () => { try { socket?.close({ code: 1000 })?.catch?.(() => {}); } catch {} };
        const send = (value) => { socket.send(value)?.catch?.(() => {}); };
        const finish = (callback, value) => {
          if (finished) return;
          finished = true; input.signal.removeEventListener('abort', abort);
          callback(value);
          close();
        };
        const abort = () => {
          if (finished) return;
          try { if (socket) send({ data: JSON.stringify({ type: 'cancel' }), fail() {} }); } catch {}
          finish(reject, abortError());
        };
        input.signal.addEventListener('abort', abort);
        const connectionFailed = () => finish(reject, new Error('实时连接失败，请检查服务地址和微信 socket 合法域名'));
        const attachSocket = (task) => {
          socket = task;
          // Taro resolves Promise<SocketTask>; native wx returns the task directly.
          // A task that arrives after cancellation must still be closed.
          if (finished) { close(); return; }
          if (input.signal.aborted) { abort(); return; }
          if (!socket || typeof socket.onOpen !== 'function') {
            finish(reject, new Error('实时连接初始化失败，请检查小程序版本后重试'));
            return;
          }
          socket.onOpen(() => {
            if (finished) { close(); return; }
            if (input.signal.aborted) { abort(); return; }
            send({ data: JSON.stringify({ type: 'start', token, agent: input.agent,
              conversation_id: input.threadId || null, request_id: input.requestId, query: input.query, preferences: input.preferences }),
            fail: () => finish(reject, new Error('发送失败，请检查网络后重试')) });
          });
          socket.onMessage((message) => {
            if (finished) return;
            try {
              const event = JSON.parse(message.data);
              if (event.type === 'accepted') conversationId = event.conversation_id;
              if (event.type === 'delta') content += event.content || '';
              if (event.type === 'final') content = event.content || '';
              if (['accepted', 'status', 'delta', 'final'].includes(event.type)) onEvent(event);
              if (event.type === 'done') {
                if (!content.trim()) throw new Error('服务返回了空回复，请重试');
                finish(resolve, { response: content, thread_id: event.conversation_id || conversationId });
              } else if (event.type === 'error') {
                if (event.code === 401) void forgetToken(input.apiUrl).catch(() => {});
                finish(reject, new Error(event.message || '旅行服务暂不可用'));
              } else if (event.type === 'cancelled') finish(reject, abortError());
            } catch (error) { finish(reject, error instanceof Error ? error : new Error('聊天消息格式异常')); }
          });
          socket.onError(connectionFailed);
          socket.onClose(() => finish(reject, new Error('连接在回复完成前断开，可以重试恢复结果')));
        };
        try {
          const connecting = connectSocket({ url: `${input.apiUrl.replace(/^http/i, 'ws')}/api/v1/chat/ws`, fail: connectionFailed });
          if (typeof connecting?.onOpen === 'function') {
            // Bind synchronous tasks immediately so an early open event is not missed.
            connecting.catch?.(connectionFailed);
            attachSocket(connecting);
          } else {
            Promise.resolve(connecting).then(attachSocket).catch(connectionFailed);
          }
          if (input.signal.aborted) abort();
        } catch (error) { finish(reject, error); }
      });
    }
  };
}
