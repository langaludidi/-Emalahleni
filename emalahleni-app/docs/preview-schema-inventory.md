# Vectra Assure preview schema inventory

Generated from read-only Neon table descriptions of the existing staging branch. This is **not** an executable migration and contains **no beneficiary records**. RLS policies, grants, triggers, functions and extensions are not captured here and must be independently recovered before deployment.

Source project: `summer-cell-31554288`; branch: `br-withered-sun-za5qurkv`.
Target isolated preview: `noisy-pond-49029240` / `br-gentle-lab-zab9t10k` / `vectra_preview`.

## organisations

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| name | text | no | — |
| type | text | no | — |

### Constraints

- `organisations_pkey`: `PRIMARY KEY (id)`

### Indexes

- `CREATE UNIQUE INDEX organisations_pkey ON public.organisations USING btree (id)`

## users

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| id | text | no | — |
| display_name | text | yes | — |
| created_at | timestamp with time zone | no | now() |

### Constraints

- `users_pkey`: `PRIMARY KEY (id)`

### Indexes

- `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`

## projects

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| organisation_id | uuid | no | — |
| code | text | no | — |
| name | text | no | — |

### Constraints

- `projects_id_organisation_id_key`: `UNIQUE (id, organisation_id)`
- `projects_organisation_id_code_key`: `UNIQUE (organisation_id, code)`
- `projects_organisation_id_fkey`: `FOREIGN KEY (organisation_id) REFERENCES organisations(id)`
- `projects_pkey`: `PRIMARY KEY (id)`

### Indexes

- `CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id)`
- `CREATE UNIQUE INDEX projects_organisation_id_code_key ON public.projects USING btree (organisation_id, code)`
- `CREATE UNIQUE INDEX projects_id_organisation_id_key ON public.projects USING btree (id, organisation_id)`

## project_memberships

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| project_id | uuid | no | — |
| user_id | text | no | — |
| role | text | no | — |
| active | boolean | no | true |

### Constraints

- `project_memberships_pkey`: `PRIMARY KEY (project_id, user_id)`
- `project_memberships_project_id_fkey`: `FOREIGN KEY (project_id) REFERENCES projects(id)`
- `project_memberships_role_check`: `CHECK ((role = ANY (ARRAY['ADMIN'::text, 'OFFICER'::text, 'FIELD_OFFICER'::text, 'ASSESSOR'::text, 'DOHS_REVIEWER'::text, 'MANAGER'::text, 'AUDITOR'::text])))`
- `project_memberships_user_id_fkey`: `FOREIGN KEY (user_id) REFERENCES users(id)`

### Indexes

- `CREATE UNIQUE INDEX project_memberships_pkey ON public.project_memberships USING btree (project_id, user_id)`

## applications

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| organisation_id | uuid | no | — |
| project_id | uuid | no | — |
| reference | text | no | — |
| fields_ciphertext | text | no | — |
| version | integer | no | 0 |
| workflow_status | text | no | 'DRAFT'::text |
| dohs_complete | boolean | no | false |
| updated_at | timestamp with time zone | no | now() |
| submitted_at | timestamp with time zone | yes | — |
| identity_lookup | text | yes | — |
| departmental_review_signed_at | timestamp with time zone | yes | — |
| departmental_review_signed_by | text | yes | — |

### Constraints

- `applications_departmental_review_signed_by_fkey`: `FOREIGN KEY (departmental_review_signed_by) REFERENCES users(id)`
- `applications_pkey`: `PRIMARY KEY (id)`
- `applications_project_id_id_key`: `UNIQUE (project_id, id)`
- `applications_project_id_organisation_id_fkey`: `FOREIGN KEY (project_id, organisation_id) REFERENCES projects(id, organisation_id)`
- `applications_project_id_reference_key`: `UNIQUE (project_id, reference)`
- `applications_workflow_status_check`: `CHECK ((workflow_status = ANY (ARRAY['DRAFT'::text, 'SUBMITTED_FOR_ASSESSMENT'::text, 'RETURNED'::text, 'ASSESSMENT_COMPLETE'::text])))`
- `departmental_review_signature_consistency`: `CHECK (((departmental_review_signed_at IS NULL) = (departmental_review_signed_by IS NULL)))`
- `identity_lookup_format`: `CHECK (((identity_lookup IS NULL) OR (identity_lookup ~ '^[0-9a-f]{64}$'::text)))`

### Indexes

- `CREATE UNIQUE INDEX applications_pkey ON public.applications USING btree (id)`
- `CREATE UNIQUE INDEX applications_project_id_reference_key ON public.applications USING btree (project_id, reference)`
- `CREATE UNIQUE INDEX applications_project_id_id_key ON public.applications USING btree (project_id, id)`
- `CREATE UNIQUE INDEX applications_one_identity_per_project ON public.applications USING btree (project_id, identity_lookup) WHERE (identity_lookup IS NOT NULL)`

## evidence

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| id | uuid | no | gen_random_uuid() |
| project_id | uuid | no | — |
| application_id | uuid | no | — |
| kind | text | no | — |
| storage_key | text | no | — |
| filename | text | no | — |
| content_type | text | no | — |
| sha256 | text | yes | — |
| status | text | no | 'PENDING_UPLOAD'::text |
| malware_status | text | no | 'NOT_SCANNED'::text |
| uploaded_at | timestamp with time zone | yes | — |
| reviewed_at | timestamp with time zone | yes | — |
| reviewed_by | text | yes | — |
| document_date | date | yes | — |
| document_subtype | text | yes | — |
| review_notes | text | yes | — |
| effective_date | date | yes | — |
| expires_on | date | yes | — |
| certification_required | boolean | no | false |
| certification_acknowledged | boolean | no | false |
| certification_acknowledged_by | text | yes | — |
| certification_acknowledged_at | timestamp with time zone | yes | — |
| dependant_ordinal | smallint | yes | — |

### Constraints

- `certification_ack_consistency`: `CHECK ((((certification_acknowledged = false) AND (certification_acknowledged_by IS NULL) AND (certification_acknowledged_at IS NULL)) OR ((certification_acknowledged = true) AND (certification_acknowledged_by IS NOT NULL) AND (certification_acknowledged_at IS NOT NULL))))`
- `evidence_certification_acknowledged_by_fkey`: `FOREIGN KEY (certification_acknowledged_by) REFERENCES users(id)`
- `evidence_date_order`: `CHECK (((expires_on IS NULL) OR ((effective_date IS NOT NULL) AND (expires_on >= effective_date))))`
- `evidence_dependant_ordinal_consistency`: `CHECK (((dependant_ordinal IS NULL) OR ((kind = 'DEPENDANT_ID_OR_BIRTH_CERT'::text) AND (dependant_ordinal = ANY (ARRAY[1, 2])))))`
- `evidence_document_subtype_ck`: `CHECK (((document_subtype IS NULL) OR (document_subtype = ANY (ARRAY['SASSA_LETTER'::text, 'SASSA_STATEMENT'::text, 'BANK_STATEMENT'::text, 'PAYSLIP'::text, 'EMPLOYER_LETTER'::text, 'AFFIDAVIT'::text, 'ID_COPY'::text, 'BIRTH_CERTIFICATE'::text, 'MEDICAL_CERTIFICATE'::text, 'RESIDENCE_LETTER'::text, 'BUILDING_AGREEMENT'::text, 'DEED_OF_SALE'::text, 'OTHER'::text]))))`
- `evidence_malware_status_check`: `CHECK ((malware_status = ANY (ARRAY['NOT_SCANNED'::text, 'CLEAN'::text, 'INFECTED'::text, 'SCAN_FAILED'::text])))`
- `evidence_pkey`: `PRIMARY KEY (id)`
- `evidence_project_id_application_id_fkey`: `FOREIGN KEY (project_id, application_id) REFERENCES applications(project_id, id)`
- `evidence_project_id_unique`: `UNIQUE (project_id, application_id, id)`
- `evidence_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES users(id)`
- `evidence_status_check`: `CHECK ((status = ANY (ARRAY['PENDING_UPLOAD'::text, 'PENDING_SCAN'::text, 'PENDING_REVIEW'::text, 'VERIFIED'::text, 'REJECTED'::text])))`
- `evidence_storage_key_key`: `UNIQUE (storage_key)`

### Indexes

- `CREATE UNIQUE INDEX evidence_pkey ON public.evidence USING btree (id)`
- `CREATE UNIQUE INDEX evidence_storage_key_key ON public.evidence USING btree (storage_key)`
- `CREATE INDEX evidence_application_idx ON public.evidence USING btree (project_id, application_id, kind)`
- `CREATE INDEX evidence_expiring_idx ON public.evidence USING btree (project_id, expires_on) WHERE (expires_on IS NOT NULL)`
- `CREATE UNIQUE INDEX evidence_project_id_unique ON public.evidence USING btree (project_id, application_id, id)`

## dohs_section_reviews

### Columns

| Name | Type | Nullable | Default |
|---|---|---|---|
| project_id | uuid | no | — |
| application_id | uuid | no | — |
| section | text | no | — |
| state | text | no | — |
| note | text | no | — |
| reviewed_by | text | no | — |
| reviewed_at | timestamp with time zone | no | now() |

### Constraints

- `dohs_section_reviews_note_check`: `CHECK (((length(TRIM(BOTH FROM note)) >= 10) AND (length(TRIM(BOTH FROM note)) <= 500)))`
- `dohs_section_reviews_pkey`: `PRIMARY KEY (application_id, section)`
- `dohs_section_reviews_project_id_application_id_fkey`: `FOREIGN KEY (project_id, application_id) REFERENCES applications(project_id, id)`
- `dohs_section_reviews_reviewed_by_fkey`: `FOREIGN KEY (reviewed_by) REFERENCES users(id)`
- `dohs_section_reviews_section_check`: `CHECK ((section = ANY (ARRAY['PAGE_2'::text, 'PAGE_3'::text, 'SECTION_C'::text, 'SECTION_E'::text, 'SECTION_F'::text, 'SECTION_H'::text])))`
- `dohs_section_reviews_state_check`: `CHECK ((state = ANY (ARRAY['PENDING'::text, 'COMPLETE'::text, 'RETURNED'::text])))`

### Indexes

- `CREATE UNIQUE INDEX dohs_section_reviews_pkey ON public.dohs_section_reviews USING btree (application_id, section)`
