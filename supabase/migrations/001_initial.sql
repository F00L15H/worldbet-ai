-- WorldBet AI — esquema inicial Mundial 2026

-- Perfiles de usuario (extiende auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  bankroll NUMERIC(12, 2) NOT NULL DEFAULT 1000 CHECK (bankroll >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partidos sincronizados desde TheStatsAPI
CREATE TABLE IF NOT EXISTS public.matches (
  id TEXT PRIMARY KEY,
  match_number INTEGER,
  home_team TEXT NOT NULL,
  away_team TEXT NOT NULL,
  kickoff_utc TIMESTAMPTZ NOT NULL,
  match_date DATE,
  stage TEXT,
  group_name TEXT,
  stadium TEXT,
  host_city TEXT,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'finished')),
  home_score INTEGER,
  away_score INTEGER,
  is_placeholder BOOLEAN NOT NULL DEFAULT false,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_kickoff ON public.matches(kickoff_utc);
CREATE INDEX IF NOT EXISTS idx_matches_status ON public.matches(status);

-- Snapshots de predicciones del modelo (historial)
CREATE TABLE IF NOT EXISTS public.prediction_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  recommendation JSONB NOT NULL,
  data_sources TEXT[] DEFAULT '{}',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_match ON public.prediction_snapshots(match_id, computed_at DESC);

-- Apuestas virtuales de usuarios
CREATE TABLE IF NOT EXISTS public.user_bets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  match_id TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  market_type TEXT NOT NULL,
  market_label TEXT NOT NULL,
  odds NUMERIC(8, 2) NOT NULL CHECK (odds > 1),
  stake NUMERIC(12, 2) NOT NULL CHECK (stake > 0),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'won', 'lost', 'void')),
  payout NUMERIC(12, 2) DEFAULT 0,
  snapshot_id UUID REFERENCES public.prediction_snapshots(id) ON DELETE SET NULL,
  placed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_bets_user ON public.user_bets(user_id, placed_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_bets_pending ON public.user_bets(status) WHERE status = 'pending';

-- Trigger: crear perfil al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, bankroll)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)),
    1000
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Actualizar updated_at en profiles
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Colocar apuesta: valida kickoff, bankroll y descuenta stake
CREATE OR REPLACE FUNCTION public.place_user_bet(
  p_match_id TEXT,
  p_market_type TEXT,
  p_market_label TEXT,
  p_odds NUMERIC,
  p_stake NUMERIC,
  p_snapshot_id UUID DEFAULT NULL
)
RETURNS public.user_bets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_match public.matches%ROWTYPE;
  v_bankroll NUMERIC;
  v_bet public.user_bets%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;

  SELECT * INTO v_match FROM public.matches WHERE id = p_match_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partido no encontrado';
  END IF;

  IF v_match.kickoff_utc <= now() THEN
    RAISE EXCEPTION 'El partido ya empezó o finalizó';
  END IF;

  IF v_match.status IN ('live', 'finished') THEN
    RAISE EXCEPTION 'No se pueden hacer apuestas en este partido';
  END IF;

  SELECT bankroll INTO v_bankroll FROM public.profiles WHERE id = v_user_id FOR UPDATE;
  IF v_bankroll IS NULL THEN
    RAISE EXCEPTION 'Perfil no encontrado';
  END IF;

  IF v_bankroll < p_stake THEN
    RAISE EXCEPTION 'Bankroll insuficiente';
  END IF;

  UPDATE public.profiles SET bankroll = bankroll - p_stake WHERE id = v_user_id;

  INSERT INTO public.user_bets (user_id, match_id, market_type, market_label, odds, stake, snapshot_id)
  VALUES (v_user_id, p_match_id, p_market_type, p_market_label, p_odds, p_stake, p_snapshot_id)
  RETURNING * INTO v_bet;

  RETURN v_bet;
END;
$$;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prediction_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_bets ENABLE ROW LEVEL SECURITY;

-- Profiles: solo el propio usuario
CREATE POLICY profiles_select_own ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY profiles_update_own ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Matches: lectura pública
CREATE POLICY matches_select_all ON public.matches FOR SELECT USING (true);

-- Snapshots: lectura pública, insert abierto (datos públicos del modelo)
CREATE POLICY snapshots_select_all ON public.prediction_snapshots FOR SELECT USING (true);
CREATE POLICY snapshots_insert_all ON public.prediction_snapshots FOR INSERT WITH CHECK (true);

-- Matches: sync desde cliente y edge functions
CREATE POLICY matches_insert_all ON public.matches FOR INSERT WITH CHECK (true);
CREATE POLICY matches_update_all ON public.matches FOR UPDATE USING (true);

-- User bets: solo el propio usuario
CREATE POLICY bets_select_own ON public.user_bets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY bets_insert_own ON public.user_bets FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Permitir a service_role gestionar todo (edge functions)
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON public.matches TO anon, authenticated;
GRANT INSERT, UPDATE ON public.matches TO anon, authenticated;
GRANT INSERT ON public.prediction_snapshots TO anon, authenticated;
GRANT SELECT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.user_bets TO authenticated;
GRANT EXECUTE ON FUNCTION public.place_user_bet TO authenticated;
