-- Audit S3, belt-and-braces behind RLS: the app never uses PostgREST (every
-- read goes through server actions on the table-owning `postgres` role), so
-- the browser-shipped anon key needs no table grants at all. Guarded so the
-- same migration is a no-op on PGlite (tests) and the CI pgvector service,
-- where the Supabase roles do not exist.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
  END IF;
END $$;
