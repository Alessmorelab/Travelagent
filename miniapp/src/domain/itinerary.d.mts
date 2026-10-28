import type { Activity } from './travel.mjs';
export type ParsedItinerary = { days: Activity[][]; notes: string; sourceText: string };
export function parseItinerary(text: string): ParsedItinerary | null;
