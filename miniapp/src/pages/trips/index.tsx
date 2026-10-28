import { useEffect, useRef, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { Button, Input, Map, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { DESTINATIONS, dayCount, formatDate } from '../../domain/travel.mjs';
import type { Activity, State, Trip } from '../../domain/travel.mjs';
import { Empty, Icon, PageHeading, PreferenceSheet, Scenic, Sheet, Toast } from '../../components';
import { chatClient, sendQuery, store, useTravelState } from '../../stores/travel';

function PlaceMapView({ state, initialCity, onClose }: { state: State; initialCity: string; onClose: () => void }) {
  const [city, setCity] = useState(initialCity);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<Awaited<ReturnType<typeof chatClient.searchPlaces>> | null>(null);
  const active = useRef(true);
  useEffect(() => () => { active.current = false; }, []);
  const search = async () => {
    const cityValue = city.trim(), queryValue = query.trim();
    if (!cityValue || !queryValue) { setError('请填写城市和地点关键词'); return; }
    if (state.connection.mode !== 'live') { setError('请先在「我的 → 旅行服务」连接真实服务'); return; }
    setLoading(true); setError(''); setResult(null);
    try { const data = await chatClient.searchPlaces(state.connection.apiUrl, cityValue, queryValue); if (active.current) setResult(data); }
    catch (e) { if (active.current) setError((e as Error).message || '地点查询失败'); }
    finally { if (active.current) setLoading(false); }
  };
  const places = result?.places || [];
  const markers = places.map((place, index) => ({ id: index + 1, latitude: place.latitude, longitude: place.longitude,
    title: place.name, iconPath: '/assets/tabs/map-active.png', width: 28, height: 28 }));
  return <View className='page place-map-page'>
    <View className='place-map-heading'><Button className='text-button' onClick={onClose}>← 返回行程</Button><Text>地点地图</Text></View>
    <Text className='sheet-description'>查询实际地点后在地图上标记，地点和坐标由百度地图提供。</Text>
    <View className='form-row'><View className='form-field'><Text className='field-label'>城市</Text><Input className='form-input' value={city} maxlength={50} placeholder='例如武汉' onInput={(event) => setCity(event.detail.value)} /></View>
      <View className='form-field'><Text className='field-label'>地点关键词</Text><Input className='form-input' value={query} maxlength={45} placeholder='例如黄鹤楼' onInput={(event) => setQuery(event.detail.value)} /></View></View>
    <Button className='primary-button' loading={loading} disabled={loading} onClick={() => void search()}>{loading ? '正在查询' : '查询地点'}</Button>
    {error && <Text className='form-error'>{error}</Text>}
    {result && !places.length && <Text className='note'>未查到符合条件的地点，请调整关键词。</Text>}
    {!!places.length && <><Map className='place-map' latitude={places[0].latitude} longitude={places[0].longitude} markers={markers}
      includePoints={places.map((place) => ({ latitude: place.latitude, longitude: place.longitude }))} scale={12} onError={() => setError('地图加载失败，请检查微信开发者工具或网络')} />
      <Text className='note'>来源：{result?.source} · 查询时间：{result?.retrieved_at}</Text>
      {places.map((place, index) => <View className='place-map-result' key={`${index}-${place.name}`}><Text>{place.name}</Text><Text>{place.address || '地址未提供'}</Text></View>)}
    </>}
  </View>;
}

function ActivitySheet({ trip, day, index, onClose }: { trip: Trip; day: number; index: number; onClose: () => void }) {
  const existing = index >= 0 ? trip.days[day]?.[index] : undefined;
  const [value, setValue] = useState<Pick<Activity, 'title' | 'time' | 'detail'>>({
    title: existing?.title || '', time: existing?.time === '时间待定' ? '' : existing?.time || '', detail: existing?.detail || ''
  });
  const [error, setError] = useState('');
  const save = () => { try { store.editActivity(trip.id, day, index, value); onClose(); } catch (e) { setError((e as Error).message); } };
  const remove = async () => {
    const result = await Taro.showModal({ title: '删除这项安排？', content: existing?.title || '', confirmText: '删除', confirmColor: '#cb7651' });
    if (result.confirm) { store.removeActivity(trip.id, day, index); onClose(); }
  };
  return <Sheet title={existing ? '编辑行程安排' : '添加行程安排'} onClose={onClose}>
    <Text className='sheet-description'>第 {day + 1} 天 · 日期、地点与交通信息请按实际情况核对。</Text>
    <View className='form-field'><Text className='field-label'>地点或安排</Text><Input className='form-input' value={value.title} maxlength={100} placeholder='例如：黄鹤楼' onInput={(e) => setValue({ ...value, title: e.detail.value })} /></View>
    <View className='form-field'><Text className='field-label'>时间</Text><Input className='form-input' value={value.time} maxlength={40} placeholder='例如：上午或 09:00' onInput={(e) => setValue({ ...value, time: e.detail.value })} /></View>
    <View className='form-field'><Text className='field-label'>备注</Text><Textarea className='form-input trip-note-input' value={value.detail} maxlength={5000} placeholder='添加玩法、交通或提醒' onInput={(e) => setValue({ ...value, detail: e.detail.value })} /></View>
    {error && <Text className='form-error'>{error}</Text>}
    <View className='button-row'>{existing && <Button className='secondary-button' onClick={() => void remove()}>删除这项</Button>}<Button className='primary-button' onClick={save}>保存安排</Button></View>
  </Sheet>;
}

export default function TripsPage() {
  const state = useTravelState('trips');
  const [selectedId, setSelectedId] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  useDidShow(() => { const id = store.getState().focusTripId; if (id) { setSelectedId(id); store.clearTripFocus(); } });
  const trip = state.trips.find((item) => item.id === selectedId) || state.trips[0];
  const destination = DESTINATIONS.find((item) => item.id === trip?.destinationId);
  const day = Math.max(0, Math.min(state.activeDay, (trip?.days.length || 1) - 1));
  const create = () => { setSelectedId(''); setFormOpen(true); };
  const remove = async () => {
    if (!trip) return;
    const result = await Taro.showModal({ title: '删除这段行程？', content: `${trip.title}及完成进度将从此设备删除。`, confirmText: '删除行程', confirmColor: '#cb7651' });
    if (result.confirm) { store.removeTrip(trip.id); setSelectedId(''); }
  };
  const plan = () => {
    if (!trip) return;
    if (state.busy) { store.toast('请先等待当前回复，或停止等待'); return; }
    const details = [trip.startDate ? `出发日期${trip.startDate}，返程日期${trip.endDate}` : '', trip.travelers ? `${trip.travelers}人` : '', trip.budget ? `总预算${trip.budget}元` : ''].filter(Boolean).join('，');
    store.setAgent('team');
    sendQuery(`帮我完善${trip.destination}的${dayCount(trip)}天旅行计划。${details ? details + '。' : ''}请先确认交通与住宿需求。`);
  };
  if (mapOpen) return <PlaceMapView state={state} initialCity={trip?.destination || ''} onClose={() => setMapOpen(false)} />;
  return <View className='page'><PageHeading en='MY JOURNEYS' title='我的行程' subtitle='把期待，变成出发。' action={create} /><Button className='text-button' onClick={() => setMapOpen(true)}>⌖ 地点地图</Button>
    {!trip ? <Empty icon='map' title='下一站，还在等你' description='创建一份行程草稿，慢慢填满旅途的每一天。' action='新建行程' onClick={create} /> : <>
      {state.trips.length > 1 && <ScrollView scrollX className='trip-select'>{state.trips.map((item) => <Button key={item.id} className={item.id === trip.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); store.setActiveDay(0); }}>{item.title}</Button>)}</ScrollView>}
      <Scenic destination={destination} className='trip-cover'><View className='trip-cover-copy'><Text className='trip-status'>{trip.sample ? '示例行程 · 待核对' : '行程草稿 · 待完善'}</Text><Text className='trip-title'>{trip.title}</Text><Text>{trip.startDate ? `${formatDate(trip.startDate)} — ${formatDate(trip.endDate)}` : '日期待填写'} · {trip.travelers ? `${trip.travelers}人同行` : '人数待填写'}</Text></View></Scenic>
      <View className='budget-strip'><View><Text className='muted'>{trip.sample ? '示例总预算' : '计划总预算'}</Text><Text className='budget-number'>{trip.budget ? `¥ ${trip.budget.toLocaleString()}` : '待填写'}</Text></View><View className='budget-right'><Text>{dayCount(trip)}天 {Math.max(0, dayCount(trip) - 1)}晚</Text><Text className='muted'>实际费用以预订时为准</Text></View></View>
      <ScrollView scrollX className='day-tabs'>{trip.days.map((_, index) => { let label = '日期待定'; if (trip.startDate) { const date = new Date(`${trip.startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); label = formatDate(date.toISOString().slice(0, 10)); } return <View key={index} className={`day-tab ${day === index ? 'active' : ''}`} onClick={() => store.setActiveDay(index)}><Text>DAY {String(index + 1).padStart(2, '0')}</Text><Text>{label}</Text></View>; })}</ScrollView>
      <View className='timeline'>{trip.days[day].map((activity, index) => { const key = `${day}-${index}`; const done = trip.completed.includes(key); return <View key={key} className={`timeline-item ${done ? 'done' : ''}`}><View className='timeline-icon'><Icon name={activity.icon} /></View><View className='timeline-copy' onClick={() => setEditIndex(index)}><Text className='timeline-time'>{activity.time}</Text><Text className='timeline-title'>{activity.title}</Text><Text className='timeline-description'>{activity.detail}</Text><Text className='activity-edit-hint'>点击编辑</Text></View><Button className={`activity-check ${done ? 'checked' : ''}`} ariaLabel={`${done ? '标记未完成' : '标记完成'}：${activity.title}`} onClick={() => store.toggleActivity(trip.id, key)}>{done ? '✓' : ''}</Button></View>; })}</View>
      <Button className='text-button' onClick={() => setEditIndex(-1)}>＋ 添加当天安排</Button>
      {trip.notes && <View className='import-day'><Text>行程附注</Text><Text selectable>{trip.notes}</Text></View>}
      <Text className='note'>{trip.sample ? '这是体验用的示例行程，未查询真实票价、开放时间或可用性。' : '这是行程草稿，具体活动与交通仍需确认。'} 点击安排可编辑，点击右侧圆圈记录进度。</Text>
      <View className='trip-progress'><Text>已完成 {trip.completed.length} / {trip.days.reduce((total, activities) => total + activities.length, 0)} 项安排</Text><View className='progress-track'><View className='progress-fill' style={{ width: `${Math.min(100, trip.completed.length / Math.max(1, trip.days.flat().length) * 100)}%` }} /></View></View>
      <View className='trip-actions'><Button className='text-button' onClick={plan}>让旅行搭子完善 →</Button>{trip.sourceText && <Button className='text-button' onClick={() => setShowSource(true)}>查看原始回复</Button>}<Button className='text-button danger' onClick={() => void remove()}>删除行程</Button></View>
    </>}
    {trip && editIndex !== null && <ActivitySheet key={`${trip.id}-${day}-${editIndex}`} trip={trip} day={day} index={editIndex} onClose={() => setEditIndex(null)} />}
    {trip?.sourceText && showSource && <Sheet title='原始回复' onClose={() => setShowSource(false)}><Text className='trip-source-text' selectable>{trip.sourceText}</Text></Sheet>}
    {formOpen && <PreferenceSheet kind='trip' state={state} onClose={() => setFormOpen(false)} />}<Toast state={state} />
  </View>;
}
