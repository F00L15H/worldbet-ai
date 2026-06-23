import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { parseOddsApiForMatch } from '../_shared/parse-odds.ts';

const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const apiKey = Deno.env.get('ODDS_API_KEY') || Deno.env.get('THE_ODDS_API_KEY');
  if (!apiKey) return jsonResponse({ ok: false, error: 'ODDS_API_KEY not set' }, 500);

  try {
    const url = `${ODDS_API_BASE}/sports/soccer_fifa_world_cup/odds?regions=eu&markets=h2h,totals&apiKey=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Odds API HTTP ${res.status}`);
    const events = await res.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: matches } = await supabase
      .from('matches')
      .select('id, home_team, away_team')
      .eq('is_placeholder', false);

    let updated = 0;
    for (const m of matches || []) {
      const parsed = parseOddsApiForMatch(events, m.home_team, m.away_team);
      if (!parsed) continue;

      const { data: existing } = await supabase
        .from('match_odds')
        .select('*')
        .eq('match_id', m.id)
        .maybeSingle();

      const previous = existing
        ? {
            home_odds: existing.home_odds,
            draw_odds: existing.draw_odds,
            away_odds: existing.away_odds,
            over25_odds: existing.over25_odds,
            under25_odds: existing.under25_odds,
            updated_at: existing.updated_at,
          }
        : null;

      const { error } = await supabase.from('match_odds').upsert({
        match_id: m.id,
        home_odds: parsed.home_odds,
        draw_odds: parsed.draw_odds,
        away_odds: parsed.away_odds,
        over25_odds: parsed.over25_odds,
        under25_odds: parsed.under25_odds,
        bookmaker: parsed.bookmaker,
        previous,
        updated_at: new Date().toISOString(),
      });
      if (!error) updated++;
    }

    return jsonResponse({ ok: true, updated, events: Array.isArray(events) ? events.length : 0 });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
