const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('../dist/server/generated/prisma/client.js');
const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
const { commitUndeductedUsageRows } = require('../dist/server/services/spoolUsageCommit.js');

async function main() {
  const dbPath = path.join(os.tmpdir(), `spooltracker-deduction-${process.pid}.db`);
  try { fs.unlinkSync(dbPath); } catch {}

  const prisma = new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: `file:${dbPath}` }),
  });

  await prisma.$executeRawUnsafe(`
    CREATE TABLE spools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filament_type TEXT NOT NULL,
      color_style TEXT NOT NULL DEFAULT 'solid',
      color TEXT NOT NULL,
      color_hex TEXT,
      manufacturer TEXT,
      initial_weight REAL NOT NULL,
      remaining_weight REAL NOT NULL,
      spool_weight REAL,
      diameter REAL NOT NULL DEFAULT 1.75,
      is_active INTEGER NOT NULL DEFAULT 0,
      archived_at TEXT,
      expiration_date TEXT,
      purchase_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE print_job_spool_usage (
      id TEXT PRIMARY KEY,
      print_job_id TEXT NOT NULL,
      spool_id TEXT,
      slot_id TEXT,
      source_type TEXT NOT NULL DEFAULT 'ams',
      ams_index INTEGER NOT NULL DEFAULT -1,
      tray_index INTEGER NOT NULL DEFAULT -1,
      slot_label TEXT,
      grams_used REAL NOT NULL,
      meters_used REAL,
      deducted_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE spool_audit_logs (
      id TEXT PRIMARY KEY,
      spool_id TEXT NOT NULL,
      print_job_id TEXT,
      usage_id TEXT,
      action TEXT NOT NULL,
      reason TEXT,
      delta_grams REAL NOT NULL,
      before_weight REAL NOT NULL,
      after_weight REAL NOT NULL,
      metadata_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  const now = new Date().toISOString();
  await prisma.$executeRawUnsafe(
    `INSERT INTO spools (id, name, filament_type, color_style, color, initial_weight, remaining_weight, diameter, is_active, created_at, updated_at)
     VALUES ('spool-1', 'PLA White', 'PLA', 'solid', 'White', 1000, 500, 1.75, 1, ?, ?)`,
    now,
    now,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO print_job_spool_usage (id, print_job_id, spool_id, source_type, ams_index, tray_index, slot_label, grams_used, created_at, updated_at)
     VALUES ('usage-1', 'job-1', 'spool-1', 'ams', 0, 0, 'AMS 1 Tray 1', 42.5, ?, ?)`,
    now,
    now,
  );

  assert.equal(await commitUndeductedUsageRows(prisma, 'job-1'), 1);
  let spool = await prisma.spool.findUniqueOrThrow({ where: { id: 'spool-1' } });
  assert.equal(spool.remainingWeight, 457.5);

  assert.equal(await commitUndeductedUsageRows(prisma, 'job-1'), 0);
  spool = await prisma.spool.findUniqueOrThrow({ where: { id: 'spool-1' } });
  assert.equal(spool.remainingWeight, 457.5);

  const usage = await prisma.printJobSpoolUsage.findUniqueOrThrow({ where: { id: 'usage-1' } });
  assert.ok(usage.deductedAt);
  const auditCount = await prisma.spoolAuditLog.count({ where: { spoolId: 'spool-1' } });
  assert.equal(auditCount, 1);

  await prisma.$disconnect();
  fs.unlinkSync(dbPath);
  console.log('deduction idempotency ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
