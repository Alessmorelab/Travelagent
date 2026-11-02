import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View, Button, Input, Picker } from '@tarojs/components';
import { DESTINATIONS } from '../../domain/travel.mjs';
import type { State } from '../../domain/travel.mjs';
import type { SavedPlace } from '../../domain/saved-places.mjs';
import { DestinationSheet, Empty, FavoriteButton, Filters, PageHeading, Scenic, Sheet, Toast } from '../../components';
import { goTab, store, useTravelState } from '../../stores/travel';

function AddPlaceSheet({ place, state, onClose }: { place: SavedPlace; state: State; onClose(): void }) {
  const trips = state.trips.filter((trip) => !trip.sample);
  const [tripId, setTripId] = useState(trips[0]?.id || '');
  const [day, setDay] = useState(0);
  const [error, setError] = useState('');
  const trip = trips.find((item) => item.id === tripId) || trips[0];
  const selectedDay = Math.min(day, (trip?.days.length || 1) - 1);
  const add = () => {
    if (!trip) return;
    try { store.addSavedPlaceToTrip(place.id, trip.id, selectedDay); onClose(); goTab('trips'); }
    catch (e) { setError((e as Error).message); }
  };
  return <Sheet title='加入每日行程' onClose={onClose}>
    <Text className='sheet-description'>{place.name} · {place.address || place.city || '地址未提供'}</Text>
    {!trip ? <><Text className='note'>请先创建或保存一份自己的行程，再选择加入哪一天。</Text><Button className='primary-button' onClick={() => { onClose(); goTab('trips'); }}>前往行程页</Button></> : <>
      <View className='form-field'><Text className='field-label'>选择行程</Text><Picker mode='selector' range={trips.map((item) => item.title)} value={Math.max(0, trips.indexOf(trip))} onChange={(e) => { setTripId(trips[Number(e.detail.value)]?.id || ''); setDay(0); setError(''); }}><View className='form-input date-value'>{trip.title}<Text>⌄</Text></View></Picker></View>
      <View className='form-field'><Text className='field-label'>加入哪一天</Text><Picker mode='selector' range={trip.days.map((_, index) => `第 ${index + 1} 天`)} value={selectedDay} onChange={(e) => setDay(Number(e.detail.value))}><View className='form-input date-value'>第 {selectedDay + 1} 天<Text>⌄</Text></View></Picker></View>
      <Text className='note'>会保留该地点的实际地址、坐标和来源，具体游览时间由你继续安排。</Text>
      {error && <Text className='form-error'>{error}</Text>}
      <Button className='primary-button' onClick={add}>加入第 {selectedDay + 1} 天</Button>
    </>}
  </Sheet>;
}

export default function FavoritesPage() {
  const state = useTravelState('favorites');
  const [tab, setTab] = useState<'places' | 'inspiration'>('places');
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [adding, setAdding] = useState('');
  const keyword = query.trim().toLowerCase();
  const saved = state.savedPlaces.filter((place) => !keyword || `${place.name} ${place.address} ${place.city}`.toLowerCase().includes(keyword));
  const list = DESTINATIONS.filter((item) => (browsing || state.favorites.includes(item.id)) && (state.filter === '全部' || item.category === state.filter));
  const discover = () => { store.setFilter('全部'); setBrowsing(true); };
  const open = (place: SavedPlace) => { void Taro.openLocation({ latitude: place.latitude, longitude: place.longitude, name: place.name, address: place.address }).catch(() => store.toast('暂时无法打开位置，请检查微信或网络')); };
  const selected = state.savedPlaces.find((place) => place.id === adding);
  return <View className='page'>
    <PageHeading en='PLACES TO KEEP' title='我的收藏' subtitle='保存实际查到的地点，慢慢安排下一次出发。' />
    <View className='saved-place-tabs'><Button className={tab === 'places' ? 'active' : ''} onClick={() => setTab('places')}>地点收藏 · {state.savedPlaces.length}</Button><Button className={tab === 'inspiration' ? 'active' : ''} onClick={() => setTab('inspiration')}>灵感目的地 · {state.favorites.length}</Button></View>
    {tab === 'places' ? <>
      <Input className='form-input saved-place-search' value={query} maxlength={100} placeholder='按地点名称、地址或城市筛选' onInput={(e) => setQuery(e.detail.value)} />
      {saved.map((place) => <View className='saved-place-card' key={place.id}>
        <Text className='saved-place-title'>{place.name}</Text><Text>{place.address || '地址未提供'}</Text>
        {!!place.city && <Text className='muted'>{place.city}</Text>}
        <Text className='muted'>来源：{place.source} · 上次查询：{place.retrieved_at}</Text>
        <View className='saved-place-actions'><Button className='text-button' onClick={() => open(place)}>打开位置</Button><Button className='text-button' onClick={() => setAdding(place.id)}>加入行程</Button><Button className='text-button danger' onClick={() => store.removeSavedPlace(place.id)}>移除收藏</Button></View>
      </View>)}
      {!saved.length && (state.savedPlaces.length ? <View className='empty'><Text className='empty-title'>没有符合筛选条件的地点</Text><Button className='text-button' onClick={() => setQuery('')}>清除筛选</Button></View> : <Empty icon='bookmark' title='把想去的地点存下来' description='在地点搜索或行程地图中，确认地点后点「收藏地点」，以后可以直接加入行程。' action='去地图找地点' onClick={() => goTab('trips')} />)}
      {!!saved.length && <Text className='note'>地点保存在此设备，开放时间与可用性请在出行前重新确认。</Text>}
    </> : <>
      <Text className='note'>以下为旅行灵感内容和示例预算，可收藏作参考。</Text>
      {browsing && <Button className='text-button' onClick={() => setBrowsing(false)}>← 返回已收藏的灵感</Button>}<Filters state={state} />
      {list.length ? list.map((d) => <View className='favorite-card' key={d.id}><View className='favorite-photo-wrap'><View onClick={() => setDetail(d.id)}><Scenic destination={d} className='favorite-image' /></View><FavoriteButton destination={d} state={state} /></View><View className='favorite-copy'><View className='favorite-heading'><Text>{d.name}</Text><Text className='country'> / {d.country}</Text></View><Text className='destination-subtitle'>{d.subtitle}</Text><View className='favorite-footer'><Text>{d.days} · {d.category}</Text><Button className='text-button' onClick={() => setDetail(d.id)}>去看看 →</Button></View></View></View>) : <Empty icon='bookmark' title='这里还没有旅行灵感' description='浏览目的地，收藏喜欢的方向。' action='发现目的地' onClick={discover} />}
    </>}
    {selected && <AddPlaceSheet key={selected.id} place={selected} state={state} onClose={() => setAdding('')} />}
    {detail && <DestinationSheet id={detail} state={state} onClose={() => setDetail('')} />}<Toast state={state} />
  </View>;
}
