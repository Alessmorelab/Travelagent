import { useState } from 'react';
import { Text, View, Button, Picker } from '@tarojs/components';
import { MAX_ACTIVITIES_PER_DAY } from './domain/travel.mjs';
import { tripEndDate } from './domain/trip-details.mjs';
import { samePlace } from './domain/saved-places.mjs';
import type { State, Trip } from './domain/travel.mjs';
import type { MapPlace } from './domain/map-data.mjs';
import { Sheet } from './components';

export function AddPlaceSheet({ place, state, preferredTrip, onChoose, onClose, onNoTrip }: {
  place: MapPlace; state: State; preferredTrip?: Trip;
  onChoose(tripId: string, day: number): void; onClose(): void; onNoTrip(): void;
}) {
  const trips = state.trips.filter((trip) => !trip.sample);
  const [tripId, setTripId] = useState((preferredTrip && !preferredTrip.sample ? preferredTrip.id : trips[0]?.id) || '');
  const [day, setDay] = useState(preferredTrip?.id === tripId ? state.activeDay : 0);
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
    try { onChoose(trip.id, selectedDay); }
    catch (e) { setError((e as Error).message); }
  };
  return <Sheet title='加入每日行程' folio='03  /  PLACE TRANSFER' onClose={onClose} footer={<>
    {error && <Text className='form-error'>{error}</Text>}
    {choice ? <Button className='primary-button' disabled={choice.full && !choice.existing} onClick={add}>
      {choice.existing ? `查看第 ${selectedDay + 1} 天的安排` : choice.full ? '当天已满，请另选日期' : `加入第 ${selectedDay + 1} 天`}
    </Button> : <Button className='primary-button' onClick={onNoTrip}>前往行程页</Button>}
  </>}>
    <View className='transfer-place'><Text className='folio-code'>选定地点{place.city ? `  /  ${place.city}` : ''}</Text>
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
