import type { Trip } from './travel.mjs';
export type TripDetails = Pick<Trip, 'title' | 'destination' | 'startDate' | 'travelers' | 'budget'> & { userNotes?: string };
export function tripEndDate(startDate: string, days: number): string;
export function validateTripDetails(value: any, days: number): TripDetails & { endDate: string };
export function formatTripText(trip: Trip): string;
