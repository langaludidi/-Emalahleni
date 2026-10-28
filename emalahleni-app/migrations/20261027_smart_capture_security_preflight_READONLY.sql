-- SC-018 draft-only security preflight. READ-ONLY checks: run manually on an
-- isolated synthetic database after reviewed migrations, never on production.
-- Expected: zero rows for all three queries; failures block rollout.
SELECT 'missing_claim_token' AS finding
WHERE NOT EXISTS (
 SELECT 1 FROM information_schema.columns
 WHERE table_schema='public' AND table_name='smart_capture_imports'
  AND column_name='claim_token' AND data_type='uuid'
);
SELECT 'rls_not_forced' AS finding, c.relname
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('smart_capture_imports','smart_capture_sources','smart_capture_proposals')
 AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
SELECT 'unexpected_delete_grant' AS finding, table_name
FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name IN
 ('smart_capture_imports','smart_capture_sources','smart_capture_proposals')
 AND grantee='emalahleni_worker' AND privilege_type='DELETE';
