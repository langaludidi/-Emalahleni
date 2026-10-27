-- SC-007: encrypted extraction proposals and guarded capture transitions.
-- DRAFT: requires prior Smart Capture queue migration and security review.
BEGIN;
-- Needed for composite FK from encrypted proposal to import identity.
ALTER TABLE public.smart_capture_imports
 ADD CONSTRAINT smart_capture_imports_project_id_id_key UNIQUE (project_id,id);
CREATE TABLE public.smart_capture_proposals (
 import_id uuid PRIMARY KEY,
 project_id uuid NOT NULL,
 ciphertext text NOT NULL CHECK (length(ciphertext) BETWEEN 20 AND 350000),
 schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version=1),
 review_version integer NOT NULL DEFAULT 0 CHECK (review_version>=0),
 reviewed_by text REFERENCES public.users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY (project_id,import_id) REFERENCES public.smart_capture_imports(project_id,id)
);
-- Needed for composite FK from encrypted proposal to import identity.
-- Add uniqueness to protect project isolation.
ALTER TABLE public.smart_capture_imports
 ADD CONSTRAINT smart_capture_imports_project_id_id_key UNIQUE (project_id,id);
ALTER TABLE public.smart_capture_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_capture_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY sc_proposals_read ON public.smart_capture_proposals FOR SELECT USING (
 EXISTS (SELECT 1 FROM public.project_memberships m
  WHERE m.project_id=smart_capture_proposals.project_id
   AND m.user_id=current_setting('app.actor_id',true) AND m.active)
);
CREATE POLICY sc_proposals_insert ON public.smart_capture_proposals FOR INSERT WITH CHECK (
 EXISTS (SELECT 1 FROM public.project_memberships m
  WHERE m.project_id=smart_capture_proposals.project_id
   AND m.user_id=current_setting('app.actor_id',true)
   AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
);
-- Only approved server handlers may update state/ciphertext. Database role can
-- mutate project-scoped metadata; this does not grant permission to modify
-- VectraSA evidence or DoHS reviews.
CREATE POLICY sc_imports_update ON public.smart_capture_imports FOR UPDATE
 USING (EXISTS (SELECT 1 FROM public.project_memberships m WHERE
  m.project_id=smart_capture_imports.project_id
  AND m.user_id=current_setting('app.actor_id',true)
  AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER')))
 WITH CHECK (EXISTS (SELECT 1 FROM public.project_memberships m WHERE
  m.project_id=smart_capture_imports.project_id
  AND m.user_id=current_setting('app.actor_id',true)
  AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER')));
-- SQL privileges must be granted to the restricted runtime role by an
-- authorised migration operator, after reviewing role privileges.
COMMIT;
