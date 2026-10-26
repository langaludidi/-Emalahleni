-- Additive: preserve existing decisions, audit events, files and scan results.
-- NULL legacy versions deliberately require a fresh human review.
BEGIN;
ALTER TABLE public.evidence ADD COLUMN IF NOT EXISTS reviewed_form_version integer CHECK (reviewed_form_version >= 0);
ALTER TABLE public.dohs_section_reviews ADD COLUMN IF NOT EXISTS reviewed_form_version integer CHECK (reviewed_form_version >= 0);
COMMIT;
