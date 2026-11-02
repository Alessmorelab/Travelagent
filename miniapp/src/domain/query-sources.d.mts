export type QueryFact = { kind: string; value: string; unit: string; field: string; subject: string; date: string };
export type QuerySource = { id: string; label: string; source: string; retrieved_at: string; received_at: string; query: string; excerpt: string; facts: QueryFact[] };
export function readSources(value: unknown): QuerySource[];
