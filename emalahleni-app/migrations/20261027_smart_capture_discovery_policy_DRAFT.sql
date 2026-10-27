-- SC-004 metadata discovery insert policy.
-- DRAFT ONLY. Apply only alongside reviewed SC-003 schema, grants and UI/API.
-- Server must ensure source folder mapping and Drive auth; RLS does not establish Drive ownership.
BEGIN;
CREATE POLICY smart_capture_imports_insert ON public.smart_capture_imports
 FOR INSERT WITH CHECK (
  state='DISCOVERED'
  AND EXISTS (
   SELECT 1 FROM public.project_memberships m
   WHERE m.project_id=smart_capture_imports.project_id
    AND m.user_id=current_setting('app.actor_id',true)
    AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER')
  )
 );
-- No ordinary authenticated-actor UPDATE/DELETE permissions are introduced.
-- Dedicated job transitions should be performed by reviewed SECURITY DEFINER
-- procedures with checks for owner/claim lease and legal state transition.
COMMIT;
