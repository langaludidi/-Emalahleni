-- SC-020: DB defence-in-depth for the Smart Capture state machine.
-- DRAFT: only tested on synthetic, isolated Neon branch. No production rollout.
-- Database role-level WRITE access must still be replaced by audited transitions.
BEGIN;
CREATE FUNCTION public.smart_capture_validate_import_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $sc$
DECLARE
 actor text := nullif(current_setting('app.actor_id',true),'');
 active_before boolean;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'DISCOVERED' OR NEW.attempt_count<>0
   OR NEW.claimed_at IS NOT NULL OR NEW.claimed_by IS NOT NULL
   OR NEW.claim_token IS NOT NULL OR NEW.application_id IS NOT NULL THEN
   RAISE EXCEPTION 'SMART_CAPTURE_INVALID_INITIAL_STATE' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;

 IF NEW.id IS DISTINCT FROM OLD.id
  OR NEW.project_id IS DISTINCT FROM OLD.project_id
  OR NEW.source_id IS DISTINCT FROM OLD.source_id
  OR NEW.provider_folder_id IS DISTINCT FROM OLD.provider_folder_id
  OR NEW.provider_file_id IS DISTINCT FROM OLD.provider_file_id
  OR NEW.source_version IS DISTINCT FROM OLD.source_version THEN
  RAISE EXCEPTION 'SMART_CAPTURE_SOURCE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 IF NEW.state=OLD.state OR NEW.attempt_count<OLD.attempt_count THEN
  RAISE EXCEPTION 'SMART_CAPTURE_INVALID_STATE_TRANSITION' USING ERRCODE='23514';
 END IF;

 active_before := OLD.state IN ('FETCHING','QUARANTINED','SCANNING','EXTRACTING');
 IF active_before AND (
  OLD.claim_token IS NULL OR OLD.claimed_by IS NULL OR OLD.claimed_at IS NULL
 ) THEN
  RAISE EXCEPTION 'SMART_CAPTURE_INVALID_ACTIVE_CLAIM' USING ERRCODE='23514';
 END IF;

 IF OLD.state='DISCOVERED' THEN
  IF NEW.state<>'FETCHING' OR NEW.attempt_count<>OLD.attempt_count+1
   OR NEW.attempt_count>3 OR NEW.claim_token IS NULL
   OR NEW.claim_token IS NOT DISTINCT FROM OLD.claim_token
   OR NEW.claimed_by IS DISTINCT FROM actor OR NEW.claimed_at IS NULL
   OR NEW.error_code IS NOT NULL THEN
   RAISE EXCEPTION 'SMART_CAPTURE_INVALID_CLAIM' USING ERRCODE='23514';
  END IF;
 ELSIF OLD.state='FAILED' THEN
  IF NEW.state<>'DISCOVERED' OR OLD.attempt_count>=3
   OR OLD.error_code NOT IN (
    'DRIVE_FILE_UNAVAILABLE','DRIVE_BENEFICIARY_FOLDER_UNAVAILABLE',
    'DRIVE_DOWNLOAD_FAILED','SCANNER_UNAVAILABLE','DOCUMENT_AI_UNAVAILABLE',
    'DOCUMENT_AI_PROCESSING_FAILED','SMART_CAPTURE_PROCESSING_FAILED'
   ) OR NEW.error_code IS NOT NULL
   OR NEW.attempt_count<>OLD.attempt_count THEN
   RAISE EXCEPTION 'SMART_CAPTURE_RETRY_NOT_ALLOWED' USING ERRCODE='23514';
  END IF;
 ELSIF OLD.state='NEEDS_REVIEW' THEN
  IF NEW.state<>'COMMITTED' OR NEW.application_id IS NULL
   OR NEW.attempt_count<>OLD.attempt_count THEN
   RAISE EXCEPTION 'SMART_CAPTURE_INVALID_CONFIRMATION' USING ERRCODE='23514';
  END IF;
 ELSIF active_before THEN
  IF NEW.attempt_count<>OLD.attempt_count OR NOT (
   (OLD.state='FETCHING' AND NEW.state='QUARANTINED')
   OR (OLD.state='QUARANTINED' AND NEW.state='SCANNING')
   OR (OLD.state='SCANNING' AND NEW.state IN ('EXTRACTING','REJECTED'))
   OR (OLD.state='EXTRACTING' AND NEW.state='NEEDS_REVIEW')
   OR NEW.state='FAILED'
  ) THEN
   RAISE EXCEPTION 'SMART_CAPTURE_INVALID_STATE_TRANSITION' USING ERRCODE='23514';
  END IF;
  IF OLD.claimed_by IS DISTINCT FROM actor AND NOT (
   NEW.state='FAILED' AND NEW.error_code='STALE_CLAIM_REQUIRES_REVIEW'
   AND OLD.claimed_at<now()-interval '30 minutes'
   AND EXISTS (SELECT 1 FROM public.project_memberships m WHERE
    m.project_id=OLD.project_id AND m.user_id=actor AND m.active
    AND m.role IN ('ADMIN','MANAGER'))
  ) THEN
   RAISE EXCEPTION 'SMART_CAPTURE_CLAIM_ACTOR_MISMATCH' USING ERRCODE='23514';
  END IF;
 ELSE
  RAISE EXCEPTION 'SMART_CAPTURE_TERMINAL_STATE' USING ERRCODE='23514';
 END IF;

 IF NEW.state IN ('FETCHING','QUARANTINED','SCANNING','EXTRACTING') THEN
  IF NEW.claim_token IS NULL OR NEW.claimed_by IS NULL OR NEW.claimed_at IS NULL
   OR (active_before AND (NEW.claim_token IS DISTINCT FROM OLD.claim_token
    OR NEW.claimed_by IS DISTINCT FROM OLD.claimed_by
    OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at)) THEN
   RAISE EXCEPTION 'SMART_CAPTURE_CLAIM_FENCE_CHANGED' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.claim_token IS NOT NULL OR NEW.claimed_by IS NOT NULL OR NEW.claimed_at IS NOT NULL THEN
   RAISE EXCEPTION 'SMART_CAPTURE_CLAIM_NOT_RELEASED' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.state='QUARANTINED'
  AND (NEW.content_sha256 IS NULL OR NEW.storage_key IS NULL) THEN
  RAISE EXCEPTION 'SMART_CAPTURE_QUARANTINE_INCOMPLETE' USING ERRCODE='23514';
 END IF;
 IF NEW.state='FAILED' AND NEW.error_code IS NULL THEN
  RAISE EXCEPTION 'SMART_CAPTURE_FAILURE_CODE_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF NEW.state NOT IN ('FAILED','DISCOVERED') AND NEW.error_code IS DISTINCT FROM OLD.error_code THEN
  RAISE EXCEPTION 'SMART_CAPTURE_ERROR_MUTATION_DENIED' USING ERRCODE='23514';
 END IF;
 IF NEW.application_id IS DISTINCT FROM OLD.application_id AND NEW.state<>'COMMITTED' THEN
  RAISE EXCEPTION 'SMART_CAPTURE_APPLICATION_LINK_DENIED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END
$sc$;
CREATE TRIGGER smart_capture_import_transition_guard
BEFORE INSERT OR UPDATE ON public.smart_capture_imports
FOR EACH ROW EXECUTE FUNCTION public.smart_capture_validate_import_transition();
COMMIT;
