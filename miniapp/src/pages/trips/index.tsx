import { useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { Button, Input, Picker, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { dayCount, formatDate } from '../../domain/travel.mjs';
import type { Activity, Trip } from '../../domain/travel.mjs';
import { Empty, Icon, PageHeading, PreferenceSheet, Sheet, Toast } from '../../components';
import { QuerySources } from '../../chat-components';
import { readSources } from '../../domain/query-sources.mjs';
import { TripDetailsSheet } from '../../trip-details-sheet';
import { DayAdjustmentSheet } from '../../day-adjustment-sheet';
import { PlaceSearch } from '../../place-search';
import { formatTripText, tripEndDate } from '../../domain/trip-details.mjs';
import { ItineraryMap } from '../../itinerary-map';
import { itineraryForMessage } from '../../domain/map-data.mjs';
import { isProtectedActivity, MAX_DAY_ACTIVITIES } from '../../domain/day-adjustment.mjs';
import { store, useTravelState } from '../../stores/travel';


function ActivitySheet({ trip, day, index, onClose }: { trip: Trip; day: number; index: number; onClose: () => void }) {
  const existing = index >= 0 ? trip.days[day]?.[index] : undefined;
  const [value, setValue] = useState<Pick<Activity, 'title' | 'time' | 'detail'>>({
    title: existing?.title || '', time: existing?.time === '时间待定' ? '' : existing?.time || '', detail: existing?.detail || ''
  });
  const [error, setError] = useState('');
  const [targetDay, setTargetDay] = useState(day);
  const dates = trip.days.map((_, position) => `第 ${position + 1} 天 · ${tripEndDate(trip.startDate, position + 1) || '日期待定'}`);
  const changed = targetDay !== day || value.title !== existing?.title || value.detail !== existing?.detail
    || (value.time || '时间待定') !== (existing?.time || '时间待定');
  const save = () => { try { store.editActivity(trip.id, day, index, value, targetDay); onClose(); } catch (e) { setError((e as Error).message); } };
  const remove = async () => {
    const result = await Taro.showModal({ title: '删除这项安排？', content: existing?.title || '', confirmText: '删除', confirmColor: '#cb7651' });
    if (result.confirm) { store.removeActivity(trip.id, day, index); onClose(); }
  };
  return <Sheet title={existing ? '编辑行程安排' : '添加行程安排'} folio={`DAY ${String(day + 1).padStart(2, '0')}  /  FIELD NOTES`} onClose={onClose} footer={<>
    {error && <Text className='form-error'>{error}</Text>}
    <Button className='primary-button' onClick={save}>{targetDay === day ? '保存安排' : `保存到第 ${targetDay + 1} 天`}</Button>
  </>}>
    <View className='form-chapter'><Text>{String((existing ? index : trip.days[day].length) + 1).padStart(2, '0')}</Text><Text>{trip.destination} · 第 {day + 1} 天</Text></View>
    {dates.length > 1 && <View className='form-field'><Text className='field-label'>安排在哪一天</Text>
      <Picker mode='selector' range={dates} value={targetDay} onChange={(event) => { setTargetDay(Number(event.detail.value)); setError(''); }}>
        <View className='form-input date-value'>{dates[targetDay]}<Text>⌄</Text></View>
      </Picker>
      {targetDay !== day && <Text className='muted'>保存后排在第 {targetDay + 1} 天末尾。</Text>}
    </View>}
    <View className='form-field'><Text className='field-label'>地点或安排</Text><Input className='form-input' value={value.title} maxlength={100} placeholder='例如：黄鹤楼' onInput={(e) => setValue({ ...value, title: e.detail.value })} /></View>
    <View className='form-field'><Text className='field-label'>时间</Text><Input className='form-input' value={value.time} maxlength={40} placeholder='例如：上午或 09:00' onInput={(e) => setValue({ ...value, time: e.detail.value })} /></View>
    <View className='form-field'><Text className='field-label'>备注</Text><Textarea className='form-input trip-note-input' value={value.detail} maxlength={5000} placeholder='添加玩法、交通或提醒' onInput={(e) => setValue({ ...value, detail: e.detail.value })} /></View>
    {existing && !trip.sample && <View className='form-field'>
      <Button className='secondary-button' onClick={() => store.setActivityLocked(trip.id, day, index, !existing.locked)}>{existing.locked ? '解除活动锁定' : '锁定活动'}</Button>
      <Text className='note'>{existing.locked ? '已锁定。AI 调整时会保留该活动。' : '已预约或不想改的安排可以锁定。'}</Text>
    </View>}
    {existing && !changed && <View className='button-row'><Button className='text-button' disabled={index === 0} onClick={() => { store.moveActivity(trip.id, day, index, -1); onClose(); }}>上移</Button><Button className='text-button' disabled={index === trip.days[day].length - 1} onClick={() => { store.moveActivity(trip.id, day, index, 1); onClose(); }}>下移</Button></View>}
    {existing && <Button className='text-button danger' onClick={() => void remove()}>删除这项安排</Button>}
  </Sheet>;
}

export default function TripsPage() {
  const state = useTravelState('trips');
  const [selectedId, setSelectedId] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [showSources, setShowSources] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const openTrip = (id: string) => { setMapOpen(false); setSelectedId(id); store.clearTripFocus(); };
  useDidShow(() => { const id = store.getState().focusTripId; if (id) openTrip(id); });
  const trip = state.trips.find((item) => item.id === selectedId) || state.trips[0];
  const day = Math.max(0, Math.min(state.activeDay, (trip?.days.length || 1) - 1));
  const copy = async () => {
    if (!trip) return;
    try { await Taro.setClipboardData({ data: formatTripText(trip) }); store.toast('行程已复制，可粘贴分享给同行人'); }
    catch (e) { store.toast((e as Error).message || '复制失败，请稍后重试'); }
  };
  const create = () => { setSelectedId(''); setFormOpen(true); };
  const remove = async () => {
    if (!trip) return;
    const result = await Taro.showModal({ title: '删除这段行程？', content: `${trip.title}及完成进度将从此设备删除。`, confirmText: '删除行程', confirmColor: '#cb7651' });
    if (result.confirm) { store.removeTrip(trip.id); setSelectedId(''); }
  };
  const plan = () => {
    if (!trip) return;
    if (state.connection.mode !== 'live') { store.toast('请先在「我的 → 旅行服务」连接真实服务'); return; }
    if (trip.days[day].length > MAX_DAY_ACTIVITIES) { store.toast('当天安排超过12项，暂不支持AI调整'); return; }
    if (!trip.days[day].some((_, index) => !isProtectedActivity(trip, day, index))) { store.toast('当天没有可调整的安排'); return; }
    setAdjustOpen(true);
  };
  const mapTarget = state.mapTarget;
  const mapTrip = mapTarget?.kind === 'trip' ? state.trips.find((item) => item.id === mapTarget.id) : null;
  const mapMessage = mapTarget?.kind === 'message' ? state.messages.find((item) => item.id === mapTarget.id) : null;
  const mapItinerary = mapMessage ? itineraryForMessage(mapMessage) : null;
  if (mapTarget && (mapTrip || mapItinerary)) return <><Toast state={state} /><ItineraryMap key={`${mapTarget.kind}-${mapTarget.id}`} state={state} kind={mapTarget.kind} id={mapTarget.id}
    days={(mapTrip || mapItinerary)!.days} destination={(mapTrip || mapItinerary)!.destination} sample={mapTrip?.sample || mapMessage?.mode === 'demo'} onClose={() => store.closeMap()} /></>;
  if (mapOpen) return <><Toast state={state} /><PlaceSearch key={`${state.connection.mode}:${state.connection.apiUrl}`} state={state} trip={trip} onOpenTrip={openTrip} onClose={() => setMapOpen(false)} /></>;
  return <View className='page'><Toast state={state} /><PageHeading en='02  /  ITINERARY' title='行程手册' subtitle={`共 ${state.trips.length} 份行程`} action={create} />
    <Button className='atlas-explore map-directory' onClick={() => setMapOpen(true)}><Text>地点地图</Text><Text>按城市查找 ↗</Text></Button>
    {!trip ? <Empty icon='map' title='下一站，还在等你' description='创建一份行程草稿，慢慢填满旅途的每一天。' action='新建行程' onClick={create} /> : <>
      {state.trips.length > 1 && <ScrollView scrollX className='trip-select'>{state.trips.map((item) => <Button key={item.id} className={item.id === trip.id ? 'active' : ''} onClick={() => { setSelectedId(item.id); store.setActiveDay(0); }}>{item.title}</Button>)}</ScrollView>}
      <View className='trip-cover'><View className='trip-cover-copy'><Text className='trip-status'>{trip.sample ? '示例行程' : '行程草稿'}</Text><Text className='trip-title'>{trip.title}</Text><Text>{trip.startDate ? `${formatDate(trip.startDate)} — ${formatDate(trip.endDate)}` : '日期待填写'} · {trip.travelers ? `${trip.travelers}人同行` : '人数待填写'}</Text></View></View>
      <View className='ticket-stub'>
        <View><Text className='atlas-label'>{trip.sample ? '示例总预算' : '计划总预算'}</Text><Text className='ticket-value'>{trip.budget ? `¥ ${trip.budget.toLocaleString()}` : '待填写'}</Text></View>
        <View><Text className='atlas-label'>行程天数</Text><Text className='ticket-value'>{dayCount(trip)} 天</Text></View>
        <Button className='atlas-link' onClick={() => setDetailsOpen(true)} ariaLabel='编辑日期、人数与预算'>编辑行程 ↗</Button>
      </View>
      <View className='atlas-section'><Text>每日路线</Text><Button className='atlas-link' onClick={() => store.openMap('trip', trip.id)}>查看行程地图 ↗</Button></View>
      <ScrollView scrollX className='day-tabs'>{trip.days.map((_, index) => { let label = '日期待定'; if (trip.startDate) { const date = new Date(`${trip.startDate}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + index); label = formatDate(date.toISOString().slice(0, 10)); } return <View key={index} className={`day-tab ${day === index ? 'active' : ''}`} onClick={() => store.setActiveDay(index)}><Text>DAY {String(index + 1).padStart(2, '0')}</Text><Text>{label}</Text></View>; })}</ScrollView>
      <View className='timeline'>{trip.days[day].map((activity, index) => { const key = `${day}-${index}`; const done = trip.completed.includes(key); return <View key={key} className={`timeline-item ${done ? 'done' : ''}`}><View className='timeline-icon'><Icon name={activity.icon} /></View><View className='timeline-copy' onClick={() => setEditIndex(index)}><Text className='timeline-time'>{activity.time}{activity.locked ? ' · 已锁定' : ''}</Text><Text className='timeline-title'>{activity.title}</Text><Text className='timeline-description'>{activity.detail}</Text><Text className='activity-edit-hint'>点击编辑</Text></View><Button className={`activity-check ${done ? 'checked' : ''}`} ariaLabel={`${done ? '标记未完成' : '标记完成'}：${activity.title}`} onClick={() => store.toggleActivity(trip.id, key)}>{done ? '✓' : ''}</Button></View>; })}</View>
      <Button className='text-button' onClick={() => setEditIndex(-1)}>＋ 添加当天安排</Button>
      {!trip.sample && <View className='button-row'><Button className='secondary-button' onClick={plan}>AI 调整当天</Button>
        {store.canUndoDayAdjustment(trip.id, day) && <Button className='text-button' onClick={() => {
          try { store.undoDayAdjustment(trip.id, day); } catch (e) { store.toast((e as Error).message); }
        }}>撤销本次调整</Button>}
      </View>}

      {trip.userNotes && <View className='import-day'><Text>出行备注</Text><Text selectable>{trip.userNotes}</Text></View>}
      {trip.notes && <View className='import-day'><Text>行程附注</Text><Text selectable>{trip.notes}</Text></View>}
      <Text className='note'>{trip.sample ? '这是体验用的示例行程，未查询真实票价、开放时间或可用性。' : '这是行程草稿，具体活动与交通仍需确认。'} 点击安排可编辑，点击右侧圆圈记录进度。</Text>
      <View className='trip-progress'><Text>已完成 {trip.completed.length} / {trip.days.reduce((total, activities) => total + activities.length, 0)} 项安排</Text><View className='progress-track'><View className='progress-fill' style={{ width: `${Math.min(100, trip.completed.length / Math.max(1, trip.days.flat().length) * 100)}%` }} /></View></View>
      <View className='trip-actions'><Button className='text-button' onClick={() => void copy()}>复制行程</Button>{trip.source === 'assistant' && <Button className='text-button' onClick={() => setShowSources(true)}>查询依据</Button>}{trip.sourceText && <Button className='text-button' onClick={() => setShowSource(true)}>查看原始回复</Button>}<Button className='text-button danger' onClick={() => void remove()}>删除行程</Button></View>
    </>}
    {trip && detailsOpen && <TripDetailsSheet key={trip.id} trip={trip} onClose={() => setDetailsOpen(false)} />}
    {trip && adjustOpen && <DayAdjustmentSheet key={`${trip.id}-${day}`} trip={trip} day={day} connection={state.connection} onClose={() => setAdjustOpen(false)} />}
    {trip && editIndex !== null && <ActivitySheet key={`${trip.id}-${day}-${editIndex}`} trip={trip} day={day} index={editIndex} onClose={() => setEditIndex(null)} />}
    {trip && showSources && <QuerySources sources={readSources(trip.sources)} available={Array.isArray(trip.sources)} onClose={() => setShowSources(false)} />}
    {trip?.sourceText && showSource && <Sheet title='原始回复' onClose={() => setShowSource(false)}><Text className='trip-source-text' selectable>{trip.sourceText}</Text></Sheet>}
    {formOpen && <PreferenceSheet kind='trip' state={state} onClose={() => setFormOpen(false)} />}
  </View>;
}
