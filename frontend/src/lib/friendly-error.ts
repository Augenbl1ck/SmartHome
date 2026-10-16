const COPY = {
  weather: 'Wetter gerade nicht erreichbar.',
  calendar: 'Kalender gerade nicht erreichbar.',
  transit: 'Bahn gerade nicht erreichbar.',
  energy: 'Energie gerade nicht erreichbar.',
  spotify: 'Spotify gerade nicht erreichbar.',
} as const;

export function friendlyError(
  area: keyof typeof COPY,
  raw: string | null | undefined,
): string {
  const fallback = COPY[area];
  if (!raw) return fallback;
  const text = raw.trim();
  const low = text.toLowerCase();
  if (
    low.includes('sqlstate')
    || low.includes('failed to fetch')
    || low.includes('exception')
    || low.includes('select ')
    || low.includes('stack')
    || text.length > 140
  ) {
    return fallback;
  }
  return text;
}
