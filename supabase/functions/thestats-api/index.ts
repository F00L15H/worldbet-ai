import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders, jsonResponse } from '../_shared/cors.ts';

const FIXTURES_URL = 'https://www.thestatsapi.com/world-cup/data/fixtures.json';
const THESTATSAPI_BASE = 'https://api.thestatsapi.com/api';

async function getTheStatsApiKey(supabase: ReturnType<typeof createClient>) {
  const { data } = await supabase
    .from('app_config')
    .select('value')
    .eq('key', 'thestats_api_key')
    .maybeSingle();
  const fromDb = data?.value?.trim();
  if (fromDb) return fromDb;
  return Deno.env.get('THESTATSAPI_KEY')?.trim() || '';
}

async function thestatsFetch(path: string, apiKey: string) {
  const res = await fetch(`${THESTATSAPI_BASE}${path}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`TheStatsAPI HTTP ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action || 'status');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const apiKey = await getTheStatsApiKey(supabase);

    if (action === 'status') {
      if (!apiKey) return jsonResponse({ configured: false, healthy: false });
      try {
        const d = await thestatsFetch('/health', apiKey);
        return jsonResponse({ configured: true, healthy: d?.status === 'healthy' });
      } catch {
        return jsonResponse({ configured: true, healthy: false });
      }
    }

    if (!apiKey) {
      return jsonResponse({ ok: false, error: 'TheStatsAPI key no configurada en app_config' }, 503);
    }

    if (action === 'fixtures') {
      const res = await fetch(FIXTURES_URL);
      if (!res.ok) throw new Error(`Fixtures HTTP ${res.status}`);
      const data = await res.json();
      return jsonResponse({ ok: true, fixtures: data?.fixtures ?? data ?? [] });
    }

    if (action === 'health') {
      const d = await thestatsFetch('/health', apiKey);
      return jsonResponse({ ok: true, status: d?.status ?? 'unknown' });
    }

    if (action === 'match-stats') {
      const matchId = String(body.matchId || '');
      if (!matchId) return jsonResponse({ ok: false, error: 'matchId requerido' }, 400);
      const data = await thestatsFetch(`/football/matches/${matchId}/stats`, apiKey);
      return jsonResponse({ ok: true, data });
    }

    return jsonResponse({ ok: false, error: `Acción desconocida: ${action}` }, 400);
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) }, 500);
  }
});
