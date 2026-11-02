-- Metadata only: extracted personal information and OCR text are never persisted here.
-- Apply using the approved migration owner before enabling the new endpoint.
BEGIN;
CREATE TABLE IF NOT EXISTS public.evidence_consistency_findings (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id),
  application_id uuid NOT NULL REFERENCES public.applications(id),
  evidence_id uuid NOT NULL REFERENCES public.evidence(id),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  form_version integer NOT NULL CHECK (form_version >= 0),
  field text NOT NULL CHECK (field IN ('firstNames','surname','idNumber')),
  state text NOT NULL CHECK (state IN ('MATCH','MISMATCH','UNKNOWN','NOT_CHECKED')),
  method text NOT NULL CHECK (method = 'SCANNER_OCR_LABELLED_ID_V1'),
  recorded_by text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id,application_id,evidence_id,source_sha256,form_version,field)
);
CREATE INDEX IF NOT EXISTS evidence_consistency_case_idx ON public.evidence_consistency_findings(project_id,application_id,recorded_at DESC);
ALTER TABLE public.evidence_consistency_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence_consistency_findings FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='evidence_consistency_findings' AND policyname='evidence_consistency_member_read') THEN
  CREATE POLICY evidence_consistency_member_read ON public.evidence_consistency_findings FOR SELECT
   USING (EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=evidence_consistency_findings.project_id AND m.user_id=current_setting('app.actor_id',true) AND m.active));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='evidence_consistency_findings' AND policyname='evidence_consistency_writer_insert') THEN
  CREATE POLICY evidence_consistency_writer_insert ON public.evidence_consistency_findings FOR INSERT
   WITH CHECK (recorded_by=current_setting('app.actor_id',true)
     AND EXISTS (SELECT 1 FROM public.project_memberships m WHERE m.project_id=evidence_consistency_findings.project_id AND m.user_id=current_setting('app.actor_id',true) AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
     AND EXISTS (SELECT 1 FROM public.applications a WHERE a.id=evidence_consistency_findings.application_id AND a.project_id=evidence_consistency_findings.project_id AND a.version=evidence_consistency_findings.form_version)
     AND EXISTS (SELECT 1 FROM public.evidence e WHERE e.id=evidence_consistency_findings.evidence_id AND e.project_id=evidence_consistency_findings.project_id AND e.application_id=evidence_consistency_findings.application_id AND e.sha256=evidence_consistency_findings.source_sha256 AND e.malware_status='CLEAN'));
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='evidence_consistency_findings' AND policyname='evidence_consistency_migration_owner') THEN
  CREATE POLICY evidence_consistency_migration_owner ON public.evidence_consistency_findings TO neondb_owner USING (true) WITH CHECK (true);
 END IF;
END $$;
GRANT SELECT,INSERT ON public.evidence_consistency_findings TO emalahleni_worker;
COMMIT;
