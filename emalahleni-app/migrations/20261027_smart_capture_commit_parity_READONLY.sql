-- SC-022: read-only runtime parity checks for Smart Capture confirmation.
-- Run on an explicitly selected test branch; never modifies data or permissions.
-- Zero findings required before claiming the isolated DB can test draft creation.
SELECT 'AUDIT_EVENTS_TABLE_MISSING' AS finding
WHERE to_regclass('public.audit_events') IS NULL
UNION ALL
SELECT 'APPLICATION_INSERT_GRANT_MISSING'
FROM pg_class c WHERE c.oid=to_regclass('public.applications')
 AND NOT has_table_privilege('emalahleni_worker',c.oid,'INSERT')
UNION ALL
SELECT 'AUDIT_EVENTS_INSERT_GRANT_MISSING'
FROM pg_class c WHERE c.oid=to_regclass('public.audit_events')
 AND NOT has_table_privilege('emalahleni_worker',c.oid,'INSERT')
UNION ALL
SELECT 'AUDIT_EVENTS_SELECT_GRANT_MISSING'
FROM pg_class c WHERE c.oid=to_regclass('public.audit_events')
 AND NOT has_table_privilege('emalahleni_worker',c.oid,'SELECT')
UNION ALL
SELECT 'WORKER_LOGIN_DISABLED'
FROM pg_roles r WHERE r.rolname='emalahleni_worker' AND NOT r.rolcanlogin
UNION ALL
SELECT 'WORKER_ROLE_MISSING'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='emalahleni_worker');
