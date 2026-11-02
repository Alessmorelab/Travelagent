const kinds = new Set(['price', 'distance', 'duration', 'rating', 'exit', 'transit', 'hours', 'weather']);
export function readSources(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).filter((item) => item && /^E[1-9]\d?$/.test(item.id)
    && typeof item.label === 'string' && typeof item.source === 'string' && typeof item.facts?.slice === 'function' && Array.isArray(item.facts))
    .map((item) => ({ id: item.id, label: item.label.slice(0, 80), source: item.source.slice(0, 100),
      retrieved_at: typeof item.retrieved_at === 'string' ? item.retrieved_at.slice(0, 80) : '',
      received_at: typeof item.received_at === 'string' ? item.received_at.slice(0, 80) : '',
      query: typeof item.query === 'string' ? item.query.slice(0, 120) : '',
      excerpt: typeof item.excerpt === 'string' ? item.excerpt.slice(0, 1600) : '',
      facts: item.facts.slice(0, 48).filter((fact) => fact && kinds.has(fact.kind) && typeof fact.value === 'string')
        .map((fact) => ({ kind: fact.kind, value: fact.value.slice(0, 180),
          unit: String(fact.unit || '').slice(0, 20), field: String(fact.field || '').slice(0, 140),
          subject: String(fact.subject || '').slice(0, 100), date: String(fact.date || '').slice(0, 30) })) }));
}
