CREATE TABLE IF NOT EXISTS "printer_slots" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "printer_id" TEXT NOT NULL,
    "spool_id" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'ams',
    "ams_index" INTEGER NOT NULL DEFAULT -1,
    "tray_index" INTEGER NOT NULL DEFAULT -1,
    "slot_label" TEXT NOT NULL,
    "entity_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "is_empty" BOOLEAN,
    "tag_uid" TEXT,
    "tray_uuid" TEXT,
    "filament_id" TEXT,
    "filament_type" TEXT,
    "color_hex" TEXT,
    "tray_weight" REAL,
    "remain_percent" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "printer_slots_printer_id_fkey" FOREIGN KEY ("printer_id") REFERENCES "printers" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "printer_slots_spool_id_fkey" FOREIGN KEY ("spool_id") REFERENCES "spools" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "printer_slots_printer_id_source_type_ams_index_tray_index_key"
ON "printer_slots"("printer_id", "source_type", "ams_index", "tray_index");

CREATE INDEX IF NOT EXISTS "printer_slots_spool_id_idx" ON "printer_slots"("spool_id");

CREATE TABLE IF NOT EXISTS "print_job_spool_usage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "print_job_id" TEXT NOT NULL,
    "spool_id" TEXT,
    "slot_id" TEXT,
    "source_type" TEXT NOT NULL DEFAULT 'ams',
    "ams_index" INTEGER NOT NULL DEFAULT -1,
    "tray_index" INTEGER NOT NULL DEFAULT -1,
    "slot_label" TEXT,
    "grams_used" REAL NOT NULL,
    "meters_used" REAL,
    "deducted_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "print_job_spool_usage_print_job_id_fkey" FOREIGN KEY ("print_job_id") REFERENCES "print_jobs" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "print_job_spool_usage_spool_id_fkey" FOREIGN KEY ("spool_id") REFERENCES "spools" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "print_job_spool_usage_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "printer_slots" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "print_job_spool_usage_print_job_id_idx" ON "print_job_spool_usage"("print_job_id");
CREATE INDEX IF NOT EXISTS "print_job_spool_usage_spool_id_idx" ON "print_job_spool_usage"("spool_id");
CREATE INDEX IF NOT EXISTS "print_job_spool_usage_slot_id_idx" ON "print_job_spool_usage"("slot_id");
CREATE UNIQUE INDEX IF NOT EXISTS "print_job_spool_usage_print_job_id_source_type_ams_index_tray_index_key"
ON "print_job_spool_usage"("print_job_id", "source_type", "ams_index", "tray_index");
