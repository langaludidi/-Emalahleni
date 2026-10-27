-- SC-017: attempt-specific fencing. DRAFT; not applied to any database.
-- Apply only after reviewing the existing queue migration and restricted role grants.
BEGIN;
ALTER TABLE public.smart_capture_imports
 ADD COLUMN claim_token uuid;
-- This is a draft for a fresh, disabled Smart Capture installation only.
-- Do not apply while any import is claimed; existing claims must first be reconciled.
ALTER TABLE public.smart_capture_imports
 ADD CONSTRAINT smart_capture_claim_token_pair CHECK (
  (claimed_at IS NULL AND claimed_by IS NULL AND claim_token IS NULL)
  OR (claimed_at IS NOT NULL AND claimed_by IS NOT NULL AND claim_token IS NOT NULL)
 );
-- Existing active claims must be reconciled before applying this constraint.
-- The above CHECK is safe only if the queue is disabled and no active claims exist.
COMMIT;
