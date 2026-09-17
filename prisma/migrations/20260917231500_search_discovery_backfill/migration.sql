-- Backfill: searches that an earlier build paused with "Discovery incomplete: Google daily
-- budget exhausted" had already saved/scored/scraped everything they fetched (see
-- runZipSearch). Under the new model they are complete with discovery still pending, so the
-- nightly continue-partial sweep (and the "Find more" button) can pick them up.
UPDATE "Search"
SET "status" = 'complete',
    "error" = NULL,
    "discoveryComplete" = false
WHERE "status" = 'paused'
  AND "progress" ->> 'message' LIKE 'Discovery incomplete: Google daily budget exhausted%';
