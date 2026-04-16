-- Xpense Supabase Hardening
-- Run in Supabase SQL Editor as a project owner.

begin;

-- 1) Enable + force RLS on known app tables.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY['users', 'entries', 'online_users', 'chat_messages', 'app_users', 'user_state'];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
      EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', t);
    END IF;
  END LOOP;
END $$;

-- 2) Block direct client access by default (anon/authenticated).
-- Backend service_role key bypasses RLS and keeps your API working.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, authenticated;

-- 3) Optional: keep schema visible for metadata browsing only.
GRANT USAGE ON SCHEMA public TO anon, authenticated;

commit;

-- Optional future section (only if you migrate to Supabase Auth):
-- create policy "entries owner read" on public.entries
--   for select to authenticated using (user_id = auth.uid());
-- create policy "entries owner write" on public.entries
--   for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
