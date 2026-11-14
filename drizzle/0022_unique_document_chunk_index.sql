-- Audit D2: two concurrent ingests of one document could each write a full
-- chunk set (probe: 12 rows, chunk_count 6). The unique index below stops that,
-- but production may already hold such duplicates, and CREATE UNIQUE INDEX would
-- fail on them. So, in this order (one transaction, like every migration run):
--   0. lock document_chunks against writes,
--   1. repair chunk_count for the documents that have duplicates,
--   2. delete the duplicates, keeping one row per (document_id, chunk_index):
--      a row with an embedding over one without, then the lowest id,
--   3. create the unique index.
-- Documents without duplicates are not touched. The SHARE ROW EXCLUSIVE lock is
-- taken first and held to the end of the transaction: it blocks chunk writes
-- (a concurrent ingest by the old code) between the DELETE and the index build,
-- while reads, i.e. retrieval, carry on.
LOCK TABLE "document_chunks" IN SHARE ROW EXCLUSIVE MODE;--> statement-breakpoint
UPDATE "documents" d
SET "chunk_count" = dup."distinct_chunks"
FROM (
  SELECT "document_id", count(DISTINCT "chunk_index")::int AS "distinct_chunks"
  FROM "document_chunks"
  GROUP BY "document_id"
  HAVING count(*) > count(DISTINCT "chunk_index")
) dup
WHERE d."id" = dup."document_id";--> statement-breakpoint
DELETE FROM "document_chunks"
WHERE "id" IN (
  SELECT "id" FROM (
    SELECT "id", row_number() OVER (
      PARTITION BY "document_id", "chunk_index"
      ORDER BY ("embedding" IS NULL), "id"
    ) AS "rn"
    FROM "document_chunks"
  ) ranked
  WHERE ranked."rn" > 1
);--> statement-breakpoint
CREATE UNIQUE INDEX "uq_chunks_document_chunk" ON "document_chunks" USING btree ("document_id","chunk_index");
