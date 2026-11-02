import type { MapPlace } from './map-data.mjs';
export type SavedPlace = MapPlace & { id: string; city: string; savedAt: number };
export function samePlace(left: Partial<MapPlace> | null | undefined, right: Partial<MapPlace> | null | undefined): boolean;
export function cleanSavedPlace(place: MapPlace, city?: string): MapPlace & { city: string };
export function readSavedPlaces(value: unknown): SavedPlace[];
