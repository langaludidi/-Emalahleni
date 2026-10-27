-- SC-003 proposal: Smart Capture metadata-only import queue.
-- REVIEW BEFORE APPLYING. DO NOT RUN ON PRODUCTION OR THE EXISTING PREVIEW DB.
-- No scanned documents or extracted PII are stored in these tables.
-- No background worker credential / processor role is provisioned here.
BEGIN;

CREATE TABLE public.smart_capture_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  label text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  provider text NOT NULL DEFAULT 'GOOGLE_DRIVE' CHECK (provider = 'GOOGLE_DRIVE'),
  -- Actual Drive folder ID/credentials must be encrypted in separate restricted config.
  -- There is deliberately no public folder ID or credential column.
  enabled boolean NOT NULL DEFAULT false,
  created_by text NOT NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, id)
);

CREATE TABLE public.smart_capture_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  source_id uuid NOT NULL,
  provider_file_id text NOT NULL CHECK (length(provider_file_id) BETWEEN 10 AND 128),
  source_version text NOT NULL CHECK (length(source_version) BETWEEN 1 AND 128),
  -- Full PDF hash becomes available after controlled download. Do not trust Drive MD5 as proof.
  content_sha256 text CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  content_size_bytes bigint CHECK (content_size_bytes >= 0),
  state text NOT NULL DEFAULT 'DISCOVERED' CHECK (state IN (
    'DISCOVERED','QUEUED','FETCHING','QUARANTINED','SCANNING',
    'EXTRACTING','NEEDS_REVIEW','VERIFIED','COMMITTING','COMMIT_UNCERTAIN',
    'COMMITTED','REJECTED','FAILED'
  )),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  error_code text CHECK (error_code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  storage_key text,
  application_id uuid,
  claimed_at timestamptz,
  claimed_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT smart_capture_source_scope FOREIGN KEY (project_id, source_id)
    REFERENCES public.smart_capture_sources(project_id,id),
  CONSTRAINT smart_capture_app_scope FOREIGN KEY (project_id, application_id)
    REFERENCES public.applications(project_id,id),
  CONSTRAINT smart_capture_claim_pair CHECK (
    (claimed_at IS NULL) = (claimed_by IS NULL)
  ),
  CONSTRAINT smart_capture_committed_has_app CHECK (
    state <> 'COMMITTED' OR application_id IS NOT NULL
  ),
  CONSTRAINT smart_capture_unique_file_version
    UNIQUE (project_id, source_id, provider_file_id, source_version)
);
CREATE INDEX smart_capture_imports_project_state_idx
  ON public.smart_capture_imports (project_id, state, created_at DESC);
CREATE INDEX smart_capture_imports_claim_idx
  ON public.smart_capture_imports (state, claimed_at)
  WHERE state IN ('QUEUED','FETCHING','QUARANTINED','SCANNING','EXTRACTING','COMMITTING');

-- The same case must not be committed to multiple imports without a future,
-- explicitly reviewed exception workflow.
CREATE UNIQUE INDEX smart_capture_one_import_per_application
  ON public.smart_capture_imports (project_id, application_id)
  WHERE application_id IS NOT NULL;

-- FORCE RLS: the connection role must not accidentally bypass scoped reads.
ALTER TABLE public.smart_capture_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_capture_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE public.smart_capture_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.smart_capture_imports FORCE ROW LEVEL SECURITY;

-- The existing application uses LOCAL app.actor_id within Database.forActor().
-- Users may view import metadata only for projects they actively belong to.
CREATE POLICY smart_capture_sources_select ON public.smart_capture_sources
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.project_memberships m
    WHERE m.project_id = smart_capture_sources.project_id
      AND m.user_id = current_setting('app.actor_id', true)
      AND m.active
  ));
CREATE POLICY smart_capture_imports_select ON public.smart_capture_imports
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM public.project_memberships m
    WHERE m.project_id = smart_capture_imports.project_id
      AND m.user_id = current_setting('app.actor_id', true)
      AND m.active
  ));

-- Deliberately no INSERT / UPDATE / DELETE policies for HTTP users yet.
-- Worker mutation requires a dedicated, scoped, least-privilege role and
-- audited claim/transition functions, reviewed in SC-004.
-- Explicit grants are required before any application/worker can read.
COMMIT;
