import type { Activity, Message } from './travel.mjs';
export type MapPlace = { name: string; address: string; latitude: number; longitude: number; coordinate_system: 'gcj02'; source: string; retrieved_at: string; uid?: string };
export type Itinerary = { schema_version: 1; destination: string; notes: string; days: Activity[][]; sourceText?: string };
export function validPoint(value: any): boolean;
export function validPlace(value: any): value is MapPlace;
export function readItinerary(value: any): Itinerary | null;
export function itineraryForMessage(value: Message): Itinerary | null;
export function dayFingerprint(day: Activity[]): string;
