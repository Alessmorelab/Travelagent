import type { Agent, Message, StreamTransport, TravelFetch } from '../domain/travel.mjs';
export type RemoteConversation = { id: string; title: string; agent: Agent; updated: number; messages?: Message[] };
import type { QueryWarning, TravelSignal } from '../domain/travel.mjs';
import type { MapPlace } from '../domain/map-data.mjs';
import type { DayAdjustmentRequest, DayChange } from '../domain/day-adjustment.mjs';
export type RouteLeg = { index: number; failure?: QueryWarning; source?: string; retrieved_at?: string; points?: { latitude: number; longitude: number }[]; distance_m?: number; duration_seconds?: number };
export type MapResolution = { query: string; places: MapPlace[]; failure?: QueryWarning };
export type { MapPlace };
export type MapSearchResult = { source: string; retrieved_at: string; coordinate_system: 'gcj02'; places: MapPlace[] };
export function createChatClient(options: { fetch: TravelFetch; storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }; connectSocket(options: any): any; reconnectDelays?: number[]; heartbeatTimeout?: number }): {
  adjustDay(apiUrl: string, request: DayAdjustmentRequest, signal?: TravelSignal): Promise<DayChange[]>;
  searchPlaces(apiUrl: string, city: string, query: string): Promise<MapSearchResult>;
  resolvePlaces(apiUrl: string, city: string, queries: string[], signal?: TravelSignal): Promise<MapResolution[]>;
  routeDay(apiUrl: string, stops: MapPlace[], mode: string, segments?: number[], signal?: TravelSignal): Promise<RouteLeg[]>;
  stream: StreamTransport;
  list(apiUrl: string, agent: Agent): Promise<RemoteConversation[]>;
  get(apiUrl: string, id: string): Promise<RemoteConversation & { messages: Message[] }>;
  delete(apiUrl: string, id: string): Promise<unknown>;
};
