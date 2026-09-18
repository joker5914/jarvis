-- Data-only migration (no schema change): backfills a "credit_spent" ActivityLog row for every
-- Apollo-sourced email Contact row that already exists, so creditsUsed() — which now counts
-- ActivityLog rows with kind = 'credit_spent' instead of counting Contact rows directly (see
-- src/lib/enrichment/credits.ts) — doesn't suddenly read as "0 credits used this cycle" for spend
-- that happened before this migration. ActivityLog.id has no DB-level default (the Prisma schema
-- uses `@default(cuid())`, which Prisma generates in application code, not in Postgres), so an id
-- is generated here via gen_random_uuid()::text (built into Postgres 13+, no extension needed).
INSERT INTO "ActivityLog" (id, "ownerId", "businessId", kind, message, "createdAt")
SELECT gen_random_uuid()::text, "ownerId", "businessId", 'credit_spent', 'Apollo credit: email revealed', "createdAt"
FROM "Contact" c
WHERE c.source = 'apollo' AND c.type = 'email'
  -- Idempotent for a hand re-run: skip rows the ledger already holds for this business at this instant.
  AND NOT EXISTS (
    SELECT 1 FROM "ActivityLog" a
    WHERE a.kind = 'credit_spent' AND a."businessId" = c."businessId" AND a."createdAt" = c."createdAt"
  );
