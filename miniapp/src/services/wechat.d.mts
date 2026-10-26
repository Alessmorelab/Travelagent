import type { Connection, TravelController, TravelFetch } from '../domain/travel.mjs';
export function createMiniController(): TravelController;
export function validateMiniConnection(value: Connection): Connection;
export function createMiniFetch(platform: { request(options: any): { abort(): void } }): TravelFetch;
export function createMiniStorage(platform: { getStorageSync(key: string): unknown; setStorageSync(key: string, value: string): void }): { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
