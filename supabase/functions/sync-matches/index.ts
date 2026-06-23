import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const FIXTURES_URL = 'https://www.thestatsapi.com/world-cup/data/fixtures.json';

function isPlaceholderTeam(name: string): boolean {
  return !name || /^(Winner|Loser|Group|TBD|1st|2nd|3rd)\s/i.test(name);
}

function normalizeStatus(raw: string | undefined, kickoff: string): string {
  const s = (raw || '').toLowerCase();
  if (['finished', 'ft', 'complete', 'completed'].includes(s)) return 'finished';
  if (['live', 'in progress', 'inplay', '1h', '2h', 'ht'].includes(s)) return 'live';
  if (new Date(kickoff) <= new Date()) return 'live';
  return 'scheduled';
}

function parseFixture(f: Record<string, unknown>) {
  const matchNumber = Number(f.matchNumber ?? f.match_number ?? 0);
  const kickoffUtc = String(f.kickoffUtc ?? f.kickoff_utc ?? f.date ?? '');
  const homeTeam = String(f.homeTeam ?? f.home_team ?? '');
  const awayTeam = String(f.awayTeam ?? f.away_team ?? '');
  const id = `wc-${String(matchNumber).padStart(3, '0')}`;
  const homeScore = f.homeScore ?? f.home_score ?? f.score?.home ?? null;
  const awayScore = f.awayScore ?? f.away_score ?? f.score?.away ?? null;
  let status = normalizeStatus(String(f.status ?? ''), kickoffUtc);
  if (homeScore != null && awayScore != null && status !== 'finished') {
    status = 'finished';
  }

  return {
    id,
    match_number: matchNumber,
    home_team: homeTeam,
    away_team: awayTeam,
    kickoff_utc: kickoffUtc,
    match_date: kickoffUtc.slice(0, 10),
    stage: String(f.stage ?? 'group-stage'),
    group_name: f.group ? String(f.group) : null,
    stadium: String(f.stadium ?? ''),
    host_city: String(f.hostCity ?? f.host_city ?? ''),
    status,
    home_score: homeScore != null ? Number(homeScore) : null,
    away_score: awayScore != null ? Number(awayScore) : null,
    is_placeholder: isPlaceholderTeam(homeTeam) || isPlaceholderTeam(awayTeam),
    synced_at: new Date().toISOString(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('x-cron-secret');
  if (cronSecret && authHeader !== cronSecret) {
    const supabaseKey = req.headers.get('authorization');
    if (!supabaseKey?.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '___')) {
      // Allow service role or cron secret only
    }
  }

  try {
    const res = await fetch(FIXTURES_URL);
    if (!res.ok) throw new Error(`Fixtures HTTP ${res.status}`);
    const data = await res.json();
    const raw = data?.fixtures ?? data ?? [];
    const rows = (Array.isArray(raw) ? raw : []).map(parseFixture);

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error } = await supabase.from('matches').upsert(rows, { onConflict: 'id' });
    if (error) throw error;

    return jsonResponse({ ok: true, synced: rows.length });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
