import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';
import { LOG } from '../utils/logger';
import { getHABaseUrl } from '../utils/haUrl';

const logger = LOG('COVER_CACHE');

function getCacheDir(): string {
  const dbUrl = process.env.DATABASE_URL;
  let dataDir: string;
  if (dbUrl?.startsWith('file:')) {
    const p = decodeURIComponent(new URL(dbUrl).pathname);
    dataDir = path.dirname(p);
    if (!path.isAbsolute(dataDir)) {
      dataDir = path.resolve(process.cwd(), dataDir);
    }
  } else {
    dataDir = path.join(process.cwd(), 'data');
  }
  return path.join(dataDir, 'cache');
}

function getCachedPath(jobId: string): { path: string; ext: string } | null {
  const cacheDir = getCacheDir();
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = path.join(cacheDir, `cover-${jobId}${ext}`);
    if (fs.existsSync(p)) return { path: p, ext };
  }
  return null;
}

/**
 * Fetch cover image from HA (entity_picture URL) and save to local cache.
 * Returns the API path to use for projectImage (e.g. /api/print-jobs/:id/cover) or null on failure.
 */
export async function fetchAndCacheCoverImage(haImagePath: string, jobId: string): Promise<string | null> {
  const token = process.env.SUPERVISOR_TOKEN;
  if (!token || !haImagePath || !haImagePath.startsWith('/')) {
    return null;
  }

  const url = `${getHABaseUrl()}${haImagePath}`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      logger.warn(`Cover image fetch failed: ${res.status} ${url}`);
      return null;
    }

    const contentType = res.headers.get('content-type') || '';
    const ext = contentType.includes('png') ? '.png' : contentType.includes('webp') ? '.webp' : '.jpg';
    const buffer = Buffer.from(await res.arrayBuffer());
    const cacheDir = getCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    const filePath = path.join(cacheDir, `cover-${jobId}${ext}`);
    fs.writeFileSync(filePath, buffer);
    logger.debug(`Cached cover image for job ${jobId} at ${filePath}`);
    return `/print-jobs/${jobId}/cover`;
  } catch (err) {
    logger.warn('Failed to cache cover image:', err);
    return null;
  }
}

/** Cache a preview extracted from the printer's active 3MF project. */
export function cacheCoverImageBuffer(jobId: string, buffer: Buffer): string | null {
  if (buffer.length === 0 || buffer.length > 10 * 1024 * 1024) return null;
  try {
    const cacheDir = getCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, `cover-${jobId}.png`), buffer);
    return getCoverImageReference(jobId, buffer);
  } catch (err) {
    logger.warn('Failed to cache printer cover image:', err);
    return null;
  }
}

export function getCoverImageReference(jobId: string, buffer: Buffer): string {
  const revision = createHash('sha256').update(buffer).digest('hex').slice(0, 12);
  return `/print-jobs/${jobId}/cover?v=${revision}`;
}

/**
 * Resolve cached file path for a job and its content type for serving.
 */
export function getCoverImagePath(jobId: string): { filePath: string; contentType: string } | null {
  const entry = getCachedPath(jobId);
  if (!entry) return null;
  const contentType =
    entry.ext === '.png' ? 'image/png' : entry.ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { filePath: entry.path, contentType };
}

/**
 * Remove cached cover image for a print job (e.g. when the job is deleted).
 */
export function deleteCachedCoverImage(jobId: string): void {
  const entry = getCachedPath(jobId);
  if (!entry) return;
  try {
    fs.unlinkSync(entry.path);
    logger.debug(`Deleted cached cover image for job ${jobId}`);
  } catch (err) {
    logger.warn(`Failed to delete cached cover for job ${jobId}:`, err);
  }
}
