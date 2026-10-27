-- SC-021: proposal write guards, synthetic-isolation candidate only.
-- Requires SC-003, SC-007 and SC-017. No production migration authorised.
BEGIN;
CREATE FUNCTION public.smart_capture_validate_proposal_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $sc$
DECLARE
 actor text := nullif(current_setting('app.actor_id',true),'');
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.schema_version<>1 OR NEW.review_version<>0 OR NEW.reviewed_by IS NOT NULL
   OR NEW.reviewed_at IS NOT NULL
   OR NOT EXISTS (
    SELECT 1 FROM public.smart_capture_imports i
    WHERE i.id=NEW.import_id AND i.project_id=NEW.project_id
     AND i.state='EXTRACTING' AND i.claimed_by=actor
     AND i.claim_token IS NOT NULL AND i.claimed_at IS NOT NULL
   ) THEN
   RAISE EXCEPTION 'SMART_CAPTURE_PROPOSAL_INSERT_DENIED' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.import_id IS DISTINCT FROM OLD.import_id
   OR NEW.project_id IS DISTINCT FROM OLD.project_id
   OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
   OR NEW.created_at IS DISTINCT FROM OLD.created_at
   OR NEW.review_version<>OLD.review_version+1
   OR NEW.reviewed_by IS DISTINCT FROM actor
   OR NEW.reviewed_at IS NULL
   OR NOT EXISTS (
    SELECT 1 FROM public.smart_capture_imports i
    WHERE i.id=NEW.import_id AND i.project_id=NEW.project_id
     AND i.state='NEEDS_REVIEW'
   ) THEN
   RAISE EXCEPTION 'SMART_CAPTURE_PROPOSAL_UPDATE_DENIED' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END
$sc$;
CREATE TRIGGER smart_capture_proposal_write_guard
BEFORE INSERT OR UPDATE ON public.smart_capture_proposals
FOR EACH ROW EXECUTE FUNCTION public.smart_capture_validate_proposal_write();
COMMIT;
