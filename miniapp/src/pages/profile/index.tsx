import { useState } from 'react';
import { Text, View } from '@tarojs/components';
import { ConnectionSheet, PageHeading, PreferenceSheet, Toast } from '../../components';
import { goTab, useTravelState } from '../../stores/travel';
import { HistorySheet } from '../../chat-components';

export default function ProfilePage() {
  const state = useTravelState('profile');
  const [sheet, setSheet] = useState<'preferences' | 'connection' | 'history' | null>(null);
  const p = state.preferences;
  const row = (symbol: string, title: string, subtitle: string, action: () => void) => <View className='settings-row' onClick={action}><Text className='settings-symbol'>{symbol}</Text><View><Text>{title}</Text><Text className='muted'>{subtitle}</Text></View><Text className='settings-arrow'>›</Text></View>;
  const stats = [{ count: state.trips.length, label: '旅行计划' }, { count: state.savedPlaces.length, label: '收藏地点' }, { count: state.messages.filter((message) => message.role === 'user').length, label: '旅行对话' }];
  return <View className='page passport-page'>
    <Toast state={state} />
    <PageHeading en='04  /  TRAVEL DESK' title='我的旅行证' subtitle='旅行偏好与个人记录' />
    <View className='passport-cover'>
      <View className='passport-mast'><Text>ROAM</Text><Text>TRAVEL RECORD</Text></View>
      <View className='passport-id'><View><Text className='passport-name'>旅行者</Text><Text className='passport-origin'>{state.preferencesConfirmed ? `${p.origin}出发 · ${p.style}` : '旅行偏好待填写'}</Text></View><View className='passport-compass'>✥</View></View>
      <View className='passport-stats'>{stats.map((item) => <View key={item.label}><Text>{String(item.count).padStart(2, '0')}</Text><Text>{item.label}</Text></View>)}</View>
    </View>
    <View className='atlas-section'><Text>旅行档案</Text></View>
    <View className='settings-group'>
      {row('⌖', '我的旅行偏好', state.preferencesConfirmed ? `${p.travelers} 人同行 · ${p.style}` : '设置出发地、同行人数与预算', () => setSheet('preferences'))}
      {row('▱', '我的行程', '旅行清单与每日安排', () => goTab('trips'))}
      {row('♡', '我的收藏', '地点与目的地灵感', () => goTab('favorites'))}
    </View>
    <View className='atlas-section'><Text>助手设置</Text></View>
    <View className='settings-group'>
      {row('◷', '历史对话', '继续之前的旅行计划', () => setSheet('history'))}
      {row('↗', '旅行服务', state.connection.mode === 'demo' ? '灵感预览 · 示例模式' : `真实服务 · ${state.connection.apiUrl}`, () => setSheet('connection'))}
    </View>
    <Text className='note'>{state.connection.mode === 'demo' ? '当前使用示例内容。收藏、偏好和行程草稿保存在此设备。' : '对话会发送到你配置的后端。收藏、偏好和行程草稿保存在此设备。'}</Text>
    {sheet === 'preferences' && <PreferenceSheet kind='preferences' state={state} onClose={() => setSheet(null)} />}
    {sheet === 'connection' && <ConnectionSheet state={state} onClose={() => setSheet(null)} />}
    {sheet === 'history' && <HistorySheet state={state} onClose={() => setSheet(null)} />}
  </View>;
}
