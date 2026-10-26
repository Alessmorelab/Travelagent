// This adapter intentionally uses no browser-only URL, fetch, AbortController or DOMException.
export function createMiniController() {
  const listeners = new Set();
  const signal = {
    aborted: false,
    addEventListener(type, listener) { if (type === 'abort') listeners.add(listener); },
    removeEventListener(type, listener) { if (type === 'abort') listeners.delete(listener); }
  };
  return { signal, abort() {
    if (signal.aborted) return;
    signal.aborted = true;
    for (const listener of [...listeners]) listener();
    listeners.clear();
  } };
}

export function validateMiniConnection(value) {
  if (!value || !['demo', 'live'].includes(value.mode)) throw new Error('请选择有效的体验模式');
  const address = String(value.apiUrl || '').trim();
  const match = /^(https?):\/\/([^\s/?#]+)(\/[^\s?#]*)?$/i.exec(address);
  if (!match || match[2].includes('@') || match[2].includes('\\') || address.includes('\\')) {
    throw new Error('请输入完整的 HTTP 或 HTTPS 服务地址，不含账号、密码或查询参数');
  }
  const authority = /^([a-z\d.-]+)(?::(\d+))?$/i.exec(match[2]);
  if (!authority || authority[1].startsWith('.') || authority[1].endsWith('.') || authority[1].includes('..')
    || (authority[2] && (Number(authority[2]) < 1 || Number(authority[2]) > 65535))) {
    throw new Error('服务域名或端口无效，请使用域名或 IPv4 地址');
  }
  return { mode: value.mode, apiUrl: `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3] || ''}`.replace(/\/+$/, '') };
}

function abortError() { const error = new Error('Request aborted'); error.name = 'AbortError'; return error; }

export function createMiniFetch(platform) {
  return (url, init = {}) => new Promise((resolve, reject) => {
    const signal = init.signal;
    if (signal?.aborted) { reject(abortError()); return; }
    let task;
    let finished = false;
    const finish = (callback, value) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => {
      finish(reject, abortError());
      task?.abort();
    };
    signal?.addEventListener('abort', abort);
    try {
      task = platform.request({
        url, method: init.method || 'GET', header: init.headers || {}, data: init.body,
        timeout: 95000, dataType: 'json',
        success(result) {
          finish(resolve, {
            status: result.statusCode,
            ok: result.statusCode >= 200 && result.statusCode < 300,
            async json() { return typeof result.data === 'string' ? JSON.parse(result.data) : result.data; }
          });
        },
        fail(result) {
          const message = result.errMsg || '网络请求失败';
          let error;
          if (signal?.aborted || /abort/i.test(message)) error = abortError();
          else if (/timeout/i.test(message)) error = new Error('微信请求超时，请重试或检查后端');
          else if (/domain|url not in/i.test(message)) error = new Error('服务域名未获微信允许，请检查小程序服务器域名配置');
          else error = new Error('无法连接旅行服务，请检查地址、网络和后端运行状态');
          finish(reject, error);
        }
      });
      // Taro returns a thenable RequestTask; callbacks above already own its result.
      task?.catch?.(() => {});
      // Handle synchronous mocks and cancellation during task creation.
      if (signal?.aborted) { task?.abort(); finish(reject, abortError()); }
    } catch (error) { finish(reject, error); }
  });
}

export function createMiniStorage(platform) {
  return {
    async getItem(key) {
      const value = platform.getStorageSync(key);
      return typeof value === 'string' && value ? value : null;
    },
    async setItem(key, value) { platform.setStorageSync(key, value); }
  };
}
