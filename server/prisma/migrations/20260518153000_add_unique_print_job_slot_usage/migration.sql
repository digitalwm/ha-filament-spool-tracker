CREATE UNIQUE INDEX IF NOT EXISTS "print_job_spool_usage_print_job_id_source_type_ams_index_tray_index_key"
ON "print_job_spool_usage"("print_job_id", "source_type", "ams_index", "tray_index");
