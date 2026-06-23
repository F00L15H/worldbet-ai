import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { buildRecommendation } from '../_shared/prediction.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const now = new Date();
    const in48h = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const { data: matches, error } = await supabase
      .from('matches')
      .select('id, home_team, away_team, match_number, kickoff_utc, is_placeholder')
      .eq('is_placeholder', false)
      .in('status', ['scheduled', 'live'])
      .gte('kickoff_utc', now.toISOString())
      .lte('kickoff_utc', in48h.toISOString());

    if (error) throw error;

    let created = 0;
    for (const m of matches ?? []) {
      const recommendation = buildRecommendation(m.home_team, m.away_team, m.match_number ?? 1);
      const { error: insErr } = await supabase.from('prediction_snapshots').insert({
        match_id: m.id,
        recommendation,
        data_sources: ['Server cron (Poisson simplificado)'],
        computed_at: new Date().toISOString(),
      });
      if (!insErr) created++;
    }

    return jsonResponse({ ok: true, processed: matches?.length ?? 0, created });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
