-- A hostname used to be globally unique, so anyone could add a hostname they did not own
-- (it only had to be unverified) and the real owner would then be told "already in use".
-- Many sites may now claim a hostname; only one may hold it once it is verified.
DROP INDEX "CustomDomain_hostname_key";

CREATE INDEX "CustomDomain_hostname_idx" ON "CustomDomain"("hostname");

CREATE UNIQUE INDEX "CustomDomain_active_hostname_key" ON "CustomDomain"("hostname") WHERE "status" = 'ACTIVE';
