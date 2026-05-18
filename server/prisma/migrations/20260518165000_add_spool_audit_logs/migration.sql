CREATE TABLE IF NOT EXISTS "spool_audit_logs" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "spool_id" TEXT NOT NULL,
  "print_job_id" TEXT,
  "usage_id" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT,
  "delta_grams" REAL NOT NULL,
  "before_weight" REAL NOT NULL,
  "after_weight" REAL NOT NULL,
  "metadata_json" TEXT,
  "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "spool_audit_logs_spool_id_fkey" FOREIGN KEY ("spool_id") REFERENCES "spools" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "spool_audit_logs_spool_id_idx" ON "spool_audit_logs"("spool_id");
CREATE INDEX IF NOT EXISTS "spool_audit_logs_print_job_id_idx" ON "spool_audit_logs"("print_job_id");
CREATE INDEX IF NOT EXISTS "spool_audit_logs_usage_id_idx" ON "spool_audit_logs"("usage_id");
