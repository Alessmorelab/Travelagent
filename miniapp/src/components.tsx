import { useEffect, useRef, useState } from 'react';
import type { PropsWithChildren } from 'react';
import Taro from '@tarojs/taro';
import { Button, Image, Input, Picker, ScrollView, Text, View } from '@tarojs/components';
import { DESTINATIONS, AGENTS } from './domain/travel.mjs';
import type { Destination, Preferences, State } from './domain/travel.mjs';
import { goTab, sendQuery, store } from './stores/travel';

const symbols: Record<string, string> = {
  compass: '⌖', sparkle: '✦', arrow: '→', send: '↑', bookmark: '♡', check: '✓',
  map: '▱', plus: '+', close: '×', pin: '⌖', plane: '✈', user: '旅',
  'train-outline': '↗', 'walk-outline': '⌖', 'restaurant-outline': '♧',
  'leaf-outline': '✳', 'camera-outline': '◈', 'moon-outline': '☾',
  'cafe-outline': '♧', 'bag-outline': '▱', 'airplane-outline': '✈', 'compass-outline': '⌖'
};
export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <Text className={`icon ${className}`}>{symbols[name] || '⌖'}</Text>;
}
export function PageHeading({ en, title, subtitle, action }: { en: string; title: string; subtitle: string; action?: () => void }) {
  return <View className='page-heading'><View><Text className='eyebrow'>{en}</Text><Text className='page-title'>{title}</Text><Text className='subtitle'>{subtitle}</Text></View>{action && <Button className='round-outline' onClick={action} ariaLabel='新建行程'>+</Button>}</View>;
}
export function ModePill({ state }: { state: State }) {
  return <View className={`mode-pill ${state.connection.mode}`}><View className='mode-dot' /><Text>{state.connection.mode === 'demo' ? '灵感预览' : '真实服务'}</Text></View>;
}
export function Toast({ state }: { state: State }) { return state.toast ? <View className='toast'>{state.toast}</View> : null; }
export function Empty({ icon, title, description, action, onClick }: { icon: string; title: string; description: string; action: string; onClick: () => void }) {
  return <View className='empty'><View className='empty-icon'><Icon name={icon} /></View><Text className='empty-title'>{title}</Text><Text className='empty-description'>{description}</Text><Button className='primary-button' onClick={onClick}>{action} →</Button></View>;
}
export function Filters({ state }: { state: State }) {
  return <ScrollView scrollX className='filters'>{['全部', '山野之间', '城市漫游', '海边放空'].map((filter) => <Text key={filter} className={`filter ${state.filter === filter ? 'active' : ''}`} onClick={() => store.setFilter(filter)}>{filter === '全部' ? '为你推荐' : filter}</Text>)}</ScrollView>;
}
export function AgentChoices({ state }: { state: State }) {
  return <ScrollView scrollX className='agent-options'>{AGENTS.map((agent) => <Button key={agent.id} disabled={state.busy} className={`agent-chip ${state.agent === agent.id ? 'active' : ''}`} onClick={() => store.setAgent(agent.id)}>{agent.id === 'team' ? '✦' : agent.id === 'flights' ? '✈' : agent.id === 'hotels' ? '▱' : '⌖'} {agent.label}</Button>)}</ScrollView>;
}
export function FavoriteButton({ destination, state }: { destination: Destination; state: State }) {
  const saved = state.favorites.includes(destination.id);
  return <Button className={`favorite-button ${saved ? 'saved' : ''}`} ariaLabel={`${saved ? '取消收藏' : '收藏'}${destination.name}`} onClick={(event) => { event.stopPropagation(); store.toggleFavorite(destination.id); }}><Text>{saved ? '♥' : '♡'}</Text></Button>;
}
export function Scenic({ destination, className = '', children }: PropsWithChildren<{ destination?: Destination; className?: string }>) {
  const [failed, setFailed] = useState(false);
  useEffect(() => { setFailed(false); }, [destination?.id]);
  return <View className={`scenic ${className}`} style={{ backgroundColor: destination?.color || '#85967c' }}>{destination && !failed && <Image className='scenic-image' src={destination.image} mode='aspectFill' onError={() => setFailed(true)} />}{failed && <View className='scenic-placeholder'><Text>⌖</Text><Text>{destination?.name}</Text></View>}<View className='scenic-shade' />{children}</View>;
}
export function DestinationCard({ destination, state, onClick }: { destination: Destination; state: State; onClick: () => void }) {
  return <View className='destination-card'><View onClick={onClick}><Scenic destination={destination} className='destination-image'><Text className='small-tag'>{destination.tag}</Text></Scenic><View className='destination-heading'><Text>{destination.name}</Text><Text className='country'>{destination.country}</Text></View><Text className='destination-subtitle'>{destination.subtitle}</Text></View><FavoriteButton destination={destination} state={state} /></View>;
}
export function Sheet({ title, onClose, children }: PropsWithChildren<{ title: string; onClose: () => void }>) {
  useEffect(() => {
    void Taro.hideTabBar({ animation: false }).catch(() => {});
    return () => { void Taro.showTabBar({ animation: false }).catch(() => {}); };
  }, []);
  return <View className='sheet-backdrop' onClick={onClose}><View className='sheet' onClick={(event) => event.stopPropagation()}><View className='sheet-handle' /><View className='sheet-header'><Text>{title}</Text><Button className='sheet-close' onClick={onClose} ariaLabel='关闭弹窗'>×</Button></View><ScrollView scrollY className='sheet-scroll' enhanced><View className='sheet-content'>{children}</View></ScrollView></View></View>;
}
export function DestinationSheet({ id, state, onClose }: { id: string; state: State; onClose: () => void }) {
  const d = DESTINATIONS.find((item) => item.id === id);
  if (!d) return null;
  const plan = () => {
    if (state.busy) { store.toast('请先等待当前回复，或停止等待'); return; }
    // Match the preference dates to the requested duration so that subsequent drafts agree.
    const start = state.preferences.startDate;
    const end = new Date(`${start}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + Number.parseInt(d.days, 10) - 1);
    store.savePreferences({ ...state.preferences, destination: d.name, budget: d.budget, endDate: end.toISOString().slice(0, 10) });
    store.setAgent('team'); onClose();
    sendQuery(`帮我规划一趟去${d.name}的旅行，想要${d.days}，节奏轻松一些。`);
  };
  return <Sheet title='值得出发的地方' onClose={onClose}><Scenic destination={d} className='detail-image' /><Text className='detail-location'>{d.country} / {d.category}</Text><Text className='detail-title'>{d.name}</Text><Text className='detail-description'>{d.description}</Text><View className='tag-row'>{[d.days, d.tag, '松弛慢游'].map((tag) => <Text className='tag' key={tag}>{tag}</Text>)}</View><View className='budget-strip'><Text>示例总预算</Text><Text className='budget-number'>¥ {d.budget.toLocaleString()}</Text></View><Text className='note'>内容与预算用于灵感参考，交通、门票与实际可用性仍需确认。</Text><View className='button-row'><Button className='secondary-button' onClick={() => store.toggleFavorite(d.id)}>{state.favorites.includes(d.id) ? '已收藏' : '收藏'}</Button><Button className='primary-button' disabled={state.busy} onClick={plan}>为我规划 →</Button></View></Sheet>;
}
export function PreferenceSheet({ kind, state, onClose }: { kind: 'preferences' | 'trip'; state: State; onClose: () => void }) {
  const [form, setForm] = useState({ ...state.preferences, travelers: String(state.preferences.travelers), budget: String(state.preferences.budget) });
  const [error, setError] = useState('');
  const field = (key: 'origin' | 'destination' | 'travelers' | 'budget', label: string) => <View className='form-field'><Text className='field-label'>{label}</Text><Input className='form-input' value={form[key]} type={key === 'budget' ? 'digit' : key === 'travelers' ? 'number' : 'text'} maxlength={key === 'budget' ? 12 : 60} onInput={(event) => setForm((old) => ({ ...old, [key]: event.detail.value }))} /></View>;
  const dateField = (key: 'startDate' | 'endDate', label: string) => <View className='form-field'><Text className='field-label'>{label}</Text><Picker mode='date' value={form[key]} onChange={(event) => setForm((old) => ({ ...old, [key]: event.detail.value }))}><View className='form-input date-value'>{form[key]}<Text>⌄</Text></View></Picker></View>;
  const save = () => {
    try {
      const value: Preferences = { ...form, travelers: Number(form.travelers), budget: Number(form.budget) };
      if (kind === 'trip') store.createTrip(value); else store.savePreferences(value);
      onClose(); if (kind === 'trip') goTab('trips');
    } catch (err) { setError((err as Error).message); }
  };
  return <Sheet title={kind === 'trip' ? '新建一段旅程' : '我的旅行偏好'} onClose={onClose}><Text className='sheet-description'>{kind === 'trip' ? '先定下方向，再与旅行搭子一起完善计划。' : '告诉我你的旅行习惯，让建议更贴近你。'}</Text><View className='form-row'>{field('origin', '从哪里出发')}{field('destination', '想去哪里')}</View><View className='form-row'>{dateField('startDate', '出发日期')}{dateField('endDate', '返程日期')}</View><View className='form-row'>{field('travelers', '同行人数')}{field('budget', '总预算 / 人民币')}</View><Text className='field-label'>喜欢的旅行节奏</Text><View className='style-options'>{['松弛慢游', '山野户外', '人文探索', '美食优先'].map((style) => <Button key={style} className={form.style === style ? 'active' : ''} onClick={() => setForm({ ...form, style })}>{style}</Button>)}</View>{error && <Text className='form-error'>{error}</Text>}<Button className='primary-button full-width' onClick={save}>{kind === 'trip' ? '创建行程草稿' : '保存旅行偏好'} ✓</Button></Sheet>;
}
export function ConnectionSheet({ state, onClose }: { state: State; onClose: () => void }) {
  const [form, setForm] = useState({ ...state.connection });
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [testing, setTesting] = useState(false);
  const latest = useRef(form.apiUrl); latest.current = form.apiUrl;
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);
  const test = async () => {
    const url = form.apiUrl; setTesting(true); setError(''); setFeedback('');
    try { const result = await store.testConnection(url); if (mounted.current && latest.current === url) setFeedback(result); }
    catch (err) { if (mounted.current && latest.current === url) setError((err as Error).message); }
    finally { if (mounted.current) setTesting(false); }
  };
  const save = () => { try { store.setConnection(form); onClose(); } catch (err) { setError((err as Error).message); } };
  return <Sheet title='连接你的旅行服务' onClose={onClose}><Text className='sheet-description'>先体验旅行灵感，或连接已有服务查询真实信息。</Text><View className='mode-options'>{(['demo', 'live'] as const).map((mode) => <View key={mode} className={`mode-option ${form.mode === mode ? 'active' : ''}`} onClick={() => setForm({ ...form, mode })}><Text>{mode === 'demo' ? '灵感预览' : '真实服务'}</Text><Text className='mode-description'>{mode === 'demo' ? '体验示例，无需后端' : '连接你的旅行后端'}</Text></View>)}</View><View className='form-field'><Text className='field-label'>后端服务地址</Text><Input className='form-input' value={form.apiUrl} placeholder='https://你的服务域名' maxlength={300} onInput={(event) => { setForm({ ...form, apiUrl: event.detail.value }); setFeedback(''); setError(''); }} /></View><Text className='sheet-description'>正式服务请填写 HTTPS 地址。这里只填服务地址，模型密钥保留在后端。</Text>{error && <Text className='form-error'>{error}</Text>}{feedback && <Text className='form-success'>{feedback}</Text>}<View className='button-row'><Button className='secondary-button' disabled={testing} loading={testing} onClick={() => void test()}>{testing ? '正在连接' : '测试连接'}</Button><Button className='primary-button' onClick={save}>保存设置 ✓</Button></View></Sheet>;
}
