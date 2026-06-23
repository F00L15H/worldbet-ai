# Despliegue de Edge Functions (requiere Supabase CLI)

## 1. Crear proyecto en supabase.com (plan gratuito)

## 2. Ejecutar migración SQL
Copia el contenido de `supabase/migrations/001_initial.sql` en el SQL Editor de Supabase.

## 3. Configurar secrets
```bash
supabase secrets set THESTATSAPI_KEY=xxx ODDS_API_KEY=xxx CRON_SECRET=xxx
```

## 4. Desplegar functions
```bash
supabase functions deploy sync-matches
supabase functions deploy settle-bets
supabase functions deploy compute-snapshots
```

## 5. Programar cron (SQL Editor, con pg_cron + pg_net habilitados)
Ver comentarios en `supabase/migrations/002_cron_notes.sql`.

## 6. Frontend
Copia `.env.example` a `.env` con `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
En Vercel, añade las mismas variables de entorno y ejecuta `node worldbet-ai/build.js`.
