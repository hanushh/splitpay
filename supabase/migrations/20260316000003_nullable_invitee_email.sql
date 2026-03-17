-- Make invitee_email nullable to support phone-only contacts
-- who get an invite token without a known email address.
ALTER TABLE public.invitations ALTER COLUMN invitee_email DROP NOT NULL;
