import { useEffect, useRef, useState } from 'react';
import Taro from '@tarojs/taro';
import { Button, Input, Map as NativeMap, Text, View } from '@tarojs/components';
import type { State } from './domain/travel.mjs';
import type { MapSearchResult } from './services/chat-client.mjs';
import { createMiniController } from './services/wechat.mjs';
import { chatClient } from './stores/travel';
import { SavedPlaceButton } from './saved-place-button';

type SearchPage = MapSearchResult & { city: string; query: string };
const numberLabel = (index: number) => String(index + 1).padStart(2, '0');

export function PlaceSearch({ state, initialCity, onClose }: { state: State; initialCity: string; onClose(): void }) {
  const [city, setCity] = useState(initialCity);
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<SearchPage | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [view, setView] = useState<'list' | 'map'>('list');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [mapError, setMapError] = useState(false);
  const pending = useRef<ReturnType<typeof createMiniController> | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  const live = state.connection.mode === 'live';
  const canSearch = live && !!city.trim() && !!query.trim() && !loading;
  const search = async () => {
    if (!canSearch || pending.current) return;
    const searchCity = city.trim(), searchTerm = query.trim();
    const controller = createMiniController();
    pending.current = controller;
    setLoading(true); setError(''); setPage(null); setSelected(null); setView('list'); setMapError(false);
    try {
      const data = await chatClient.searchPlaces(state.connection.apiUrl, searchCity, searchTerm, controller.signal);
      if (!controller.signal.aborted) setPage({ ...data, city: searchCity, query: searchTerm });
    } catch (failure) {
      if (!controller.signal.aborted) setError((failure as Error).message || '地点查询失败，请稍后重试');
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  const places = page?.places || [];
  const current = selected === null ? null : places[selected];
  const center = current || places[0];
  const markers = places.map((place, index) => ({
    id: index + 1, latitude: place.latitude, longitude: place.longitude,
    title: `${numberLabel(index)} · ${place.name}`, iconPath: '/assets/tabs/map-active.png',
    width: index === selected ? 36 : 28, height: index === selected ? 36 : 28,
    ...(index === selected ? { callout: { content: `${numberLabel(index)} · ${place.name}`, display: 'ALWAYS' as const,
      color: '#183f3c', bgColor: '#fffefa', fontSize: 13, padding: 6, borderRadius: 4, borderWidth: 1,
      borderColor: '#c9cec0', anchorX: 0, anchorY: 0, textAlign: 'center' as const } } : {}),
  }));
  const showMap = (index: number) => {
    setSelected(index); setView('map'); setMapError(false);
    Taro.nextTick(() => { void Taro.pageScrollTo({ selector: '#place-results', duration: 160 }).catch(() => {}); });
  };

  return <View className='page gazetteer'>
    <View className='route-mast'><Text className='folio-code'>02  /  GAZETTEER</Text><Button className='atlas-link' onClick={onClose}>← 返回行程</Button></View>
    <Text className='route-title'>地点搜索</Text><Text className='gazetteer-intro'>按城市查找地点，核对地址，再收进你的旅行图册。</Text>
    <View className='gazetteer-form'>
      <View className='lookup-field'><Text className='field-label'>所在城市</Text><Input ariaLabel='所在城市' value={city} maxlength={50} placeholder='例如杭州' onInput={(event) => setCity(event.detail.value)} /></View>
      <View className='lookup-field'><Text className='field-label'>地点关键词</Text><Input ariaLabel='地点关键词' value={query} maxlength={45} confirmType='search' placeholder='景点、街区或车站' onInput={(event) => setQuery(event.detail.value)} onConfirm={() => void search()} /></View>
      <Button className='primary-button' disabled={!canSearch} loading={loading} onClick={() => void search()}>{loading ? '正在查询…' : '查询地点'}</Button>
    </View>
    {!live && <Text className='note'>请在「我的 → 旅行服务」切换到真实服务后查询地点。</Text>}
    {error && <Text className='form-error'>{error}</Text>}
    {live && !page && !loading && !error && <View className='lookup-guide'><Text className='folio-code'>SEARCH NOTES</Text><Text>试试这些关键词</Text>
      <View>{['博物馆', '公园', '火车站'].map((term) => <Button key={term} onClick={() => setQuery(term)}>{term}</Button>)}</View></View>}
    {page && <View id='place-results'>
      <View className='atlas-section'><Text>地点索引</Text><Text className='folio-code'>{String(places.length).padStart(2, '0')} 处</Text></View>
      <Text className='lookup-context'>{page.city} / {page.query}</Text>
      {places.length ? <>
        <View className='saved-place-tabs lookup-tabs'>
          <Button className={view === 'list' ? 'active' : ''} onClick={() => setView('list')}>结果列表</Button>
          <Button className={view === 'map' ? 'active' : ''} onClick={() => { setMapError(false); setView('map'); }}>地点地图</Button>
        </View>
        {view === 'list' ? places.map((place, index) => <View key={place.uid || index} className={`lookup-card ${selected === index ? 'selected' : ''}`}>
          <View className='lookup-card-head'><Text className='stop-number'>{numberLabel(index)}</Text><View><Text className='lookup-name'>{place.name}</Text><Text className='lookup-address'>{place.address || '地址未提供'}</Text></View></View>
          <View className='lookup-actions'><Button className='atlas-link' onClick={() => showMap(index)}>地图定位 ↗</Button><SavedPlaceButton place={place} city={page.city} state={state} /></View>
        </View>) : <>
          <View className='route-plate'><NativeMap className='place-map' latitude={center.latitude} longitude={center.longitude} scale={selected === null ? 12 : 15} markers={markers}
            includePoints={selected === null ? places.map(({ latitude, longitude }) => ({ latitude, longitude })) : undefined}
            onMarkerTap={(event) => { const index = Number(event.detail.markerId) - 1; if (places[index]) setSelected(index); }} onError={() => setMapError(true)} />
            <View className='route-key'><Text>{page.city} · {places.length} 处地点</Text>{selected !== null && <Button onClick={() => setSelected(null)}>显示全部</Button>}</View></View>
          {mapError && <Text className='form-error'>地图加载失败，仍可在结果列表中核对地址和收藏地点。</Text>}
          {current && selected !== null ? <View className='lookup-card selected'>
            <Text className='folio-code'>选中地点 / {numberLabel(selected)}</Text><Text className='lookup-name'>{current.name}</Text><Text className='lookup-address'>{current.address || '地址未提供'}</Text>
            <SavedPlaceButton place={current} city={page.city} state={state} /></View> : <Text className='sheet-description'>点按地图标记，查看地址与收藏选项。</Text>}
        </>}
      </> : <View className='lookup-empty'><Text>没有找到匹配地点</Text><Text>请核对城市，或试试更短的名称。</Text></View>}
      <Text className='lookup-source'>来源：{page.source} · 查询时间：{page.retrieved_at}</Text>
    </View>}
  </View>;
}
