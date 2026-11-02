import type { Activity, Trip } from './travel.mjs';
export function titleParts(title: string): { parts: string[]; choice: boolean };
export function expandActivities(activities: Activity[]): Activity[];
export function expandTrip(trip: Trip): Trip;
