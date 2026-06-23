-- Cuotas live sincronizadas desde Edge Function (The Odds API)

CREATE TABLE IF NOT EXISTS public.match_odds (
  match_id TEXT PRIMARY KEY REFERENCES public.matches(id) ON DELETE CASCADE,
  home_odds NUMERIC(8, 2),
  draw_odds NUMERIC(8, 2),
  away_odds NUMERIC(8, 2),
  over25_odds NUMERIC(8, 2),
  under25_odds NUMERIC(8, 2),
  bookmaker TEXT,
  previous JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_match_odds_updated ON public.match_odds(updated_at DESC);

ALTER TABLE public.match_odds ENABLE ROW LEVEL SECURITY;

CREATE POLICY match_odds_select_all ON public.match_odds FOR SELECT USING (true);

GRANT SELECT ON public.match_odds TO anon, authenticated;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.match_odds;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
