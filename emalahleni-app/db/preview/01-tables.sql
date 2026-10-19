-- Vectra Assure: isolated DASHBOARD-ONLY preview bootstrap (1/4)
-- Run ONLY against a new, empty vectra_preview database in project noisy-pond-49029240.
-- Mirrors seven verified staging tables. NOT a substitute for the full application schema.
-- No applicant data or encryption credentials in this file.
-- Apply this file once; next apply 02-constraints.sql, 03-guard.sql, 04-access.sql.

CREATE TABLE public."organisations" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "name" text NOT NULL,
  "type" text NOT NULL
);

CREATE TABLE public."users" (
  "id" text NOT NULL,
  "display_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE public."projects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "code" text NOT NULL,
  "name" text NOT NULL
);

CREATE TABLE public."project_memberships" (
  "project_id" uuid NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL
);

CREATE TABLE public."applications" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "organisation_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "reference" text NOT NULL,
  "fields_ciphertext" text NOT NULL,
  "version" integer DEFAULT 0 NOT NULL,
  "workflow_status" text DEFAULT 'DRAFT'::text NOT NULL,
  "dohs_complete" boolean DEFAULT false NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "submitted_at" timestamp with time zone,
  "identity_lookup" text,
  "departmental_review_signed_at" timestamp with time zone,
  "departmental_review_signed_by" text
);

CREATE TABLE public."evidence" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "application_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "storage_key" text NOT NULL,
  "filename" text NOT NULL,
  "content_type" text NOT NULL,
  "sha256" text,
  "status" text DEFAULT 'PENDING_UPLOAD'::text NOT NULL,
  "malware_status" text DEFAULT 'NOT_SCANNED'::text NOT NULL,
  "uploaded_at" timestamp with time zone,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" text,
  "document_date" date,
  "document_subtype" text,
  "review_notes" text,
  "effective_date" date,
  "expires_on" date,
  "certification_required" boolean DEFAULT false NOT NULL,
  "certification_acknowledged" boolean DEFAULT false NOT NULL,
  "certification_acknowledged_by" text,
  "certification_acknowledged_at" timestamp with time zone,
  "dependant_ordinal" smallint
);

CREATE TABLE public."dohs_section_reviews" (
  "project_id" uuid NOT NULL,
  "application_id" uuid NOT NULL,
  "section" text NOT NULL,
  "state" text NOT NULL,
  "note" text NOT NULL,
  "reviewed_by" text NOT NULL,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
