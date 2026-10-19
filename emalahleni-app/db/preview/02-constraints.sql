-- Isolated dashboard-only preview bootstrap (2/4): verified constraints and indexes.
-- Apply after 01-tables.sql and ONLY on a fresh, empty preview database.
-- Foreign keys follow unique keys. This script does not copy application rows.

ALTER TABLE public."organisations" ADD CONSTRAINT "organisations_pkey" PRIMARY KEY (id);

ALTER TABLE public."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);

ALTER TABLE public."projects" ADD CONSTRAINT "projects_id_organisation_id_key" UNIQUE (id, organisation_id);

ALTER TABLE public."projects" ADD CONSTRAINT "projects_organisation_id_code_key" UNIQUE (organisation_id, code);

ALTER TABLE public."projects" ADD CONSTRAINT "projects_pkey" PRIMARY KEY (id);

ALTER TABLE public."project_memberships" ADD CONSTRAINT "project_memberships_pkey" PRIMARY KEY (project_id, user_id);

ALTER TABLE public."project_memberships" ADD CONSTRAINT "project_memberships_role_check" CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OFFICER'::text, 'FIELD_OFFICER'::text, 'ASSESSOR'::text, 'DOHS_REVIEWER'::text, 'MANAGER'::text, 'AUDITOR'::text])));

ALTER TABLE public."applications" ADD CONSTRAINT "applications_pkey" PRIMARY KEY (id);

ALTER TABLE public."applications" ADD CONSTRAINT "applications_project_id_id_key" UNIQUE (project_id, id);

ALTER TABLE public."applications" ADD CONSTRAINT "applications_project_id_reference_key" UNIQUE (project_id, reference);

ALTER TABLE public."applications" ADD CONSTRAINT "applications_workflow_status_check" CHECK ((workflow_status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED_FOR_ASSESSMENT'::text, 'RETURNED'::text, 'ASSESSMENT_COMPLETE'::text])));

ALTER TABLE public."applications" ADD CONSTRAINT "departmental_review_signature_consistency" CHECK (((departmental_review_signed_at IS NULL) = (departmental_review_signed_by IS NULL)));

ALTER TABLE public."applications" ADD CONSTRAINT "identity_lookup_format" CHECK (((identity_lookup IS NULL) OR (identity_lookup ~ '^[0-9a-f]{64}$'::text)));

ALTER TABLE public."evidence" ADD CONSTRAINT "certification_ack_consistency" CHECK ((((certification_acknowledged = false) AND (certification_acknowledged_by IS NULL) AND (certification_acknowledged_at IS NULL)) OR ((certification_acknowledged = true) AND (certification_acknowledged_by IS NOT NULL) AND (certification_acknowledged_at IS NOT NULL))));

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_date_order" CHECK (((expires_on IS NULL) OR ((effective_date IS NOT NULL) AND (expires_on >= effective_date))));

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_dependant_ordinal_consistency" CHECK (((dependant_ordinal IS NULL) OR ((kind = 'DEPENDANT_ID_OR_BIRTH_CERT'::text) AND (dependant_ordinal = ANY (ARRAY[1, 2])))));

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_document_subtype_ck" CHECK (((document_subtype IS NULL) OR (document_subtype = ANY (ARRAY['SASSA_LETTER'::text, 'SASSA_STATEMENT'::text, 'BANK_STATEMENT'::text, 'PAYSLIP'::text, 'EMPLOYER_LETTER'::text, 'AFFIDAVIT'::text, 'ID_COPY'::text, 'BIRTH_CERTIFICATE'::text, 'MEDICAL_CERTIFICATE'::text, 'RESIDENCE_LETTER'::text, 'BUILDING_AGREEMENT'::text, 'DEED_OF_SALE'::text, 'OTHER'::text]))));

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_malware_status_check" CHECK ((malware_status = ANY (ARRAY['NOT_SCANNED'::text, 'CLEAN'::text, 'INFECTED'::text, 'SCAN_FAILED'::text])));

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_pkey" PRIMARY KEY (id);

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_project_id_unique" UNIQUE (project_id, application_id, id);

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_status_check" CHECK ((status = ANY (ARRAY['PENDING_UPLOAD'::text, 'PENDING_SCAN'::text, 'PENDING_REVIEW'::text, 'VERIFIED'::text, 'REJECTED'::text])));

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_storage_key_key" UNIQUE (storage_key);

ALTER TABLE public."dohs_section_reviews" ADD CONSTRAINT "dohs_section_reviews_note_check" CHECK (((length(TRIM(BOTH FROM note)) >= 10) AND (length(TRIM(BOTH FROM note)) <= 500)));

ALTER TABLE public."dohs_section_reviews" ADD CONSTRAINT "dohs_section_reviews_pkey" PRIMARY KEY (application_id, section);

ALTER TABLE public."dohs_section_reviews" ADD CONSTRAINT "dohs_section_reviews_section_check" CHECK ((section = ANY (ARRAY['PAGE_2'::text, 'PAGE_3'::text, 'SECTION_C'::text, 'SECTION_E'::text, 'SECTION_F'::text, 'SECTION_H'::text])));

ALTER TABLE public."dohs_section_reviews" ADD CONSTRAINT "dohs_section_reviews_state_check" CHECK ((state = ANY (ARRAY['PENDING'::text, 'COMPLETE'::text, 'RETURNED'::text])));

ALTER TABLE public."projects" ADD CONSTRAINT "projects_organisation_id_fkey" FOREIGN KEY (organisation_id) REFERENCES organisations(id);

ALTER TABLE public."project_memberships" ADD CONSTRAINT "project_memberships_project_id_fkey" FOREIGN KEY (project_id) REFERENCES projects(id);

ALTER TABLE public."project_memberships" ADD CONSTRAINT "project_memberships_user_id_fkey" FOREIGN KEY (user_id) REFERENCES users(id);

ALTER TABLE public."applications" ADD CONSTRAINT "applications_departmental_review_signed_by_fkey" FOREIGN KEY (departmental_review_signed_by) REFERENCES users(id);

ALTER TABLE public."applications" ADD CONSTRAINT "applications_project_id_organisation_id_fkey" FOREIGN KEY (project_id, organisation_id) REFERENCES projects(id, organisation_id);

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_certification_acknowledged_by_fkey" FOREIGN KEY (certification_acknowledged_by) REFERENCES users(id);

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_project_id_application_id_fkey" FOREIGN KEY (project_id, application_id) REFERENCES applications(project_id, id);

ALTER TABLE public."evidence" ADD CONSTRAINT "evidence_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id);

ALTER TABLE public."dohs_section_reviews" ADD CONSTRAINT "dohs_section_reviews_project_id_application_id_fkey" FOREIGN KEY (project_id, application_id) REFERENCES applications(project_id, id);

ALTER TABLE public."dohs_section_reviews" ADD CONSTRAINT "dohs_section_reviews_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES users(id);

CREATE UNIQUE INDEX applications_one_identity_per_project ON public.applications USING btree (project_id, identity_lookup) WHERE (identity_lookup IS NOT NULL);

CREATE INDEX evidence_application_idx ON public.evidence USING btree (project_id, application_id, kind);

CREATE INDEX evidence_expiring_idx ON public.evidence USING btree (project_id, expires_on) WHERE (expires_on IS NOT NULL);
