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
  const stats = [{ count: state.trips.length, label: '旅行计划' }, { count: state.favorites.length, label: '心动目的地' }, { count: state.messages.filter((message) => message.role === 'user').length, label: '旅行对话' }];
  return <View className='page'><PageHeading en='A LITTLE ABOUT YOU' title='我的' subtitle='让每一趟旅行，都更像你。' /><View className='profile-card'><View className='profile-avatar'>旅</View><View><Text className='profile-name'>你好，旅行者</Text><Text className='muted'>保持好奇，世界总有新的答案。</Text></View></View><View className='profile-stats'>{stats.map((item) => <View key={item.label}><Text>{String(item.count).padStart(2, '0')}</Text><Text>{item.label}</Text></View>)}</View><View className='settings-group'>{row('⌖', '我的旅行偏好', `${p.origin}出发 · ${p.travelers}人 · ${p.style}`, () => setSheet('preferences'))}{row('▱', '我的行程', '旅行清单与每日安排', () => goTab('trips'))}{row('♡', '我的收藏', '收集值得出发的地方', () => goTab('favorites'))}</View><View className='settings-group'>{row('◷', '历史对话', '重新打开之前的旅行想法', () => setSheet('history'))}{row('↗', '旅行服务', state.connection.mode === 'demo' ? '灵感预览 · 体验示例内容' : `真实服务 · ${state.connection.apiUrl}`, () => setSheet('connection'))}</View><Text className='note'>{state.connection.mode === 'demo' ? '你正在体验第一版。对话、预算和默认行程均为示例；收藏、偏好和行程草稿会保存在此设备。' : '对话会发送到你配置的后端；默认示例行程仍会保留明确标注。'}</Text><View className='profile-footer'><Text className='wordmark'>roam.</Text><Text>为心动出发，为自己停留。</Text><Text>远行 v0.1 · 微信小程序</Text></View>{sheet === 'preferences' && <PreferenceSheet kind='preferences' state={state} onClose={() => setSheet(null)} />}{sheet === 'connection' && <ConnectionSheet state={state} onClose={() => setSheet(null)} />}{sheet === 'history' && <HistorySheet state={state} onClose={() => setSheet(null)} />}<Toast state={state} /></View>;
}
