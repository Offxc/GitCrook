-- Bound into every password-proof cookie so a password or audience change invalidates
-- the proofs already issued (previously they stayed valid for their full 7-day expiry).
ALTER TABLE "SitePassword" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
