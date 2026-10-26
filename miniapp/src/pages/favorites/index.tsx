import { useState } from 'react';
import { Text, View, Button } from '@tarojs/components';
import { DESTINATIONS } from '../../domain/travel.mjs';
import { DestinationSheet, Empty, FavoriteButton, Filters, PageHeading, Scenic, Toast } from '../../components';
import { store, useTravelState } from '../../stores/travel';

export default function FavoritesPage() {
  const state = useTravelState('favorites');
  const [detail, setDetail] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const list = DESTINATIONS.filter((item) => (browsing || state.favorites.includes(item.id)) && (state.filter === '全部' || item.category === state.filter));
  const discover = () => { store.setFilter('全部'); setBrowsing(true); };
  return <View className='page'><PageHeading en={browsing ? 'YOUR NEXT CHAPTER' : 'PLACES TO KEEP'} title={browsing ? '下一站灵感' : '心动收藏'} subtitle={browsing ? '从这些地方开始，收藏下一次心动。' : `${state.favorites.length}个想去的地方，等一个出发的理由。`} />{browsing && <Button className='text-button' onClick={() => setBrowsing(false)}>← 返回收藏</Button>}<Filters state={state} />{list.length ? list.map((d) => <View className='favorite-card' key={d.id}><View className='favorite-photo-wrap'><View onClick={() => setDetail(d.id)}><Scenic destination={d} className='favorite-image' /></View><FavoriteButton destination={d} state={state} /></View><View className='favorite-copy'><View className='favorite-heading'><Text>{d.name}</Text><Text className='country'> / {d.country}</Text></View><Text className='destination-subtitle'>{d.subtitle}</Text><View className='favorite-footer'><Text>{d.days} · {d.category}</Text><Button className='text-button' onClick={() => setDetail(d.id)}>去看看 →</Button></View></View></View>) : <Empty icon='bookmark' title={state.favorites.length ? '这里，还没有收藏' : '把心动，留在这里'} description='收藏喜欢的目的地，给下一次出发一点方向。' action='发现目的地' onClick={discover} />}{detail && <DestinationSheet id={detail} state={state} onClose={() => setDetail('')} />}<Toast state={state} /></View>;
}
