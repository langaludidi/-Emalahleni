-- Isolated dashboard-only preview bootstrap (4/4): fail-closed roles and RLS.
-- IMPORTANT: Create worker roles with SQL below, NOT Neon create-role API (which assigned
-- elevated flags and neon_superuser membership in the observed preview project).
-- Apply after tables and constraints, to empty preview only.
-- This role has NOLOGIN; configure preview-only credentials only after acceptance.

CREATE ROLE vectra_preview_reader NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
CREATE ROLE emalahleni_worker NOLOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB NOBYPASSRLS;
GRANT vectra_preview_reader TO emalahleni_worker;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects FORCE ROW LEVEL SECURITY;
ALTER TABLE public.project_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence FORCE ROW LEVEL SECURITY;
ALTER TABLE public.dohs_section_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dohs_section_reviews FORCE ROW LEVEL SECURITY;

CREATE POLICY "migration_owner_applications" ON public."applications" AS PERMISSIVE FOR ALL TO vectra_preview_owner USING (true) WITH CHECK (true);

CREATE POLICY "scope_applications" ON public."applications" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = applications.project_id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active)))) WITH CHECK ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = applications.project_id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active))));

CREATE POLICY "migration_owner_dohs_section_reviews" ON public."dohs_section_reviews" AS PERMISSIVE FOR ALL TO vectra_preview_owner USING (true) WITH CHECK (true);

CREATE POLICY "scope_dohs_section_reviews" ON public."dohs_section_reviews" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = dohs_section_reviews.project_id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active)))) WITH CHECK ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = dohs_section_reviews.project_id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active))));

CREATE POLICY "migration_owner_evidence" ON public."evidence" AS PERMISSIVE FOR ALL TO vectra_preview_owner USING (true) WITH CHECK (true);

CREATE POLICY "scope_evidence" ON public."evidence" AS PERMISSIVE FOR ALL TO public USING ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = evidence.project_id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active)))) WITH CHECK ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = evidence.project_id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active))));

CREATE POLICY "membership_self" ON public."project_memberships" AS PERMISSIVE FOR SELECT TO public USING ((user_id = current_setting('app.actor_id'::text, true)));

CREATE POLICY "migration_owner_project_memberships" ON public."project_memberships" AS PERMISSIVE FOR ALL TO vectra_preview_owner USING (true) WITH CHECK (true);

CREATE POLICY "migration_owner_projects" ON public."projects" AS PERMISSIVE FOR ALL TO vectra_preview_owner USING (true) WITH CHECK (true);

CREATE POLICY "project_member_read" ON public."projects" AS PERMISSIVE FOR SELECT TO public USING ((EXISTS ( SELECT 1
   FROM project_memberships m
  WHERE ((m.project_id = projects.id) AND (m.user_id = current_setting('app.actor_id'::text, true)) AND m.active))));

GRANT USAGE ON SCHEMA public TO vectra_preview_reader;
GRANT SELECT ON TABLE public.projects, public.project_memberships, public.applications, public.evidence, public.dohs_section_reviews TO vectra_preview_reader;

-- Do not grant INSERT/UPDATE/DELETE to the preview worker. No application role may BYPASSRLS.
