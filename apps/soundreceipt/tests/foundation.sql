-- Disposable-only SoundReceipt foundation smoke test. Run after 0001_initial.sql.
-- All statements roll back; do not point this test at production data.
BEGIN;

DO $$
DECLARE table_total integer;
BEGIN
  SELECT count(*) INTO table_total
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'soundreceipt' AND c.relkind = 'r';
  IF table_total <> 17 THEN
    RAISE EXCEPTION 'expected 17 SoundReceipt tables, found %', table_total;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'soundreceipt' AND c.relkind = 'r'
      AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'one or more SoundReceipt tables do not FORCE RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'soundreceipt') THEN
    RAISE EXCEPTION 'foundation must not install permissive RLS policies';
  END IF;
END $$;

INSERT INTO soundreceipt.principals(id, auth_issuer, auth_subject)
VALUES
  ('00000000-0000-0000-0000-000000000001', 'https://auth.example.invalid', 'owner-a'),
  ('00000000-0000-0000-0000-000000000002', 'https://auth.example.invalid', 'owner-b');

INSERT INTO soundreceipt.workspaces(id, owner_principal_id, name)
VALUES
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-000000000001', 'Tenant A'),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-000000000002', 'Tenant B');

INSERT INTO soundreceipt.music_tracks(id, workspace_id, title, artist, created_by)
VALUES
  ('00000000-0000-0000-0000-000000000201', '00000000-0000-0000-0000-000000000101', 'A track', 'Artist A', '00000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-000000000202', '00000000-0000-0000-0000-000000000102', 'B track', 'Artist B', '00000000-0000-0000-0000-000000000002');

DO $$
BEGIN
  BEGIN
    INSERT INTO soundreceipt.licenses(workspace_id, track_id, created_by)
    VALUES ('00000000-0000-0000-0000-000000000101',
            '00000000-0000-0000-0000-000000000202',
            '00000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'cross-tenant license/track reference unexpectedly accepted';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL; -- Expected composite FK rejection.
  END;
END $$;

-- Run as the restricted principal, never as table owner/superuser.
CREATE ROLE soundreceipt_ci_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA soundreceipt TO soundreceipt_ci_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA soundreceipt TO soundreceipt_ci_app;
SET ROLE soundreceipt_ci_app;

DO $$
DECLARE visible integer;
BEGIN
  SELECT count(*) INTO visible FROM soundreceipt.principals;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'RLS leaked % principals to untrusted app role', visible;
  END IF;
  SELECT count(*) INTO visible FROM soundreceipt.music_tracks;
  IF visible <> 0 THEN
    RAISE EXCEPTION 'RLS leaked % tracks to untrusted app role', visible;
  END IF;
  BEGIN
    INSERT INTO soundreceipt.principals(auth_issuer, auth_subject)
    VALUES ('https://auth.example.invalid', 'forged-client');
    RAISE EXCEPTION 'untrusted app role inserted a principal without RLS policy';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL; -- Expected fail-closed INSERT rejection.
  END;
END $$;

RESET ROLE;
ROLLBACK;
