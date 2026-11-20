import { useState } from 'react';
import Taro from '@tarojs/taro';
import { Text, View, Button, Input } from '@tarojs/components';
import { DESTINATIONS } from '../../domain/travel.mjs';
import { AddPlaceSheet } from '../../add-place-sheet';
import type { SavedPlace } from '../../domain/saved-places.mjs';
import { DestinationSheet, Empty, FavoriteButton, Filters, PageHeading, Scenic, Toast } from '../../components';
import { goTab, store, useTravelState } from '../../stores/travel';

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
    {selected && <AddPlaceSheet key={selected.id} place={selected} state={state} onClose={() => setAdding('')}
      onChoose={(tripId, day) => { store.addSavedPlaceToTrip(selected.id, tripId, day); setAdding(''); goTab('trips'); }}
      onNoTrip={() => { setAdding(''); goTab('trips'); }} />}
    {detail && <DestinationSheet id={detail} state={state} onClose={() => setDetail('')} />}
  </View>;
}
