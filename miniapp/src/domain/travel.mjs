export const STORAGE_KEY = 'roam.travel.v1';
export const AGENTS = [
  { id: 'team', label: '整趟行程', icon: 'sparkles-outline' },
  { id: 'flights', label: '查机票', icon: 'airplane-outline' },
  { id: 'hotels', label: '找酒店', icon: 'bed-outline' },
  { id: 'destinations', label: '探索目的地', icon: 'compass-outline' },
];
export const DESTINATIONS = [
  { id: 'kyoto', name: '京都', country: '日本', category: '城市漫游', tag: '秋日限定', days: '4天3晚', budget: 8000,
    image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=1000&q=85',
    color: '#6f7b5b', subtitle: '在古寺与小巷之间，收藏秋天。', description: '清晨走进安静的寺院，午后沿着小巷散步。留一点时间给偶遇的咖啡馆，也留一点空白给自己。' },
  { id: 'alps', name: '阿尔卑斯', country: '瑞士', category: '山野之间', tag: '山野来信', days: '6天5晚', budget: 18000,
    image: 'https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?auto=format&fit=crop&w=900&q=85',
    color: '#799388', subtitle: '把城市的声音，换成湖畔的风。', description: '在群山之间住下来，沿着湖岸走一段路。用缓慢的节奏，感受山野的辽阔与安静。' },
  { id: 'coast', name: '五渔村', country: '意大利', category: '海边放空', tag: '沿海漫游', days: '5天4晚', budget: 14000,
    image: 'https://images.unsplash.com/photo-1516483638261-f4dbaf036963?auto=format&fit=crop&w=900&q=85',
    color: '#ba8970', subtitle: '彩色小镇，和一整个夏天的海。', description: '搭一段沿海列车，在色彩明亮的小镇停下。走累了就坐在海边，等一场不必赶时间的日落。' },
  { id: 'tokyo', name: '东京', country: '日本', category: '城市漫游', tag: '城市切片', days: '5天4晚', budget: 10000,
    image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?auto=format&fit=crop&w=900&q=85',
    color: '#7b8390', subtitle: '从街角咖啡，到深夜的霓虹。', description: '在热闹与安静之间切换：探索街区、书店与美术馆，再找一家喜欢的小店，好好吃一顿饭。' },
];

const kyotoDays = [
  [{ time: '10:00', title: '抵达京都，慢慢进入假期', detail: '交通与入住时间待确认', icon: 'train-outline' }, { time: '14:00', title: '沿着鸭川散个步', detail: '给第一天留一点空白', icon: 'walk-outline' }, { time: '18:00', title: '在先斗町找一顿晚餐', detail: '餐厅营业及预约情况待查询', icon: 'restaurant-outline' }],
  [{ time: '09:00', title: '清水寺与东山小巷', detail: '门票、开放时间待查询', icon: 'leaf-outline' }, { time: '13:00', title: '二年坂、三年坂慢行', detail: '散步与午餐，按体力调整', icon: 'camera-outline' }, { time: '17:00', title: '祇园的傍晚', detail: '尊重街区拍摄与通行规定', icon: 'moon-outline' }],
  [{ time: '08:30', title: '去岚山，走进山野', detail: '交通班次待查询', icon: 'train-outline' }, { time: '11:00', title: '竹林与庭园', detail: '根据天气选择路线', icon: 'leaf-outline' }, { time: '15:00', title: '河畔喝一杯咖啡', detail: '不赶路的自由时光', icon: 'cafe-outline' }],
  [{ time: '09:30', title: '锦市场附近逛逛', detail: '店铺营业时间待确认', icon: 'bag-outline' }, { time: '12:00', title: '收拾行李，准备返程', detail: '按实际航班预留交通时间', icon: 'airplane-outline' }],
];

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
const clone = (value) => JSON.parse(JSON.stringify(value));

export function initialState(apiUrl = 'http://localhost:8000') {
  return {
    tab: 'assistant', agent: 'team', filter: '全部', activeDay: 0, busy: false, error: '', toast: '', hydrated: false,
    connection: { mode: 'demo', apiUrl },
    preferences: { origin: '武汉', destination: '京都', startDate: '2026-11-07', endDate: '2026-11-10', travelers: 2, budget: 8000, style: '松弛慢游' },
    preferencesConfirmed: false,
    favorites: ['kyoto', 'alps'], messages: [], threads: {}, progress: [], chatHistory: [], activeChats: {},
    trips: [{ id: 'kyoto-sample', destinationId: 'kyoto', title: '京都慢游 · 4天3晚', destination: '京都', startDate: '2026-11-07', endDate: '2026-11-10', travelers: 2, budget: 8000, sample: true, days: clone(kyotoDays), completed: [] }],
  };
}

export function validatePreferences(value) {
  const clean = { ...value, origin: String(value.origin || '').trim(), destination: String(value.destination || '').trim(), travelers: Number(value.travelers), budget: Number(value.budget) };
  if (!clean.origin || !clean.destination) throw new Error('请填写出发地和目的地');
  for (const key of ['startDate', 'endDate']) {
    const date = clean[key];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) throw new Error('请输入有效日期，例如 2026-11-07');
  }
  const days = (Date.parse(clean.endDate) - Date.parse(clean.startDate)) / 86400000;
  if (days < 0 || days > 29) throw new Error('返程日期应在出发后，行程最长 30 天');
  if (!Number.isInteger(clean.travelers) || clean.travelers < 1 || clean.travelers > 20) throw new Error('出行人数应为 1–20 人');
  if (!Number.isFinite(clean.budget) || clean.budget <= 0) throw new Error('请输入有效的总预算');
  return clean;
}

export function validateConnection(value) {
  if (!['demo', 'live'].includes(value.mode)) throw new Error('请选择有效的体验模式');
  let url;
  try { url = new URL(value.apiUrl.trim()); } catch { throw new Error('请输入完整的服务地址，如 http://192.168.1.8:8000'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('服务地址需要使用 HTTP 或 HTTPS，且不含密码、查询参数');
  return { mode: value.mode, apiUrl: url.toString().replace(/\/$/, '') };
}

export function formatDate(date) { return date.slice(5).replace('-', '.'); }
export function dayCount(trip) { return Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86400000) + 1; }
export function preferenceSummary(p) { return `${p.origin}出发，前往${p.destination}；${p.startDate}至${p.endDate}；${p.travelers}人；总预算人民币${p.budget}元；偏好：${p.style}。`; }

function demoResponse(text, agent, p) {
  const place = DESTINATIONS.find((item) => text.includes(item.name))?.name || p.destination;
  const intro = `【灵感预览 · 示例回复】\n\n`;
  if (agent === 'flights') return `${intro}可以先围绕「${p.origin} → ${place}」比较航线。\n\n• 出行日期：${p.startDate} 至 ${p.endDate}\n• 出行人数：${p.travelers} 人\n• 比较维度：总价、转机时长、行李额度、退改规则\n\n当前没有查询真实航班和价格。切换到真实服务后，可由航班助手继续查询。`;
  if (agent === 'hotels') return `${intro}在${place}，可以先按这三个方向挑选住宿：\n\n1. 交通方便：靠近主要车站，方便抵达和离开。\n2. 街区体验：住在适合步行探索的区域。\n3. 安静舒适：避开最拥挤的街道，给休息多一点空间。\n\n当前没有查询房态或报价。你可以补充每晚预算与房型，连接真实服务后再筛选。`;
  if (agent === 'destinations') return `${intro}想在${place}放慢脚步，可以从三件事开始：\n\n• 选一个适合步行探索的街区。\n• 每天只安排一到两个主要地点。\n• 留一段自由时间给咖啡、散步或看日落。\n\n这是旅行灵感示例，景点开放时间、门票和当地情况需要进一步核实。`;
  return `${intro}收到你的想法：「${text}」\n\n先为${place}留一份松弛的旅行框架：\n\nDAY 01  抵达与安顿，熟悉周边。\nDAY 02  探索最想去的街区或景点。\nDAY 03  走向自然，留出自由时间。\n最后一天  按返程时间安排轻松活动。\n\n参考偏好：${p.travelers}人同行，总预算 ¥${p.budget.toLocaleString()}。\n\n这段内容用于体验对话流程，没有调用大模型或查询实时数据。你可以在「行程」创建草稿，或在「我的」连接真实服务。`;
}

function responseText(value) {
  if (typeof value === 'string' && value.trim()) return value;
  if (Array.isArray(value)) {
    const text = value.map((part) => typeof part === 'string' ? part : part?.text || '').join('\n');
    if (text.trim()) return text;
  }
  throw new Error('服务返回了空回复，请重试');
}

export function createTravelStore(storage, options = {}) {
  let state = initialState(options.apiUrl);
  const listeners = new Set();
  let pending = null;
  let toastTimer;
  let writeQueue = Promise.resolve();
  const fetcher = options.fetch || globalThis.fetch;
  const checkConnection = options.validateConnection || validateConnection;
  const createController = options.createAbortController || (() => new AbortController());
  const emit = () => listeners.forEach((listener) => listener(state));
  const persist = () => {
    const { connection, preferences, preferencesConfirmed, favorites, messages, threads, trips, chatHistory, activeChats } = state;
    const serialized = JSON.stringify({ version: 1, connection, preferences, preferencesConfirmed, favorites, messages: messages.slice(-80), threads, trips, chatHistory: chatHistory.slice(-10), activeChats });
    writeQueue = writeQueue.then(() => storage.setItem(STORAGE_KEY, serialized)).catch(() => {
      state = { ...state, toast: '本次修改尚未保存，请检查本地存储空间' }; emit();
    });
  };
  const update = (patch, save = false) => { state = { ...state, ...patch }; emit(); if (save && state.hydrated) persist(); };
  const toast = (message) => { clearTimeout(toastTimer); update({ toast: message }); toastTimer = setTimeout(() => update({ toast: '' }), 3000); toastTimer.unref?.(); };
  const stop = () => { pending?.controller.abort(); pending = null; };
  const validProgress = (steps, interrupted = false) => Array.isArray(steps) ? steps.filter((step) => step && typeof step.key === 'string' && typeof step.label === 'string' && ['running', 'complete', 'interrupted'].includes(step.state)).slice(-24).map((step) => ({ key: step.key.slice(0, 128), label: step.label.slice(0, 120), kind: step.kind === 'tool' ? 'tool' : 'task', state: interrupted && step.state === 'running' ? 'interrupted' : step.state })) : [];
  const validMessages = (messages) => Array.isArray(messages) ? messages.filter((message) => message && typeof message.id === 'string' && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' && ['demo', 'live'].includes(message.mode) && AGENTS.some((agent) => agent.id === message.agent)).map((message) => ({ ...message, status: message.status === 'streaming' ? 'interrupted' : message.status, progress: validProgress(message.progress, true) })) : [];
  const currentChat = (agent = state.agent) => {
    const messages = state.messages.filter((message) => message.agent === agent);
    if (!messages.length) return null;
    return { id: state.activeChats[agent] || `active-${agent}`, agent, mode: messages.at(-1).mode, apiUrl: state.connection.apiUrl,
      title: messages.find((message) => message.role === 'user')?.content.slice(0, 40) || '旅行对话',
      messages: messages.slice(-40), thread_id: state.threads[agent], updated: Date.now() };
  };
  const archive = () => {
    const current = currentChat();
    if (!current || current.mode === 'live') return state.chatHistory;
    return [...state.chatHistory.filter((item) => item.id !== current.id), current].slice(-10);
  };

  return {
    getState: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async hydrate() {
      try {
        const raw = await storage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw);
          if (saved.version !== 1) throw new Error('Unsupported data');
          const preferences = validatePreferences(saved.preferences);
          // Older versions saved the sample Kyoto preferences automatically.
          const defaults = initialState().preferences;
          const preferencesConfirmed = typeof saved.preferencesConfirmed === 'boolean' ? saved.preferencesConfirmed
            : Object.keys(defaults).some((key) => preferences[key] !== defaults[key]);
          const connection = checkConnection(saved.connection);
          if (!Array.isArray(saved.favorites) || !Array.isArray(saved.trips) || !Array.isArray(saved.messages)) throw new Error('Invalid data');
          const trips = saved.trips.filter((trip) => {
            try {
              if (!trip || typeof trip !== 'object') return false;
              if (!['destination', 'startDate', 'endDate'].every((key) => typeof trip[key] === 'string')
                || typeof trip.travelers !== 'number' || typeof trip.budget !== 'number') return false;
              validatePreferences({ ...preferences, ...trip });
              return typeof trip.id === 'string' && typeof trip.title === 'string' && typeof trip.sample === 'boolean'
                && Array.isArray(trip.days) && trip.days.length === dayCount(trip)
                && trip.days.every((day) => Array.isArray(day) && day.every((item) => item
                  && ['title', 'time', 'detail', 'icon'].every((key) => typeof item[key] === 'string')))
                && Array.isArray(trip.completed) && trip.completed.every((key) => typeof key === 'string');
            } catch { return false; }
          });
          const messages = validMessages(saved.messages);
          const chatHistory = Array.isArray(saved.chatHistory) ? saved.chatHistory.filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string' && item.mode === 'demo' && AGENTS.some((agent) => agent.id === item.agent)).map((item) => ({ ...item, messages: validMessages(item.messages).slice(-40) })).slice(-10) : [];
          update({ chatHistory, activeChats: saved.activeChats && typeof saved.activeChats === 'object' ? Object.fromEntries(Object.entries(saved.activeChats).filter(([key, value]) => AGENTS.some((agent) => agent.id === key) && typeof value === 'string')) : {} });
          update({ preferences, preferencesConfirmed, connection, favorites: saved.favorites.filter((id) => DESTINATIONS.some((d) => d.id === id)), trips, messages, threads: saved.threads && typeof saved.threads === 'object' ? Object.fromEntries(Object.entries(saved.threads).filter(([key, value]) => AGENTS.some((a) => a.id === key) && typeof value === 'string')) : {} });
        }
      } catch { toast('已载入初始体验，本地记录暂时无法读取'); }
      update({ hydrated: true });
    },
    setTab(tab) { if (['assistant', 'trips', 'favorites', 'profile'].includes(tab)) update({ tab }); },
    setAgent(agent) { if (!state.busy && AGENTS.some((a) => a.id === agent)) update({ agent, error: '', progress: [] }); },
    setFilter(filter) { update({ filter }); },
    setActiveDay(activeDay) { update({ activeDay }); },
    toggleFavorite(id) {
      if (!DESTINATIONS.some((d) => d.id === id)) return;
      const has = state.favorites.includes(id);
      update({ favorites: has ? state.favorites.filter((item) => item !== id) : [...state.favorites, id] }, true);
      toast(has ? '已移出收藏' : '已收藏，留给下一次出发');
    },
    savePreferences(value) { update({ preferences: validatePreferences(value), preferencesConfirmed: true }, true); toast('旅行偏好已保存'); },
    setConnection(value) {
      const connection = checkConnection(value);
      stop();
      if (options.stream && (connection.apiUrl !== state.connection.apiUrl || connection.mode !== state.connection.mode)) {
        const snapshots = AGENTS.map((agent) => currentChat(agent.id)).filter((item) => item?.mode === 'demo');
        update({ chatHistory: [...state.chatHistory.filter((item) => !snapshots.some((snapshot) => snapshot.id === item.id)), ...snapshots].slice(-10), messages: [], activeChats: {} });
      }
      update({ connection, threads: {}, busy: false, error: '', progress: [] }, true);
      toast(connection.mode === 'demo' ? '已切换到灵感预览' : '已切换到真实服务');
    },
    async testConnection(apiUrl) {
      const connection = checkConnection({ mode: 'live', apiUrl });
      const controller = createController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetcher(`${connection.apiUrl}/`, { signal: controller.signal });
        if (!response.ok) throw new Error(`连接失败（HTTP ${response.status}）`);
        const result = await response.json();
        if (typeof result.message !== 'string') throw new Error('地址可访问，但不是预期的旅行服务');
        return '连接成功，可以保存并开始对话';
      } catch (error) { throw new Error(error.name === 'AbortError' ? '连接超时，请检查服务地址' : error.message === 'Failed to fetch' ? '连接失败，请检查网络、服务地址与跨域设置' : error.message); }
      finally { clearTimeout(timeout); }
    },
    async sendMessage(text, retry = false) {
      const query = String(text).trim();
      if (!query || state.busy) return;
      if (query.length > 4000) { toast('消息最长 4000 字'); return; }
      const agent = state.agent;
      const preferences = clone(state.preferences);
      const preferenceContext = state.preferencesConfirmed ? preferenceSummary(preferences) : '';
      const connection = { ...state.connection };
      const request = { controller: createController(), id: retry && state.lastRequestId ? state.lastRequestId : uid() };
      pending = request;
      const messages = retry ? state.messages.filter((message) => message.id !== request.id) : [...state.messages, { id: uid(), role: 'user', content: query, agent, mode: connection.mode }];
      const streaming = (connection.mode === 'live' && options.stream) || (connection.mode === 'demo' && options.demoStreaming);
      if (streaming) messages.push({ id: request.id, role: 'assistant', content: '', agent, mode: connection.mode, status: 'streaming', progress: [] });
      update({ tab: 'assistant', messages, busy: true, error: '', progress: [], lastQuery: query, lastRequestId: request.id,
        activeChats: { ...state.activeChats, [agent]: state.activeChats[agent] || uid() } }, true);
      const onEvent = (event) => {
        if (pending !== request || request.controller.signal.aborted) return;
        if (event.type === 'accepted' && typeof event.conversation_id === 'string') {
          update({ threads: { ...state.threads, [agent]: event.conversation_id }, activeChats: { ...state.activeChats, [agent]: event.conversation_id } }, true);
        } else if (event.type === 'status') {
          const step = validProgress([event])[0];
          if (!step) return;
          const steps = [...state.progress];
          const index = steps.findIndex((item) => item.key === step.key);
          if (index < 0) steps.push(step); else steps[index] = step;
          const progress = steps.slice(-24);
          update({ progress, messages: state.messages.map((message) => message.id === request.id ? { ...message, progress } : message) }, true);
        } else if (['delta', 'final'].includes(event.type) && typeof event.content === 'string') {
          update({ messages: state.messages.map((message) => message.id === request.id ? { ...message, content: event.type === 'delta' ? message.content + event.content : event.content } : message) });
        }
      };
      let timeout;
      try {
        let content;
        let threadId;
        if (connection.mode === 'demo') {
          await new Promise((resolve) => setTimeout(resolve, options.demoDelay ?? 600));
          content = demoResponse(query, agent, preferences);
          if (streaming) {
            onEvent({ type: 'status', key: 'demo', label: '示例：整理旅行想法', state: 'running' });
            const characters = [...content];
            for (let index = 0; index < characters.length; index += 32) {
              if (pending !== request || request.controller.signal.aborted) return;
              onEvent({ type: 'delta', content: characters.slice(index, index + 32).join('') });
              await new Promise((resolve) => setTimeout(resolve, options.demoDelay === 0 ? 0 : 18));
            }
            onEvent({ type: 'status', key: 'demo', label: '示例回复已整理', state: 'complete' });
          }
        } else {
          // The backend may work for 120 seconds; allow its final/error frame to
          // arrive instead of cancelling a valid reply before that deadline.
          timeout = setTimeout(() => request.controller.abort(), options.timeout ?? 130000);
          if (!options.stream) throw new Error('聊天连接尚未配置，请检查小程序版本');
          const data = await options.stream({ apiUrl: connection.apiUrl, agent, query, preferences: preferenceContext,
            threadId: state.threads[agent], requestId: request.id, signal: request.controller.signal }, onEvent);
          content = responseText(data.response); threadId = data.thread_id;
        }
        if (pending !== request || request.controller.signal.aborted) return;
        update({ messages: streaming ? state.messages.map((message) => message.id === request.id ? { ...message, content, status: 'complete', progress: validProgress(state.progress.map((step) => step.state === 'running' ? { ...step, state: 'complete' } : step)) } : message) : [...state.messages, { id: uid(), role: 'assistant', content, agent, mode: connection.mode }], threads: typeof threadId === 'string' && threadId ? { ...state.threads, [agent]: threadId } : state.threads }, true);
      } catch (error) {
        if (pending === request) update({ progress: state.progress.map((step) => step.state === 'running' ? { ...step, state: 'interrupted' } : step), messages: state.messages.filter((message) => message.id !== request.id || message.content || message.progress?.length).map((message) => message.id === request.id ? { ...message, status: 'interrupted', progress: validProgress(message.progress, true) } : message), error: error.name === 'AbortError' ? '等待回复超时，可以重试或检查后端服务' : error.message === 'Failed to fetch' ? '暂时无法连接服务，请在「我的」检查服务地址' : error.message }, true);
      } finally {
        clearTimeout(timeout);
        if (pending === request) { pending = null; update({ busy: false }); }
      }
    },
    cancelMessage() { stop(); update({ busy: false, error: '', messages: state.messages.map((message) => message.status === 'streaming' ? { ...message, status: 'interrupted', progress: validProgress(message.progress, true) } : message), progress: state.progress.map((step) => step.state === 'running' ? { ...step, state: 'interrupted' } : step) }, true); toast('已停止回复'); },
    newConversation(agent = state.agent) {
      if (state.busy) { toast('请先停止等待，再开启新对话'); return; }
      if (!AGENTS.some((item) => item.id === agent)) return;
      const threads = { ...state.threads }; delete threads[agent];
      const activeChats = { ...state.activeChats }; delete activeChats[agent];
      const target = currentChat(agent);
      const history = archive();
      const chatHistory = target?.mode === 'demo' ? [...history.filter((item) => item.id !== target.id), target].slice(-10) : history;
      update({ agent, chatHistory, messages: state.messages.filter((message) => message.agent !== agent), threads, activeChats, error: '', progress: [], lastQuery: '', lastRequestId: '' }, true);
      toast('已开启新对话，历史记录仍可查看');
    },
    getChatHistory() {
      const current = currentChat();
      return [...state.chatHistory.filter((item) => item.agent === state.agent && item.id !== current?.id), ...(current ? [current] : [])].sort((a, b) => b.updated - a.updated);
    },
    restoreConversation(value) {
      if (state.busy) { toast('请先停止等待，再切换对话'); return; }
      if (!AGENTS.some((agent) => agent.id === value.agent)) return;
      const messages = validMessages(value.messages).filter((message) => message.agent === value.agent);
      update({ chatHistory: archive(), agent: value.agent, messages: [...state.messages.filter((message) => message.agent !== value.agent), ...messages],
        threads: { ...state.threads, [value.agent]: value.thread_id }, activeChats: { ...state.activeChats, [value.agent]: value.id },
        progress: [], error: '', lastQuery: '', lastRequestId: '' }, true);
    },
    deleteLocalConversation(id) {
      const current = state.activeChats[state.agent] === id;
      if (current) { const threads = { ...state.threads }; delete threads[state.agent]; const activeChats = { ...state.activeChats }; delete activeChats[state.agent]; update({ messages: state.messages.filter((message) => message.agent !== state.agent), threads, activeChats }); }
      update({ chatHistory: state.chatHistory.filter((item) => item.id !== id), error: '', progress: [] }, true);
    },
    clearChat() { stop(); update({ messages: [], threads: {}, busy: false, error: '', lastQuery: '' }, true); toast('已开启新的对话'); },
    createTrip(value) {
      const p = validatePreferences(value);
      const count = dayCount(p);
      const match = DESTINATIONS.find((d) => d.name === p.destination);
      const days = Array.from({ length: count }, (_, index) => [{ time: index === 0 ? '10:00' : '09:00', title: index === 0 ? `抵达${p.destination}，安顿行李` : index === count - 1 ? '轻松收尾，准备返程' : `探索${p.destination} · 自由安排`, detail: '行程草稿，交通与活动待确认', icon: index === 0 || index === count - 1 ? 'airplane-outline' : 'compass-outline' }]);
      const trip = { id: uid(), destinationId: match?.id || null, title: `${p.destination} · ${count}天${Math.max(0, count - 1)}晚`, destination: p.destination, startDate: p.startDate, endDate: p.endDate, travelers: p.travelers, budget: p.budget, sample: false, days, completed: [] };
      update({ trips: [trip, ...state.trips], preferences: p, preferencesConfirmed: true, tab: 'trips', activeDay: 0 }, true); toast('行程草稿已创建');
    },
    toggleActivity(tripId, key) {
      update({ trips: state.trips.map((trip) => trip.id === tripId ? { ...trip, completed: trip.completed.includes(key) ? trip.completed.filter((item) => item !== key) : [...trip.completed, key] } : trip) }, true);
    },
    removeTrip(id) { update({ trips: state.trips.filter((trip) => trip.id !== id), activeDay: 0 }, true); toast('行程已删除'); },
    flush: () => writeQueue,
    dispose() { stop(); clearTimeout(toastTimer); listeners.clear(); },
    toast,
  };
}
