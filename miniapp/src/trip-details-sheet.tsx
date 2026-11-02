import { useState } from 'react';
import { Button, Input, Picker, Text, Textarea, View } from '@tarojs/components';
import type { Trip } from './domain/travel.mjs';
import { tripEndDate } from './domain/trip-details.mjs';
import { Sheet } from './components';
import { store } from './stores/travel';

export function TripDetailsSheet({ trip, onClose }: { trip: Trip; onClose(): void }) {
  const [form, setForm] = useState({ title: trip.title, destination: trip.destination, startDate: trip.startDate,
    travelers: trip.travelers ? String(trip.travelers) : '', budget: trip.budget ? String(trip.budget) : '', userNotes: trip.userNotes || '' });
  const [error, setError] = useState('');
  let endDate = '';
  try { endDate = tripEndDate(form.startDate, trip.days.length); } catch {}
  const save = () => {
    try { store.saveTripDetails(trip.id, { ...form, travelers: Number(form.travelers), budget: Number(form.budget) }); onClose(); }
    catch (e) { setError((e as Error).message); }
  };
  return <Sheet title='编辑行程信息' onClose={onClose}>
    <Text className='sheet-description'>保留现有 {trip.days.length} 天安排，选择出发日期后自动计算返程日期。人数和预算暂不确定可以留空。</Text>
    <View className='form-field'><Text className='field-label'>行程名称</Text><Input className='form-input' value={form.title} maxlength={80} onInput={(e) => setForm({ ...form, title: e.detail.value })} /></View>
    <View className='form-field'><Text className='field-label'>目的地</Text><Input className='form-input' value={form.destination} maxlength={60} onInput={(e) => setForm({ ...form, destination: e.detail.value })} /></View>
    {form.destination.trim() !== trip.destination && <Text className='note'>更换目的地会清除已确认的地点绑定，之后需重新查询确认。</Text>}
    <View className='form-row'><View className='form-field'><Text className='field-label'>出发日期</Text><Picker mode='date' value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.detail.value })}><View className='form-input date-value'>{form.startDate || '选择出发日期'}<Text>⌄</Text></View></Picker></View>
      <View className='form-field'><Text className='field-label'>返程日期</Text><View className='form-input'>{endDate || '日期待定'}</View></View></View>
    {!!form.startDate && <Button className='text-button' onClick={() => setForm({ ...form, startDate: '' })}>日期暂不确定</Button>}
    {form.startDate !== trip.startDate && <Text className='note'>原回复和查询依据会保留，天气、预约和开放信息需按新日期重新确认。</Text>}
    <View className='form-row'><View className='form-field'><Text className='field-label'>同行人数</Text><Input className='form-input' value={form.travelers} type='number' maxlength={2} placeholder='选填' onInput={(e) => setForm({ ...form, travelers: e.detail.value })} /></View>
      <View className='form-field'><Text className='field-label'>计划总预算 / 人民币</Text><Input className='form-input' value={form.budget} type='digit' maxlength={12} placeholder='选填' onInput={(e) => setForm({ ...form, budget: e.detail.value })} /></View></View>
    <View className='form-field'><Text className='field-label'>出行备注</Text><Textarea className='form-input trip-note-input' value={form.userNotes} maxlength={2000} placeholder='例如集合安排、同行人的需要' onInput={(e) => setForm({ ...form, userNotes: e.detail.value })} /></View>
    {error && <Text className='form-error'>{error}</Text>}
    <Button className='primary-button' onClick={save}>保存行程信息</Button>
  </Sheet>;
}
