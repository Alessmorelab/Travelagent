import { useEffect, useRef, useState } from 'react';
import Taro, { useDidHide, useShareAppMessage } from '@tarojs/taro';
import { Button, ScrollView, Text, View } from '@tarojs/components';
import { AGENTS, DESTINATIONS } from '../../domain/travel.mjs';
import { ConnectionSheet, DestinationCard, DestinationSheet, ModePill, PreferenceSheet, Sheet, Toast } from '../../components';
import { sendQuery, store, useTravelState } from '../../stores/travel';
import { ChatComposer, ChatMessage, HistorySheet } from '../../chat-components';

const starters = [
  { icon: '⌖', title: '规划武汉3天行程', query: '想去武汉玩3天，帮我安排一个不赶路的行程。' },
  { icon: '↗', title: '黄鹤楼到省博怎么走', query: '帮我查黄鹤楼和湖北省博物馆的位置，以及两地之间怎么走。' },
  { icon: '☀', title: '武汉明天适合出游吗', query: '武汉明天天气怎么样，适合出门玩吗？' }
];
type Panel = 'trip' | 'preferences' | 'connection' | 'history' | 'tools' | 'explore' | null;

export default function AssistantPage() {
  const state = useTravelState('assistant');
  const [draft, setDraft] = useState('');
  const [detail, setDetail] = useState('');
  const [panel, setPanel] = useState<Panel>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [anchor, setAnchor] = useState('');
  const [awayFromBottom, setAwayFromBottom] = useState(false);
  const following = useRef(true);
  const touching = useRef(false);
  const visibleHeight = useRef(400);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messages = state.messages.filter((message) => message.agent === state.agent);
  const last = messages.at(-1);
  const title = messages.find((message) => message.role === 'user')?.content || '新对话';
  const conversationId = state.activeChats[state.agent] || state.agent;

  useShareAppMessage(() => ({ title: '远行 AI · 一起聊聊你的下一站', path: '/pages/assistant/index' }));
  useDidHide(() => { setKeyboardHeight(0); });
  const scrollToLatest = () => {
    following.current = true; setAwayFromBottom(false); setAnchor('');
    Taro.nextTick(() => setAnchor('conversation-end'));
  };
  useEffect(() => {
    following.current = true; setAwayFromBottom(false);
  }, [conversationId]);
  useEffect(() => {
    if (!following.current || scrollTimer.current) return;
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = null;
      if (following.current) scrollToLatest();
    }, 80);
  }, [last?.id, last?.content.length, state.busy, keyboardHeight, conversationId]);
  useEffect(() => () => { if (scrollTimer.current) clearTimeout(scrollTimer.current); }, []);
  useEffect(() => {
    Taro.nextTick(() => {
      try {
        Taro.createSelectorQuery().select('#conversation-scroll').boundingClientRect((result) => {
          if (result && !Array.isArray(result)) visibleHeight.current = result.height;
        }).exec();
      } catch { /* Reading and manual scrolling remain available before measurement. */ }
    });
  }, [keyboardHeight, state.hydrated]);
  const openPanel = (next: Panel) => {
    void Taro.hideKeyboard().catch(() => {}); setKeyboardHeight(0); setPanel(next);
  };
  const send = (value = draft) => {
    if (!value.trim() || store.getState().busy) return;
    if (value.trim().length > 4000) { store.toast('消息最长4000字'); return; }
    scrollToLatest(); sendQuery(value); setDraft('');
  };
  const newChat = () => { store.newConversation('team'); setDraft(''); scrollToLatest(); };

  return <View className={`dialogue-page ${keyboardHeight ? 'keyboard-open' : ''}`} style={{ paddingBottom: `${keyboardHeight}px` }}>
    <View className='dialogue-header'>
      <Button className='dialogue-header-button' disabled={state.busy} onClick={() => openPanel('history')} ariaLabel='历史对话'>☰</Button>
      <View className='dialogue-heading'><Text className='dialogue-title'>{title}</Text>{state.agent !== 'team' && <Text className='dialogue-subtitle'>{AGENTS.find((agent) => agent.id === state.agent)?.label}</Text>}</View>
      <Button className='dialogue-header-button new-chat' disabled={state.busy} onClick={newChat} ariaLabel='新对话'>＋</Button>
    </View>
    <ScrollView id='conversation-scroll' className='conversation-scroll' scrollY enhanced scrollIntoView={anchor}
      scrollWithAnimation={false} lowerThreshold={80}
      onTouchStart={() => { touching.current = true; }} onTouchEnd={() => { touching.current = false; }} onTouchCancel={() => { touching.current = false; }}
      onScroll={(event) => {
        const nearBottom = event.detail.scrollHeight - event.detail.scrollTop - visibleHeight.current < 80;
        if (touching.current || nearBottom) { following.current = nearBottom; setAwayFromBottom(!nearBottom); }
      }} onScrollToLower={() => { following.current = true; setAwayFromBottom(false); }}>
      <View className='conversation-content'>
        {!state.hydrated ? <Text className='loading-text'>正在打开对话…</Text> : messages.length ? messages.map((message, index) =>
          <ChatMessage key={message.id} message={message} state={state} latest={index === messages.length - 1} />)
          : <View className='dialogue-welcome'>
            <View className='welcome-mark'>✦</View><Text className='dialogue-welcome-title'>下一站，想去哪儿？</Text>
            <Text className='dialogue-welcome-description'>说出你的想法，我们一起把旅行计划聊具体。</Text>
            <View className='conversation-starters'>{starters.map((item) => <Button className='conversation-starter' key={item.title} onClick={() => send(item.query)}><Text className='starter-symbol'>{item.icon}</Text><Text>{item.title}</Text><Text className='starter-arrow'>↗</Text></Button>)}</View>
            <Button className='inspiration-link' onClick={() => openPanel('explore')}>还没想好？找点旅行灵感 →</Button>
          </View>}
        {state.error && <View className='dialogue-error'><Text>{state.error}</Text><View className='dialogue-error-actions'>
          <Button onClick={() => { scrollToLatest(); sendQuery(state.lastQuery || '', true); }}>重试</Button>
          <Button onClick={() => openPanel('connection')}>检查连接</Button>
        </View></View>}
        <View id='conversation-end' className='conversation-end' />
      </View>
    </ScrollView>
    {awayFromBottom && <Button className='latest-message-button' onClick={scrollToLatest} ariaLabel='回到最新消息'>↓ 最新消息</Button>}
    <View className='dialogue-bottom'>
      <ChatComposer busy={state.busy} blocked={!!panel || !!detail || !state.hydrated} value={draft} onChange={setDraft}
        onSend={() => send()} onStop={() => store.cancelMessage()} onMore={() => openPanel('tools')} onKeyboardHeight={setKeyboardHeight} />
      <View className='dialogue-footer'><Button onClick={() => openPanel('connection')} ariaLabel='旅行服务设置'><ModePill state={state} /></Button></View>
    </View>
    {detail && <DestinationSheet id={detail} state={state} onClose={() => setDetail('')} />}
    {(panel === 'trip' || panel === 'preferences') && <PreferenceSheet kind={panel} state={state} onClose={() => setPanel(null)} />}
    {panel === 'connection' && <ConnectionSheet state={state} onClose={() => setPanel(null)} />}
    {panel === 'history' && <HistorySheet state={state} onClose={() => setPanel(null)} />}
    {panel === 'tools' && <Sheet title='旅行工具' onClose={() => setPanel(null)}><View className='chat-tool-menu'>
      <Button onClick={() => setPanel('preferences')}><Text>☷</Text><View><Text>旅行偏好</Text><Text>保存出发地、日期、人数和预算</Text></View><Text>›</Text></Button>
      <Button onClick={() => setPanel('trip')}><Text>＋</Text><View><Text>新建行程草稿</Text><Text>把想法整理成一段旅程</Text></View><Text>›</Text></Button>
      <Button onClick={() => setPanel('explore')}><Text>⌖</Text><View><Text>旅行灵感</Text><Text>看看值得出发的地方</Text></View><Text>›</Text></Button>
    </View></Sheet>}
    {panel === 'explore' && <Sheet title='给出发一点灵感' onClose={() => setPanel(null)}><View className='destination-grid'>{DESTINATIONS.map((destination) => <DestinationCard key={destination.id} destination={destination} state={state} onClick={() => { setPanel(null); setDetail(destination.id); }} />)}</View></Sheet>}
    <Toast state={state} />
  </View>;
}
