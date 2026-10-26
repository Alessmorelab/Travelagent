import type { PropsWithChildren } from 'react';
import { useLaunch } from '@tarojs/taro';
import { store } from './stores/travel';
import './app.scss';

export default function App({ children }: PropsWithChildren) {
  useLaunch(() => { void store.hydrate(); });
  return children;
}
