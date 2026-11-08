import { useEffect, useRef, useState } from 'react';
import { Button, Picker, Text, Textarea, View } from '@tarojs/components';
import { Sheet } from './components';
import { chatClient, store } from './stores/travel';
import { createMiniController } from './services/wechat.mjs';
import type { MapPlace } from './domain/map-data.mjs';
import type { Connection, TravelController, TravelSignal, Trip } from './domain/travel.mjs';
import type { RouteLeg } from './services/chat-client.mjs';
import type { DayChange } from './domain/day-adjustment.mjs';
import { comparableDayLegs, dayRevision, isProtectedActivity, makeDayAdjustmentRequest, MAX_ADJUSTMENT_TARGETS, previewDayAdjustment } from './domain/day-adjustment.mjs';

type Preview = { trip: Trip; revision: string; targets: number[]; changes: DayChange[]; apiUrl: string };
type Comparison = { index: number; before: RouteLeg; after: RouteLeg };

export function DayAdjustmentSheet({ trip, day, connection, onClose }: { trip: Trip; day: number; connection: Connection; onClose(): void }) {
  const [targets, setTargets] = useState<number[]>([]);
  const [instruction, setInstruction] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [candidates, setCandidates] = useState<Record<number, MapPlace[]>>({});
  const [places, setPlaces] = useState<Record<number, MapPlace>>({});
  const [legIndex, setLegIndex] = useState<number | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const pending = useRef<TravelController | null>(null);
  const revision = dayRevision(trip, day);
  useEffect(() => {
    setWorking(''); setTargets([]);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [revision, connection.apiUrl, connection.mode]);

  const stop = () => { pending.current?.abort(); pending.current = null; setWorking(''); };
  const close = () => { stop(); onClose(); };
  const reset = () => { setPreview(null); setPlaces({}); setCandidates({}); setLegIndex(null); setComparison(null); setError(''); };
  const run = async (label: string, work: (signal: TravelSignal) => Promise<void>) => {
    if (pending.current) return;
    const controller = createMiniController(); pending.current = controller;
    setWorking(label); setError('');
    try { await work(controller.signal); }
    catch (e) { if (!controller.signal.aborted) setError((e as Error).message || '暂时无法完成，请重试'); }
    finally { if (pending.current === controller) { pending.current = null; if (!controller.signal.aborted) setWorking(''); } }
  };
  const generate = () => run('正在生成调整建议…', async (signal) => {
    if (connection.mode !== 'live') throw new Error('请先连接真实服务');
    const request = makeDayAdjustmentRequest(trip, day, targets, instruction);
    const changes = await chatClient.adjustDay(connection.apiUrl, request, signal);
    if (signal.aborted) return;
    if (!changes.length) { setError('没有生成可用改动，可以试试更具体的要求'); return; }
    previewDayAdjustment(trip, day, targets, changes);
    setPreview({ trip, revision, targets: [...targets], changes, apiUrl: connection.apiUrl });
  });
  const stale = !!preview && (preview.revision !== revision || preview.apiUrl !== connection.apiUrl || connection.mode !== 'live');
  const before = preview?.trip.days[day] || trip.days[day];
  const after = preview ? previewDayAdjustment(preview.trip, day, preview.targets, preview.changes, places) : before;
  const pairs = preview ? comparableDayLegs(before, after) : [];
  const pair = pairs.find((item) => item.index === legIndex) || pairs[0];
  const routeName = (activities: typeof before, index: number) => `${activities[index].title} → ${activities[index + 1].title}`;
  const hasNewPlace = preview?.changes.some(({ index, title }) => title !== before[index].title);
  const lookup = (change: DayChange) => run('正在查询地点候选…', async (signal) => {
    if (!preview || stale) return;
    const [result] = await chatClient.resolvePlaces(preview.apiUrl, preview.trip.destination, [change.title], signal);
    if (signal.aborted) return;
    if (result.failure) throw new Error(result.failure.message);
    setCandidates((previous) => ({ ...previous, [change.index]: result.places }));
  });
  const compare = () => run('正在查询新旧步行路段…', async (signal) => {
    if (!preview || stale || !pair) return;
    setComparison(null);
    const [[original], [updated]] = await Promise.all([
      chatClient.routeDay(preview.apiUrl, pair.original, 'walking', undefined, signal),
      chatClient.routeDay(preview.apiUrl, pair.updated, 'walking', undefined, signal),
    ]);
    if (signal.aborted) return;
    if (original.failure || updated.failure) throw new Error('至少一侧的路线未查到，暂不能对比耗时');
    setComparison({ index: pair.index, before: original, after: updated });
  });
  const apply = () => {
    if (!preview || stale || working) return;
    try { store.applyDayAdjustment(trip.id, day, preview.revision, preview.targets, preview.changes, places); close(); }
    catch (e) { setError((e as Error).message); }
  };
  return <Sheet title={`AI 调整第 ${day + 1} 天`} onClose={close}>
    {!preview ? <>
      <Text className='sheet-description'>勾选要改的安排（最多四项）。已锁定、已完成和未勾选的安排都会保留。</Text>
      {before.map((activity, index) => {
        const protectedItem = isProtectedActivity(trip, day, index), checked = targets.includes(index);
        return <Button key={index} className={`adjust-slot ${checked ? 'active' : ''}`} disabled={protectedItem || !!working}
          onClick={() => { setError(''); if (!checked && targets.length >= MAX_ADJUSTMENT_TARGETS) { setError('一次最多选择四项安排'); return; }
            setTargets(checked ? targets.filter((item) => item !== index) : [...targets, index]); }}>
          <Text>{activity.time} · {activity.title}</Text>
          <Text>{activity.locked ? '已锁定' : protectedItem ? '已完成' : checked ? '已选中' : '选择这项'}</Text>
        </Button>;
      })}
      <View className='form-field'><Text className='field-label'>调整要求</Text><Textarea className='form-input trip-note-input' value={instruction} maxlength={600} disabled={!!working}
        placeholder='例如：把选中的户外景点换成室内活动，尽量保留原时间' onInput={(e) => setInstruction(e.detail.value)} /></View>
      <Text className='note'>生成时会把当天安排与调整要求发给旅行助手。建议将在确认后保存。</Text>
      <Button className='primary-button' loading={!!working} disabled={!!working || connection.mode !== 'live' || !targets.length || !instruction.trim()} onClick={() => void generate()}>生成改动预览</Button>
    </> : <>
      <Text className='sheet-description'>调整 {preview.changes.length} 项，其余 {before.length - preview.changes.length} 项及其他日期保持不变。新建议的开放时间、门票和预约情况待确认。</Text>
      {preview.changes.map((change) => <View className='adjust-card' key={change.index}>
        <Text className='muted'>原安排 · {before[change.index].time}</Text><Text>{before[change.index].title}</Text>
        {!!before[change.index].detail && <Text className='muted'>{before[change.index].detail}</Text>}
        <Text className='adjust-new'>建议 · {change.time}</Text><Text>{change.title}</Text><Text className='muted'>{after[change.index].detail}</Text>
        {change.title !== before[change.index].title && <>
          {places[change.index] && <Text className='note'>已确认：{places[change.index].name} · {places[change.index].address}</Text>}
          <Button className='text-button' disabled={!!working || stale} onClick={() => void lookup(change)}>查询新地点</Button>
          {candidates[change.index]?.map((place, index) => <Button className='map-candidate' key={index} disabled={!!working || stale}
            onClick={() => { setPlaces((previous) => ({ ...previous, [change.index]: place })); setComparison(null); }}>
            <Text>{place.name}</Text><Text>{place.address || '地址未提供'}</Text>
          </Button>)}
          {candidates[change.index]?.length === 0 && <Text className='note'>未找到匹配地点，保存后需重新确认。</Text>}
        </>}
      </View>)}
      {pair ? <View className='adjust-card'>
        <Text>对比相邻路段 · 步行</Text>
        <Picker mode='selector' range={pairs.map((item) => routeName(before, item.index))} value={pairs.indexOf(pair)} disabled={!!working || stale}
          onChange={(e) => { setLegIndex(pairs[Number(e.detail.value)].index); setComparison(null); }}><View className='form-input date-value'>{routeName(before, pair.index)}<Text>⌄</Text></View></Picker>
        <Button className='text-button' disabled={!!working || stale} onClick={() => void compare()}>查询步行耗时对比</Button>
        {comparison && <>
          <Text>原路段：{routeName(before, comparison.index)} · 约 {Math.ceil(comparison.before.duration_seconds! / 60)} 分钟</Text>
          <Text>新路段：{routeName(after, comparison.index)} · 约 {Math.ceil(comparison.after.duration_seconds! / 60)} 分钟</Text>
          <Text className='muted'>来源：{comparison.before.source} / {comparison.after.source} · {comparison.after.retrieved_at}。仅对比这一段。</Text>
        </>}
      </View> : hasNewPlace && <Text className='note'>交通耗时暂未估算。需要先在行程地图确认原地点，并从候选列表确认新地点。</Text>}
      {stale && <Text className='form-error'>当天安排或服务地址已变化，请返回重新生成。</Text>}
      <View className='button-row'><Button className='secondary-button' disabled={!!working} onClick={reset}>返回修改</Button>
        <Button className='primary-button' disabled={!!working || stale} onClick={apply}>确认保存</Button></View>
    </>}
    {working && <View><Text className='note'>{working}</Text><Button className='text-button' onClick={stop}>停止本次请求</Button></View>}
    {error && <Text className='form-error'>{error}</Text>}
  </Sheet>;
}
