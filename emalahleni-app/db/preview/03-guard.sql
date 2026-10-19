-- Isolated dashboard preview bootstrap (3/4).
-- Mirror the staged departmental field guard. The preview worker has no UPDATE privilege.
CREATE OR REPLACE FUNCTION public.guard_dohs_application_fields()
RETURNS trigger LANGUAGE plpgsql AS $guard$
DECLARE actor text;
BEGIN
  IF NEW.dohs_complete IS DISTINCT FROM OLD.dohs_complete
     OR NEW.departmental_review_signed_at IS DISTINCT FROM OLD.departmental_review_signed_at
     OR NEW.departmental_review_signed_by IS DISTINCT FROM OLD.departmental_review_signed_by THEN
    actor := nullif(current_setting('app.actor_id', true), '');
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.project_memberships m
      WHERE m.project_id = OLD.project_id AND m.user_id = actor
        AND m.active AND m.role = 'DOHS_REVIEWER'
    ) THEN
      RAISE EXCEPTION 'Only an authorised DoHS reviewer may modify departmental application fields'
        USING ERRCODE = '42501';
    END IF;
    IF NEW.departmental_review_signed_by IS NOT NULL
       AND NEW.departmental_review_signed_by <> actor THEN
      RAISE EXCEPTION 'Departmental signature must identify the authenticated reviewer'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$guard$;

CREATE TRIGGER trg_guard_dohs_application_fields
BEFORE UPDATE ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.guard_dohs_application_fields();
