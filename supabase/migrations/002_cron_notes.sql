-- Cron jobs para Edge Functions (requiere extensión pg_net o invocación manual)
-- Ejecutar en Supabase SQL Editor después de desplegar las functions:

-- SELECT cron.schedule(
--   'sync-matches-hourly',
--   '0 * * * *',
--   $$ SELECT net.http_post(
--     url := 'https://YOUR_PROJECT.supabase.co/functions/v1/sync-matches',
--     headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
--   ) $$
-- );

-- SELECT cron.schedule(
--   'settle-bets-30min',
--   '*/30 * * * *',
--   $$ SELECT net.http_post(
--     url := 'https://YOUR_PROJECT.supabase.co/functions/v1/settle-bets',
--     headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
--   ) $$
-- );

-- SELECT cron.schedule(
--   'compute-snapshots-6h',
--   '0 */6 * * *',
--   $$ SELECT net.http_post(
--     url := 'https://YOUR_PROJECT.supabase.co/functions/v1/compute-snapshots',
--     headers := '{"Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
--   ) $$
-- );
