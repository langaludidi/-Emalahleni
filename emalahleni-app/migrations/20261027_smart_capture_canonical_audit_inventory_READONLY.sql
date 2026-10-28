-- SC-I02: canonical audit/application privilege inventory (READ ONLY).
-- Intended for explicitly selected isolated Neon branch, never as a migration.
-- Inspect the result before writing any production-compatible DDL.
-- No beneficiary rows, ciphertext, names, identifiers or secrets are returned.

SELECT 'TABLE' AS category, n.nspname||'.'||c.relname AS object,
       jsonb_build_object('rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity) AS details
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind IN ('r','p')
 AND c.relname IN ('applications','audit_events','project_memberships','smart_capture_imports','smart_capture_proposals')
UNION ALL
SELECT 'COLUMN', table_schema||'.'||table_name||'.'||column_name,
       jsonb_build_object('type',data_type,'nullable',is_nullable,'default_present',column_default IS NOT NULL)
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN ('applications','audit_events')
UNION ALL
SELECT 'POLICY', schemaname||'.'||tablename||'.'||policyname,
       jsonb_build_object('command',cmd,'permissive',permissive,'roles',roles,
         'using',qual,'with_check',with_check)
FROM pg_policies
WHERE schemaname='public' AND tablename IN ('applications','audit_events')
UNION ALL
SELECT 'ROLE', rolname,
       jsonb_build_object('login',rolcanlogin,'bypass_rls',rolbypassrls,
         'inherit',rolinherit,'member_of_count',
         (SELECT count(*) FROM pg_auth_members am WHERE am.member=r.oid))
FROM pg_roles r WHERE rolname='emalahleni_worker'
ORDER BY category,object;

-- Privilege checks are intentionally separate to avoid reliance on a missing
-- table: to_regclass(...) returns NULL if the object is absent.
SELECT 'emalahleni_worker' AS role_name,
       to_regclass('public.applications') IS NOT NULL AS applications_present,
       CASE WHEN to_regclass('public.applications') IS NULL THEN NULL
         ELSE has_table_privilege('emalahleni_worker','public.applications','INSERT') END AS applications_insert,
       to_regclass('public.audit_events') IS NOT NULL AS audit_present,
       CASE WHEN to_regclass('public.audit_events') IS NULL THEN NULL
         ELSE has_table_privilege('emalahleni_worker','public.audit_events','INSERT') END AS audit_insert;
