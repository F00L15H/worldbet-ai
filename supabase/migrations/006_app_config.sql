-- Configuración de servidor (API keys editables desde SQL Editor con rol service)
-- Sin políticas RLS: anon/authenticated no pueden leer; Edge Functions usan service_role.

CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_app_config_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_config_updated_at ON public.app_config;
CREATE TRIGGER app_config_updated_at
  BEFORE UPDATE ON public.app_config
  FOR EACH ROW EXECUTE FUNCTION public.set_app_config_updated_at();

INSERT INTO public.app_config (key, value)
VALUES ('thestats_api_key', '')
ON CONFLICT (key) DO NOTHING;
