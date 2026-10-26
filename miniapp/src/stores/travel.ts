import { useEffect, useState } from 'react';
import Taro, { useDidShow } from '@tarojs/taro';
import { createTravelStore } from '../domain/travel.mjs';
import type { Tab } from '../domain/travel.mjs';
import { createMiniController, createMiniFetch, createMiniStorage, validateMiniConnection } from '../services/wechat.mjs';
import { createChatClient } from '../services/chat-client.mjs';

const storage = createMiniStorage(Taro);
const fetch = createMiniFetch({ request: (options) => Taro.request(options) });
export const chatClient = createChatClient({ storage, fetch, connectSocket: (options) => Taro.connectSocket(options) });

export const store = createTravelStore(storage, {
  apiUrl: 'https://api.example.com',
  fetch,
  stream: chatClient.stream,
  demoStreaming: true,
  createAbortController: createMiniController,
  validateConnection: validateMiniConnection
});

const tabPaths: Record<Tab, string> = {
  assistant: '/pages/assistant/index', trips: '/pages/trips/index',
  favorites: '/pages/favorites/index', profile: '/pages/profile/index'
};

export function goTab(tab: Tab) {
  store.setTab(tab);
  void Taro.switchTab({ url: tabPaths[tab] }).catch(() => store.toast('页面暂时无法打开，请重试'));
}

export function sendQuery(query: string, retry = false) {
  if (!query.trim() || store.getState().busy) return;
  goTab('assistant');
  void store.sendMessage(query, retry);
}

export function useTravelState(tab: Tab) {
  const [state, setState] = useState(store.getState);
  useEffect(() => store.subscribe(setState), []);
  useDidShow(() => { store.setTab(tab); setState(store.getState()); });
  return state;
}
