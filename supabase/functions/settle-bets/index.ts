import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import { settleBet, calcPayout } from '../_shared/settle-bet.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: pending, error: fetchErr } = await supabase
      .from('user_bets')
      .select(`
        id, user_id, market_type, market_label, odds, stake, status,
        matches!inner(id, home_team, away_team, home_score, away_score, status)
      `)
      .eq('status', 'pending');

    if (fetchErr) throw fetchErr;

    let settled = 0;
    for (const bet of pending ?? []) {
      const m = bet.matches as {
        home_team: string;
        away_team: string;
        home_score: number | null;
        away_score: number | null;
        status: string;
      };
      if (m.status !== 'finished' || m.home_score == null || m.away_score == null) continue;

      const result = settleBet(bet.market_type, bet.market_label, {
        homeTeam: m.home_team,
        awayTeam: m.away_team,
        homeScore: m.home_score,
        awayScore: m.away_score,
      });

      const payout = calcPayout(Number(bet.stake), Number(bet.odds), result);
      const newStatus = result;

      await supabase
        .from('user_bets')
        .update({ status: newStatus, payout, settled_at: new Date().toISOString() })
        .eq('id', bet.id);

      if (newStatus === 'won') {
        const returnAmount = Number(bet.stake) + payout;
        const { data: profile } = await supabase
          .from('profiles')
          .select('bankroll')
          .eq('id', bet.user_id)
          .single();
        if (profile) {
          await supabase
            .from('profiles')
            .update({ bankroll: Number(profile.bankroll) + returnAmount })
            .eq('id', bet.user_id);
        }
      } else if (newStatus === 'void') {
        const { data: profile } = await supabase.from('profiles').select('bankroll').eq('id', bet.user_id).single();
        if (profile) {
          await supabase.from('profiles').update({ bankroll: Number(profile.bankroll) + Number(bet.stake) }).eq('id', bet.user_id);
        }
      }

      settled++;
    }

    return jsonResponse({ ok: true, settled });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
