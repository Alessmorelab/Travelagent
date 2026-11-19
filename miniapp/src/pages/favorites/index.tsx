import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View, Button, Input, Picker } from '@tarojs/components';
import { DESTINATIONS, MAX_ACTIVITIES_PER_DAY } from '../../domain/travel.mjs';
import { tripEndDate } from '../../domain/trip-details.mjs';
import { samePlace } from '../../domain/saved-places.mjs';
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
  const choices = trip?.days.map((activities, index) => ({
    date: tripEndDate(trip.startDate, index + 1),
    existing: activities.some((activity) => samePlace(activity.place, place)),
    full: activities.length >= MAX_ACTIVITIES_PER_DAY,
    count: activities.length,
    summary: activities.slice(0, 2).map((activity) => activity.title).join(' → '),
  })) || [];
  const choice = choices[selectedDay];
  const add = () => {
    if (!trip) return;
    try { store.addSavedPlaceToTrip(place.id, trip.id, selectedDay); onClose(); goTab('trips'); }
    catch (e) { setError((e as Error).message); }
  };
  return <Sheet title='加入每日行程' folio='03  /  PLACE TRANSFER' onClose={onClose} footer={<>
    {error && <Text className='form-error'>{error}</Text>}
    {choice ? <Button className='primary-button' disabled={choice.full && !choice.existing} onClick={add}>
      {choice.existing ? `查看第 ${selectedDay + 1} 天的安排` : choice.full ? '当天已满，请另选日期' : `加入第 ${selectedDay + 1} 天`}
    </Button> : <Button className='primary-button' onClick={() => { onClose(); goTab('trips'); }}>前往行程页</Button>}
  </>}>
    <View className='transfer-place'><Text className='folio-code'>收藏地点{place.city ? `  /  ${place.city}` : ''}</Text>
      <Text className='transfer-title'>{place.name}</Text><Text className='transfer-address'>{place.address || '地址未提供'}</Text></View>
    {!trip ? <Text className='note'>请先创建或保存一份自己的行程，再选择加入哪一天。</Text> : <>
      <View className='form-field'><Text className='field-label'>选择行程</Text><Picker mode='selector' range={trips.map((item) => item.title)} value={Math.max(0, trips.indexOf(trip))} onChange={(e) => { setTripId(trips[Number(e.detail.value)]?.id || ''); setDay(0); setError(''); }}><View className='form-input date-value'>{trip.title}<Text>⌄</Text></View></Picker></View>
      <View className='atlas-section'><Text>选择日期</Text><Text className='folio-code'>DAY INDEX</Text></View>
      {choices.map((item, index) => <Button key={index} className={`transfer-day ${index === selectedDay ? 'selected' : ''}`}
        ariaLabel={`第 ${index + 1} 天，${item.date || '日期待定'}，${item.count} 项安排${item.existing ? '，已含此地点' : item.full ? '，已满' : ''}${index === selectedDay ? '，已选中' : ''}`}
        onClick={() => { setDay(index); setError(''); }}>
        <View className='transfer-number'><Text>DAY</Text><Text>{String(index + 1).padStart(2, '0')}</Text></View>
        <View className='transfer-day-copy'><Text>{item.date || '日期待定'} · {item.count} 项安排</Text>
          <Text>{item.summary || '还没有安排'}{item.count > 2 ? ' …' : ''}</Text>
          {(item.existing || item.full) && <Text className='transfer-badge'>{item.existing ? '已含此地点' : '当天已满'}</Text>}</View>
        <Text className='transfer-radio'>{index === selectedDay ? '✓' : ''}</Text>
      </Button>)}
      <Text className='sheet-description'>新地点会排在所选日期的末尾，游览时间可稍后填写。</Text>
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
    <Toast state={state} />
    <PageHeading en='03  /  PLACE INDEX' title='地点收藏册' subtitle='查过的地点，想去的目的地。' />
    <View className='saved-place-tabs'><Button className={tab === 'places' ? 'active' : ''} onClick={() => setTab('places')}>地点收藏 · {state.savedPlaces.length}</Button><Button className={tab === 'inspiration' ? 'active' : ''} onClick={() => setTab('inspiration')}>灵感目的地 · {state.favorites.length}</Button></View>
    {tab === 'places' ? <>
      {!!state.savedPlaces.length && <Input className='form-input saved-place-search' value={query} maxlength={100} placeholder='按地点名称、地址或城市筛选' onInput={(e) => setQuery(e.detail.value)} />}
      {saved.map((place) => <View className='saved-place-card' key={place.id}>
        <Text className='place-card-city'>{place.city || '地点档案'}  /  PLACE FILE</Text>
        <Text className='saved-place-title'>{place.name}</Text><Text>{place.address || '地址未提供'}</Text>
        <Text className='muted'>来源：{place.source} · 上次查询：{place.retrieved_at}</Text>
        <View className='saved-place-actions'><Button className='place-add' onClick={() => setAdding(place.id)}>加入行程</Button><Button className='text-button' onClick={() => open(place)}>打开位置 ↗</Button><Button className='text-button danger' onClick={() => store.removeSavedPlace(place.id)}>移除收藏</Button></View>
      </View>)}
      {!saved.length && (state.savedPlaces.length ? <View className='empty'><Text className='empty-title'>没有符合筛选条件的地点</Text><Button className='text-button' onClick={() => setQuery('')}>清除筛选</Button></View> : <View className='index-sheet'>
        <View className='index-map'><View className='map-fold fold-one' /><View className='map-fold fold-two' /><View className='map-fold fold-three' /><View className='index-pin' /></View>
        <Text className='atlas-imprint'>PLACE COLLECTION  /  00</Text>
        <Text className='index-heading'>收藏第一个地点</Text><Text className='index-description'>在行程地图上确认地点后，点「收藏地点」，就能在这里找到它。</Text>
        <Button className='primary-button' onClick={() => goTab('trips')}>打开行程 →</Button>
      </View>)}
      {!!saved.length && <Text className='note'>地点保存在此设备，开放时间与可用性请在出行前重新确认。</Text>}
      {!state.savedPlaces.length && !!state.favorites.length && <View>
        <View className='atlas-section'><Text>已收藏的灵感</Text><Button className='atlas-link' onClick={() => setTab('inspiration')}>查看全部 ↗</Button></View>
        {DESTINATIONS.filter((item) => state.favorites.includes(item.id)).slice(0, 2).map((item, index) =>
          <Button key={item.id} className='index-entry' onClick={() => setDetail(item.id)}>
            <Text className='index-number'>0{index + 1}</Text><Text className='index-name'>{item.name}</Text><Text className='index-meta'>{item.country} · {item.category}</Text><Text>↗</Text>
          </Button>)}
      </View>}
    </> : <>
      <Text className='note'>以下为旅行灵感内容和示例预算，可收藏作参考。</Text>
      {browsing && <Button className='text-button' onClick={() => setBrowsing(false)}>← 返回已收藏的灵感</Button>}<Filters state={state} />
      {list.length ? list.map((d) => <View className='favorite-card' key={d.id}><View className='favorite-photo-wrap'><View onClick={() => setDetail(d.id)}><Scenic destination={d} className='favorite-image' /></View><FavoriteButton destination={d} state={state} /></View><View className='favorite-copy'><View className='favorite-heading'><Text>{d.name}</Text><Text className='country'> / {d.country}</Text></View><Text className='destination-subtitle'>{d.subtitle}</Text><View className='favorite-footer'><Text>{d.days} · {d.category}</Text><Button className='text-button' onClick={() => setDetail(d.id)}>去看看 →</Button></View></View></View>) : <Empty icon='bookmark' title='这里还没有旅行灵感' description='浏览目的地，收藏喜欢的方向。' action='发现目的地' onClick={discover} />}
    </>}
    {selected && <AddPlaceSheet key={selected.id} place={selected} state={state} onClose={() => setAdding('')} />}
    {detail && <DestinationSheet id={detail} state={state} onClose={() => setDetail('')} />}
  </View>;
}
