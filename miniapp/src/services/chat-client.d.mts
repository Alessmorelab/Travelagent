import type { Agent, Message, StreamTransport, TravelFetch } from '../domain/travel.mjs';
export type RemoteConversation = { id: string; title: string; agent: Agent; updated: number; messages?: Message[] };
export function createChatClient(options: { fetch: TravelFetch; storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }; connectSocket(options: any): any }): {
  stream: StreamTransport;
  list(apiUrl: string, agent: Agent): Promise<RemoteConversation[]>;
  get(apiUrl: string, id: string): Promise<RemoteConversation & { messages: Message[] }>;
  delete(apiUrl: string, id: string): Promise<unknown>;
};
