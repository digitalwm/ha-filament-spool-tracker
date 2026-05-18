ALTER TABLE "spools" ADD COLUMN "tag_uid" TEXT;
ALTER TABLE "spools" ADD COLUMN "filament_id" TEXT;
ALTER TABLE "spools" ADD COLUMN "is_rfid_temporary" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS "spools_tag_uid_key" ON "spools"("tag_uid");
