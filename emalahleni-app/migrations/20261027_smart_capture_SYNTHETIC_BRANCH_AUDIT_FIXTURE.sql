-- SC-030: ISOLATED SYNTHETIC NEON BRANCH ONLY.
-- This test fixture restores the application/audit SQL contract missing from
-- preview. It is NOT a canonical production migration and must never be
-- applied to production or the default preview branch.
-- Branch: br-proud-union-zaded8kk, project noisy-pond-49029240.
BEGIN;
CREATE TABLE public.audit_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES public.projects(id),
 actor_id text NOT NULL REFERENCES public.users(id),
 action text NOT NULL CHECK (length(action) BETWEEN 1 AND 80),
 metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY sc030_audit_read ON public.audit_events FOR SELECT TO emalahleni_worker
 USING (EXISTS (SELECT 1 FROM public.project_memberships m WHERE
 m.project_id=audit_events.project_id AND m.user_id=current_setting('app.actor_id',true)
 AND m.active AND m.role IN ('ADMIN','MANAGER','AUDITOR')));

CREATE POLICY sc030_audit_insert ON public.audit_events FOR INSERT TO emalahleni_worker
 WITH CHECK (
 actor_id=current_setting('app.actor_id',true)
 AND action='DRAFT_CREATED'
 AND EXISTS (SELECT 1 FROM public.project_memberships m WHERE
 m.project_id=audit_events.project_id AND m.user_id=current_setting('app.actor_id',true)
 AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
);
GRANT SELECT,INSERT ON public.audit_events TO emalahleni_worker;

-- Granting INSERT would expose the existing broad applications RLS INSERT
-- policy. This RESTRICTIVE policy adds a role check for the restricted role,
-- including direct SQL access, without modifying the existing policy.
CREATE POLICY sc030_case_writer_insert ON public.applications
 AS RESTRICTIVE FOR INSERT TO emalahleni_worker
 WITH CHECK (
 workflow_status='DRAFT' AND dohs_complete=false
 AND EXISTS (SELECT 1 FROM public.project_memberships m WHERE
 m.project_id=applications.project_id
 AND m.user_id=current_setting('app.actor_id',true)
 AND m.active AND m.role IN ('ADMIN','OFFICER','FIELD_OFFICER','ASSESSOR','MANAGER'))
);
GRANT INSERT ON public.applications TO emalahleni_worker;
COMMIT;
