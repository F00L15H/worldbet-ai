const TEAM_ALIASES: Record<string, string> = {
  usa: 'United States', 'united states': 'United States',
  'ir iran': 'IR Iran', iran: 'IR Iran',
  'korea republic': 'Korea Republic', 'south korea': 'Korea Republic',
};

function normalizeTeamName(name: string): string {
  if (!name) return '';
  const key = name.trim().toLowerCase();
  return TEAM_ALIASES[key] || name.trim();
}

function teamsMatch(a: string, b: string): boolean {
  return normalizeTeamName(a).toLowerCase() === normalizeTeamName(b).toLowerCase();
}

export function parseOddsApiForMatch(
  events: unknown[],
  homeTeam: string,
  awayTeam: string
) {
  if (!Array.isArray(events)) return null;
  const match = events.find(
    (e: { home_team?: string; away_team?: string }) =>
      teamsMatch(e.home_team || '', homeTeam) && teamsMatch(e.away_team || '', awayTeam)
  ) as {
    home_team?: string;
    away_team?: string;
    bookmakers?: Array<{ title?: string; markets?: Array<{ key?: string; outcomes?: Array<{ name?: string; price?: number; point?: number }> }> }>;
  } | undefined;
  if (!match) return null;

  const result = {
    bookmaker: '',
    home_odds: null as number | null,
    draw_odds: null as number | null,
    away_odds: null as number | null,
    over25_odds: null as number | null,
    under25_odds: null as number | null,
  };

  for (const bm of match.bookmakers || []) {
    const h2h = bm.markets?.find((m) => m.key === 'h2h');
    if (h2h) {
      const home = h2h.outcomes?.find((o) => teamsMatch(o.name || '', homeTeam));
      const away = h2h.outcomes?.find((o) => teamsMatch(o.name || '', awayTeam));
      const draw = h2h.outcomes?.find((o) => /draw|empate/i.test(o.name || ''));
      if (!result.home_odds && home?.price) {
        result.home_odds = home.price;
        result.draw_odds = draw?.price ?? null;
        result.away_odds = away?.price ?? null;
        result.bookmaker = bm.title || '';
      }
    }
    const totals = bm.markets?.find((m) => m.key === 'totals');
    if (totals) {
      const over = totals.outcomes?.find((o) => o.name === 'Over' && o.point === 2.5);
      const under = totals.outcomes?.find((o) => o.name === 'Under' && o.point === 2.5);
      if (over?.price) result.over25_odds = over.price;
      if (under?.price) result.under25_odds = under.price;
    }
  }

  return result.home_odds ? result : null;
}

export function fixtureIdFromMatchNumber(n: number): string {
  return `wc-${String(n).padStart(3, '0')}`;
}
