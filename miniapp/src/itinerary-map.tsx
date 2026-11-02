import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Map as NativeMap, ScrollView, Text, View } from '@tarojs/components';
import type { Activity, State } from './domain/travel.mjs';
import type { MapPlace } from './domain/map-data.mjs';
import { validPlace } from './domain/map-data.mjs';
import type { MapResolution, RouteLeg } from './services/chat-client.mjs';
import { SavedPlaceButton } from './saved-place-button';
import { createMiniController } from './services/wechat.mjs';
import { chatClient, store } from './stores/travel';

const modes = [{ id: 'walking', label: '步行' }, { id: 'driving', label: '驾车' }, { id: 'transit', label: '公交' }];

export function ItineraryMap({ state, kind, id, days, destination, onClose, sample = false }: {
  state: State; kind: 'trip' | 'message'; id: string; days: Activity[][]; destination: string; onClose(): void; sample?: boolean;
}) {
  const [day, setDay] = useState(0);
  const [city, setCity] = useState(destination);
  const [chosen, setChosen] = useState<(MapPlace | null)[]>([]);
  const [options, setOptions] = useState<Record<number, string>>({});
  const [results, setResults] = useState<Record<number, MapResolution>>({});
  const [excluded, setExcluded] = useState<number[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState('walking');
  const [legs, setLegs] = useState<RouteLeg[]>([]);
  const [selectionDay, setSelectionDay] = useState('');
  const autoSearched = useRef(new Set<string>());
  const [searching, setSearching] = useState(false);
  const [routing, setRouting] = useState(false);
  const [error, setError] = useState('');
  const searchControl = useRef<ReturnType<typeof createMiniController> | null>(null);
  const routeControl = useRef<ReturnType<typeof createMiniController> | null>(null);
  const cache = useRef(new Map<string, RouteLeg[]>());
  const legCache = useRef(new Map<string, RouteLeg>());
  const searchGeneration = useRef(0), routeGeneration = useRef(0);
  const activities = (days[day] || []).slice(0, 12);
  const titleKey = JSON.stringify(activities.map((item) => [item.title, item.time, item.detail, item.alternatives || []]));
  const currentDay = useRef('');
  const dayKey = `${kind}/${id}/${day}/${titleKey}`;
  const allowed = state.connection.mode === 'live' && !sample;

  const bind = (index: number, place: MapPlace) => {
    setChosen((previous) => activities.map((_, i) => i === index ? place : previous[i] || null));
    store.bindMapPlace(kind, id, day, index, activities[index].title, place, JSON.stringify([activities[index].title, activities[index].time, activities[index].detail]));
    setSelected(index);
  };

  const search = async (onlyFailed = false, option?: { index: number; query: string }) => {
    if (!allowed) { setError(sample ? '示例行程不自动查询真实地点。请先保存真实服务生成的行程。' : '请先在「我的 → 旅行服务」连接真实服务'); return; }
    if (!city.trim()) { setError('请填写这份行程所在的城市'); return; }
    searchControl.current?.abort();
    const controller = createMiniController(); searchControl.current = controller;
    const generation = ++searchGeneration.current;
    const key = dayKey;
    const choices = option ? { ...options, [option.index]: option.query } : options;
    const indices = activities.map((_, index) => index).filter((index) => !chosen[index] && !excluded.includes(index)
      && (!option || index === option.index) && (!activities[index].alternatives?.length || !!choices[index])
      && (!onlyFailed || !!results[index]?.failure || results[index]?.places.length === 0));
    if (!indices.length) return;
    setSearching(true); setError('');
    try {
      const data = await chatClient.resolvePlaces(state.connection.apiUrl, city.trim(), indices.map((index) => choices[index] || activities[index].title), controller.signal);
      if (controller.signal.aborted || generation !== searchGeneration.current || currentDay.current !== key) return;
      setResults((previous) => ({ ...previous, ...Object.fromEntries(indices.map((index, i) => [index, data[i]])) }));
      const automatic: Record<number, MapPlace> = {};
      indices.forEach((index, i) => {
        // Unique exact names can be bound automatically. Similar or duplicate
        // names always require an explicit selection, with their addresses.
        const exact = data[i].places.filter((place) => place.name === (choices[index] || activities[index].title).trim());
        if (exact.length === 1) {
          automatic[index] = exact[0];
          store.bindMapPlace(kind, id, day, index, activities[index].title, exact[0], JSON.stringify([activities[index].title, activities[index].time, activities[index].detail]));
        }
      });
      setChosen((previous) => activities.map((_, index) => automatic[index] || previous[index] || null));
    } catch (e) { if (!controller.signal.aborted && generation === searchGeneration.current) setError((e as Error).message); }
    finally { if (generation === searchGeneration.current) setSearching(false); }
  };

  useEffect(() => {
    currentDay.current = dayKey;
    searchGeneration.current++; searchControl.current?.abort();
    routeGeneration.current++; routeControl.current?.abort();
    setSelectionDay(dayKey);
    setChosen(activities.map((item) => validPlace(item.place) ? item.place : null));
    setResults({}); setOptions({}); setExcluded([]); setSelected(null); setLegs([]); setSearching(false); setRouting(false); setError('');
    return () => { currentDay.current = ''; searchGeneration.current++; routeGeneration.current++; searchControl.current?.abort(); routeControl.current?.abort(); };
  }, [dayKey]);

  useEffect(() => {
    if (selectionDay === dayKey && allowed && city.trim() && !autoSearched.current.has(dayKey)) {
      autoSearched.current.add(dayKey); void search();
    }
  }, [selectionDay, dayKey, allowed]);

  const stops = activities.map((item, index) => ({ activity: item, place: chosen[index], index })).filter((item) => !excluded.includes(item.index));
  const ready = selectionDay === dayKey && stops.length >= 2 && stops.every((item) => validPlace(item.place));
  const routeKey = JSON.stringify([kind, id, day, mode, stops.map((item) => item.place ? [item.index, item.place.latitude, item.place.longitude] : null)]);
  const latestRoute = useRef(routeKey); latestRoute.current = routeKey;

  const calculate = async (failedOnly = false) => {
    if (!allowed || !ready) return;
    routeControl.current?.abort(); const controller = createMiniController(); routeControl.current = controller;
    const generation = ++routeGeneration.current, key = routeKey;
    const segmentKeys = stops.slice(1).map((_, index) => JSON.stringify([mode,
      stops[index].place!.latitude, stops[index].place!.longitude, stops[index + 1].place!.latitude, stops[index + 1].place!.longitude]));
    const cached = segmentKeys.map((key, index) => { const leg = legCache.current.get(key); return leg ? { ...leg, index } : null; });
    const missing = cached.flatMap((leg, index) => leg ? [] : [index]);
    const segments = failedOnly ? legs.filter((leg) => leg.failure).map((leg) => leg.index) : missing.length < cached.length ? missing : undefined;
    if (failedOnly && !segments?.length) return;
    setRouting(true); setError('');
    try {
      const data = segments?.length === 0 ? [] : await chatClient.routeDay(state.connection.apiUrl, stops.map((item) => item.place!), mode, segments, controller.signal);
      if (controller.signal.aborted || generation !== routeGeneration.current || key !== latestRoute.current) return;
      const merged = failedOnly ? legs.map((leg) => data.find((item) => item.index === leg.index) || leg)
        : segmentKeys.map((_, index) => data.find((item) => item.index === index) || cached[index]!);
      for (const leg of merged) if (!leg.failure) legCache.current.set(segmentKeys[leg.index], leg);
      while (legCache.current.size > 64) legCache.current.delete(legCache.current.keys().next().value!);
      cache.current.set(key, merged);
      if (cache.current.size > 12) cache.current.delete(cache.current.keys().next().value!);
      setLegs(merged);
    } catch (e) { if (!controller.signal.aborted && generation === routeGeneration.current) setError((e as Error).message); }
    finally { if (generation === routeGeneration.current) setRouting(false); }
  };

  // Coordinates, order and mode form the cache key. Editing any stop invalidates
  // its route, so an old polyline can never be displayed for the new itinerary.
  useEffect(() => {
    routeGeneration.current++; routeControl.current?.abort(); setRouting(false);
    const saved = cache.current.get(routeKey); setLegs(saved || []);
    if (allowed && ready && !saved && currentDay.current === dayKey) void calculate();
  }, [routeKey, allowed, ready]);

  const markers = activities.flatMap((item, index) => selectionDay === dayKey && chosen[index] && !excluded.includes(index) ? [{ id: index + 1,
    latitude: chosen[index]!.latitude, longitude: chosen[index]!.longitude, title: `${index + 1}. ${chosen[index]!.name}`,
    iconPath: '/assets/tabs/map-active.png', width: 28, height: 28 }] : []);
  const center = selected !== null && chosen[selected] ? chosen[selected] : markers[0];
  const polyline = (selectionDay === dayKey ? legs : []).filter((leg) => !leg.failure && leg.points).map((leg) => ({ points: leg.points!, color: '#376654', width: 5, arrowLine: true }));
  const open = (place: MapPlace) => { void Taro.openLocation({ latitude: place.latitude, longitude: place.longitude, name: place.name, address: place.address }).catch(() => setError('暂时无法打开位置，请检查微信权限或稍后重试')); };

  return <View className='page itinerary-map-page'>
    <View className='place-map-heading'><Button className='text-button' onClick={onClose}>← 返回</Button><Text>行程地图</Text></View>
    <ScrollView scrollX className='day-tabs'>{days.map((_, index) => <View key={index} className={`day-tab ${day === index ? 'active' : ''}`} onClick={() => setDay(index)}><Text>DAY {String(index + 1).padStart(2, '0')}</Text></View>)}</ScrollView>
    <View className='form-field'><Text className='field-label'>所在城市</Text><Input className='form-input' value={city} maxlength={50} placeholder='请填写行程所在城市' onInput={(event) => { searchGeneration.current++; searchControl.current?.abort(); setSearching(false); setCity(event.detail.value); }} /></View>
    <Button className='secondary-button' loading={searching} disabled={searching || !allowed} onClick={() => void search()}>查询当天地点</Button>
    <Text className='note'>首次查看请查询地点；同名或相似地点需核对地址后选择。路线按当前顺序计算，耗时仅为查询时估算。</Text>
    {(days[day]?.length || 0) > 12 && <Text className='note'>当前显示前12项安排，请拆分较长的行程。</Text>}
    {!allowed && <Text className='form-error'>{sample ? '这是示例行程，未查询真实地点和路线。' : '请先连接真实服务。'}</Text>}
    {error && <Text className='form-error'>{error}</Text>}
    {center && <NativeMap className='place-map' latitude={center.latitude} longitude={center.longitude} markers={markers} polyline={polyline}
      includePoints={markers.map(({ latitude, longitude }) => ({ latitude, longitude }))} scale={12}
      onMarkerTap={(event) => setSelected(Number(event.detail.markerId) - 1)} onError={() => setError('地图加载失败，请检查网络或微信开发者工具')} />}
    <View className='map-mode-options'>{modes.map((item) => <Button key={item.id} className={`map-mode ${mode === item.id ? 'active' : ''}`} onClick={() => setMode(item.id)}>{item.label}</Button>)}</View>
    {routing && <Text className='note'>正在查询实际路线…</Text>}
    {!ready && <Text className='note'>至少确认两个地点后显示路线；休息等安排可选择“不显示在地图”。</Text>}
    {ready && !routing && !legs.length && <Button className='text-button' onClick={() => void calculate()}>计算当天路线</Button>}
    {legs.map((leg) => <View className={`map-leg ${leg.failure ? 'failed' : ''}`} key={leg.index}>
      <Text>{stops[leg.index]?.place?.name} → {stops[leg.index + 1]?.place?.name}</Text>
      <Text>{leg.failure ? leg.failure.message : `${((leg.distance_m || 0) / 1000).toFixed(1)} 公里 · 预计 ${Math.ceil((leg.duration_seconds || 0) / 60)} 分钟`}</Text>
      {!leg.failure && <Text className='muted'>来源：{leg.source} · {leg.retrieved_at}</Text>}
    </View>)}
    {legs.some((leg) => leg.failure) && <Button className='text-button' disabled={routing} onClick={() => void calculate(true)}>仅重试失败路段</Button>}
    {activities.map((activity, index) => <View key={`${day}-${index}-${activity.title}`} className={`map-stop ${selected === index ? 'selected' : ''}`}>
      <Text className='map-stop-title' onClick={() => setSelected(index)}>{index + 1}. {activity.time} · {activity.title}</Text>
      {activity.groupTitle && <Text className='note'>同一时段：{activity.groupTitle}</Text>}
      {activity.alternatives?.length && !chosen[index] && !excluded.includes(index) ? <View><Text className='note'>请从以下安排中选择一项，再核对具体地点。</Text>{activity.alternatives.map((name) => <Button key={name} className='map-candidate' disabled={searching || !allowed} onClick={() => { setOptions((previous) => ({ ...previous, [index]: name })); void search(false, { index, query: name }); }}>{name}</Button>)}</View> : null}
      {chosen[index] && !excluded.includes(index) ? <><Text>{chosen[index]!.address || '地址未提供'}</Text><Text className='muted'>来源：{chosen[index]!.source} · {chosen[index]!.retrieved_at}</Text>
        <Button className='text-button' onClick={() => open(chosen[index]!)}>打开位置</Button><SavedPlaceButton place={chosen[index]!} city={chosen[index]!.city || destination || city} state={state} /><Button className='text-button' onClick={() => setChosen((previous) => previous.map((place, i) => i === index ? null : place))}>重新选择地点</Button></> : !excluded.includes(index) && <>
        {results[index]?.failure && <Text className='form-error'>{results[index].failure!.message}</Text>}
        {results[index] && !results[index].failure && !results[index].places.length && <Text className='note'>未查到地点，请在行程中修改名称后重试。</Text>}
        {results[index]?.places.map((place, candidate) => <Button className='map-candidate' key={candidate} onClick={() => bind(index, place)}><Text>{place.name}</Text><Text>{place.address || '地址未提供'}</Text></Button>)}
      </>}
      <Button className='text-button' onClick={() => setExcluded((previous) => previous.includes(index) ? previous.filter((value) => value !== index) : [...previous, index])}>{excluded.includes(index) ? '显示在地图' : '不显示在地图'}</Button>
    </View>)}
    {Object.values(results).some((item) => item.failure || !item.places.length) && <Button className='text-button' disabled={searching} onClick={() => void search(true)}>仅重试未查到的地点</Button>}
  </View>;
}
