# Despliegue de Edge Functions (requiere Supabase CLI)

## 1. Crear proyecto en supabase.com (plan gratuito)

## 2. Ejecutar migraciones SQL
En el SQL Editor de Supabase, ejecuta en orden el contenido de cada archivo:

1. `supabase/migrations/001_initial.sql` — esquema base (perfiles, apuestas, etc.)
2. `supabase/migrations/003_match_odds.sql` — tabla de cuotas en vivo
3. `supabase/migrations/004_bankroll_10k.sql` — bankroll inicial €10.000 (histórico; omitir si partes de cero)
4. `supabase/migrations/005_bankroll_cop_1m.sql` — moneda COP, bankroll $1.000.000, borrado de apuestas previas
5. `supabase/migrations/006_app_config.sql` — tabla `app_config` para API keys del servidor

Si ya ejecutaste `001` antes, basta con aplicar `003`, `005` y `006`.

### Configurar TheStatsAPI en Supabase (recomendado)

Tras la migración `006`, guarda la clave en el SQL Editor (no en el código del cliente):

```sql
INSERT INTO public.app_config (key, value)
VALUES ('thestats_api_key', 'TU_CLAVE_THESTATSAPI')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, updated_at = now();
```

Para rotar la clave, ejecuta el mismo `UPDATE` con el nuevo valor.

## 3. Configurar secrets (opcional, alternativa a app_config)
```bash
supabase secrets set THESTATSAPI_KEY=xxx ODDS_API_KEY=xxx CRON_SECRET=xxx
```

La Edge Function `thestats-api` usa primero `app_config`, luego el secret `THESTATSAPI_KEY`.

## 4. Desplegar functions
```bash
supabase functions deploy sync-matches
supabase functions deploy settle-bets
supabase functions deploy compute-snapshots
supabase functions deploy thestats-api
```

## 5. Programar cron (SQL Editor, con pg_cron + pg_net habilitados)
Ver comentarios en `supabase/migrations/002_cron_notes.sql`.

## 6. Frontend
Copia `.env.example` a `.env` con `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
En Vercel, añade las mismas variables de entorno **o** deja `worldbet-ai/supabase.config.json` (clave pública anon) en el repo para que el build las inyecte automáticamente.
