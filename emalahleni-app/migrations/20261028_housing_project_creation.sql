-- Housing projects remain isolated by the existing project membership policies.
BEGIN;
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS client_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS location text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_by text REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Creating projects is an explicit organisation capability, separate from case roles.
CREATE TABLE IF NOT EXISTS public.project_creators (
  organisation_id uuid NOT NULL REFERENCES public.organisations(id),
  user_id text NOT NULL REFERENCES public.users(id),
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organisation_id,user_id)
);
ALTER TABLE public.project_creators ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_creators FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_creators' AND policyname='project_creator_self') THEN
    CREATE POLICY project_creator_self ON public.project_creators FOR SELECT
      USING (user_id=current_setting('app.actor_id',true) AND active);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='project_creators' AND policyname='migration_owner_project_creators') THEN
    CREATE POLICY migration_owner_project_creators ON public.project_creators TO neondb_owner
      USING (true) WITH CHECK (true);
  END IF;
END $$;
GRANT SELECT ON public.project_creators TO emalahleni_worker;

CREATE OR REPLACE FUNCTION public.project_creation_options()
RETURNS TABLE(id uuid,name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$
  SELECT o.id,o.name FROM public.organisations o
  JOIN public.project_creators c ON c.organisation_id=o.id
  WHERE c.user_id=current_setting('app.actor_id',true) AND c.active
  ORDER BY o.name,o.id
$$;

CREATE OR REPLACE FUNCTION public.create_housing_project(
  p_id uuid,p_organisation_id uuid,p_code text,p_name text,p_client_name text,p_location text
)
RETURNS TABLE(id uuid,code text,name text,role text,client_name text,location text,created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$
DECLARE
  actor text := nullif(current_setting('app.actor_id',true),'');
  project_code text := upper(btrim(coalesce(p_code,'')));
  project_name text := btrim(coalesce(p_name,''));
  client text := btrim(coalesce(p_client_name,''));
  place text := btrim(coalesce(p_location,''));
BEGIN
  PERFORM 1 FROM public.project_creators c
    WHERE c.organisation_id=p_organisation_id AND c.user_id=actor AND c.active FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROJECT_CREATION_DENIED' USING ERRCODE='42501';
  END IF;
  IF p_id IS NULL OR project_code !~ '^[A-Z][A-Z0-9_-]{2,39}$'
    OR char_length(project_name) NOT BETWEEN 2 AND 120
    OR char_length(client)>160 OR char_length(place)>160 THEN
    RAISE EXCEPTION 'INVALID_PROJECT_DETAILS' USING ERRCODE='22023';
  END IF;

  INSERT INTO public.projects(id,organisation_id,code,name,client_name,location,created_by)
    VALUES(p_id,p_organisation_id,project_code,project_name,client,place,actor)
    ON CONFLICT DO NOTHING;
  IF FOUND THEN
    INSERT INTO public.project_memberships(project_id,user_id,role,active)
      VALUES(p_id,actor,'ADMIN',true);
    INSERT INTO public.audit_events(project_id,actor_id,action,metadata)
      VALUES(p_id,actor,'PROJECT_CREATED',jsonb_build_object('projectCode',project_code,'type','HOUSING','requestId',p_id));
    RETURN QUERY SELECT p.id,p.code,p.name,m.role,p.client_name,p.location,true
      FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id
      WHERE p.id=p_id AND m.user_id=actor;
    RETURN;
  END IF;

  -- Repeating the same request returns the original project without extra grants/audits.
  RETURN QUERY SELECT p.id,p.code,p.name,m.role,p.client_name,p.location,false
    FROM public.projects p JOIN public.project_memberships m ON m.project_id=p.id
    WHERE p.id=p_id AND p.organisation_id=p_organisation_id AND p.created_by=actor
      AND p.code=project_code AND p.name=project_name AND p.client_name=client AND p.location=place
      AND m.user_id=actor AND m.active;
  IF FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.projects p WHERE p.id=p_id) THEN
    RAISE EXCEPTION 'PROJECT_REQUEST_CONFLICT' USING ERRCODE='P0001';
  END IF;
  RAISE EXCEPTION 'PROJECT_CODE_EXISTS' USING ERRCODE='23505';
END $$;

REVOKE ALL ON FUNCTION public.project_creation_options() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_housing_project(uuid,uuid,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.project_creation_options() TO emalahleni_worker;
GRANT EXECUTE ON FUNCTION public.create_housing_project(uuid,uuid,text,text,text,text) TO emalahleni_worker;
COMMIT;
