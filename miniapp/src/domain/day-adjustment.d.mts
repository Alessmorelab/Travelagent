import type { Activity, Trip } from './travel.mjs';
import type { MapPlace } from './map-data.mjs';

type Fields = Pick<Activity, 'title' | 'time' | 'detail'>;
export type DayChange = Fields & { index: number };
export type DayAdjustmentUndo = { before: Activity[]; after: string };
export type DayAdjustmentRequest = { destination: string; day: number; date: string | null; instruction: string; targets: number[]; activities: (Fields & { protected: boolean })[] };
export const MAX_DAY_ACTIVITIES: number;
export const MAX_ADJUSTMENT_TARGETS: number;
export function isProtectedActivity(trip: Trip, day: number, index: number): boolean;
export function dayRevision(trip: Trip, day: number): string;
export function readDayAdjustmentUndo(trip: Trip): Record<number, DayAdjustmentUndo>;
export function makeDayAdjustmentRequest(trip: Trip, day: number, targets: number[], instruction: string): DayAdjustmentRequest;
export function readDayChanges(value: unknown, targets: number[]): DayChange[];
export function previewDayAdjustment(trip: Trip, day: number, targets: number[], changes: DayChange[], places?: Record<number, MapPlace>): Activity[];
export function comparableDayLegs(before: Activity[], after: Activity[]): { index: number; original: MapPlace[]; updated: MapPlace[] }[];
export function remapDayCompletion(completed: string[], day: number, newIndex: (index: number) => number | null): string[];
