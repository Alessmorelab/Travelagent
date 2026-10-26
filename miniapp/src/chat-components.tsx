import { useEffect, useMemo, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, RichText, Text, Textarea, View } from '@tarojs/components';
import type { ChatSnapshot, Message, State } from './domain/travel.mjs';
import { AGENTS } from './domain/travel.mjs';
import type { RemoteConversation } from './services/chat-client.mjs';
import { AgentChoices, Sheet } from './components';
import { chatClient, goTab, sendQuery, store } from './stores/travel';
import { formatAssistantMessage } from './domain/message-format.mjs';

export function ChatComposer({ busy, blocked, value, onChange, onSend, onStop, onMore, onKeyboardHeight }: {
  busy: boolean; blocked: boolean; value: string; onChange: (value: string) => void;
  onSend: () => void; onStop: () => void; onMore: () => void; onKeyboardHeight: (height: number) => void;
}) {
  return <View className='dialogue-composer'>
    <View className='dialogue-input-row'>
      <Textarea className='dialogue-input' value={value} disabled={blocked} autoHeight maxlength={4000}
        placeholder={busy ? '可以先写下一个问题…' : '给远行发消息…'} ariaLabel='消息输入框'
        confirmType='send' showConfirmBar={false} holdKeyboard adjustPosition={false}
        onInput={(event) => onChange(event.detail.value)} onConfirm={() => { if (!busy) onSend(); }}
        onKeyboardHeightChange={(event) => onKeyboardHeight(event.detail.height)} />
    </View>
    <View className='dialogue-input-actions'>
      <Button className='composer-more' disabled={blocked} onClick={onMore} ariaLabel='更多旅行工具'>＋</Button>
      <Text className='composer-hint'>{busy ? '正在回复，可随时停止' : '行程、地点、路线，直接问我'}</Text>
      <Button className={`dialogue-send ${busy ? 'stop' : ''}`} disabled={blocked || (!busy && !value.trim())}
        onClick={busy ? onStop : onSend} ariaLabel={busy ? '停止生成' : '发送消息'}>{busy ? '■' : '↑'}</Button>
    </View>
  </View>;
}

export function ChatMessage({ message, state, latest }: { message: Message; state: State; latest: boolean }) {
  const formatted = useMemo(() => message.role === 'assistant' ? formatAssistantMessage(message.content) : '', [message.role, message.content]);
  const copy = () => { void Taro.setClipboardData({ data: message.content }).catch(() => store.toast('复制失败，请长按选择文字')); };
  if (message.role === 'user') return <View className='dialogue-message user'><Text className='user-message-text' selectable>{message.content}</Text></View>;
  const interrupted = message.status === 'interrupted';
  return <View className='dialogue-message assistant'>
    <View className='assistant-identity'><View className='assistant-mark'>✦</View><Text>远行</Text>
      {message.mode === 'demo' && <Text className='message-mode'>示例</Text>}
    </View>
    {latest && <TaskProgress state={state} />}
    {message.content ? <RichText className='assistant-answer' nodes={formatted} userSelect />
      : state.busy && latest ? <View className='reply-pending' ariaLabel='正在准备回复'><View /><View /><View /></View>
      : <Text className='reply-stopped'>回复已停止</Text>}
    {message.status === 'streaming' && !!message.content && <Text className='stream-cursor'>▍</Text>}
    {interrupted && !!message.content && <Text className='reply-stopped'>回复未完成</Text>}
    {message.status !== 'streaming' && <View className='message-actions'>
      {!!message.content && <Button className='message-action' onClick={copy} ariaLabel='复制回复'>复制</Button>}
      {latest && interrupted && !!state.lastQuery && <Button className='message-action' disabled={state.busy} onClick={() => sendQuery(state.lastQuery || '', true)}>重新回答</Button>}
    </View>}
  </View>;
}

export function TaskProgress({ state }: { state: State }) {
  const [expanded, setExpanded] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => { setExpanded(false); }, [state.lastRequestId]);
  useEffect(() => {
    if (!state.busy) return;
    setElapsed(0); const start = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [state.busy]);
  if (!state.progress.length) return null;
  const running = state.progress.filter((step) => step.state === 'running').at(-1);
  return <View className='reply-progress'>
    <Button className='progress-toggle' onClick={() => setExpanded(!expanded)} ariaLabel={expanded ? '收起查询进度' : '展开查询进度'}>
      {state.busy && <View className='thinking-dot' />}<Text>{state.busy ? running?.label || '正在整理回复' : '查看查询过程'}</Text>
      {state.busy && elapsed > 0 && <Text className='progress-time'>{elapsed}秒</Text>}<Text className='progress-chevron'>{expanded ? '⌃' : '⌄'}</Text>
    </Button>
    {expanded && <View className='progress-details'>{state.progress.map((step) => <View className={`task-step ${step.state}`} key={step.key}><Text>{step.state === 'complete' ? '✓' : step.state === 'interrupted' ? '·' : '◌'}</Text><Text>{step.label}</Text></View>)}</View>}
  </View>;
}

export function HistorySheet({ state, onClose }: { state: State; onClose: () => void }) {
  const [items, setItems] = useState<(ChatSnapshot | RemoteConversation)[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    if (state.connection.mode === 'demo') {
      setItems(store.getChatHistory().filter((item) => item.mode === 'demo')); setLoading(false);
    } else {
      chatClient.list(state.connection.apiUrl, state.agent).then((list) => { if (active) setItems(list); })
        .catch((err: Error) => { if (active) setError(err.message); })
        .finally(() => { if (active) setLoading(false); });
    }
    return () => { active = false; };
  }, [state.connection.mode, state.connection.apiUrl, state.agent, revision]);
  const open = async (item: ChatSnapshot | RemoteConversation) => {
    if (state.busy || loading) return;
    setLoading(true); setError('');
    try {
      if (state.connection.mode === 'demo') store.restoreConversation(item as ChatSnapshot);
      else {
        const detail = await chatClient.get(state.connection.apiUrl, item.id);
        store.restoreConversation({ ...detail, mode: 'live', thread_id: detail.id });
      }
      onClose(); goTab('assistant');
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };
  const remove = async (item: ChatSnapshot | RemoteConversation) => {
    if (loading || state.busy) return;
    const result = await Taro.showModal({ title: '删除这份对话？', content: item.title, confirmColor: '#cb7651', confirmText: '删除对话' });
    if (!result.confirm) return;
    setLoading(true); setError('');
    try {
      if (state.connection.mode === 'live') await chatClient.delete(state.connection.apiUrl, item.id);
      store.deleteLocalConversation(item.id);
      setRevision((value) => value + 1);
    } catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  };
  return <Sheet title='历史对话' onClose={onClose}><Text className='sheet-description'>{state.connection.mode === 'demo' ? '保存在当前设备的示例对话。' : '查看当前设备在此旅行服务中的历史对话。'}</Text><AgentChoices state={state} />{loading && <Text className='subtitle'>正在读取对话…</Text>}{error && <View className='error-card'><Text>{error}</Text><Button className='text-button' onClick={() => setRevision((value) => value + 1)}>重新读取</Button></View>}{!loading && !error && !items.length && <Text className='subtitle'>这个助手还没有历史对话，聊聊下一站吧。</Text>}{!error && items.map((item) => <View className='history-row' key={item.id}><View className='history-copy' onClick={() => void open(item)}><Text>{item.title}</Text><Text>{AGENTS.find((agent) => agent.id === item.agent)?.label} · {new Date(item.updated < 1e12 ? item.updated * 1000 : item.updated).toLocaleDateString()}</Text></View><Button className='text-button danger' disabled={loading || state.busy} onClick={() => void remove(item)}>删除</Button></View>)}</Sheet>;
}
