import { Button } from '@tarojs/components';
import type { MapPlace } from './domain/map-data.mjs';
import type { State } from './domain/travel.mjs';
import { samePlace } from './domain/saved-places.mjs';
import { store } from './stores/travel';

export function SavedPlaceButton({ place, city, state }: { place: MapPlace; city: string; state: State }) {
  const saved = (state.savedPlaces || []).some((item) => samePlace(item, place));
  const toggle = () => { try { store.toggleSavedPlace(place, city); } catch (e) { store.toast((e as Error).message); } };
  return <Button className='text-button' ariaLabel={`${saved ? '取消收藏' : '收藏'}地点：${place.name}`} onClick={toggle}>{saved ? '♥ 已收藏地点' : '♡ 收藏地点'}</Button>;
}
