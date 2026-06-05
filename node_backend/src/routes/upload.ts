import { Router, Response } from 'express';
import multer from 'multer';
import crypto from 'crypto';
import axios, { AxiosError } from 'axios';
import { AuthenticatedRequest } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { query } from '../db';
import { uploadQueue } from '../queue';
import { config } from '../config';

const router = Router();
const upload = multer({ limits: { fileSize: 15 * 1024 * 1024 } }); // 15MB limit

// Helper to compute SHA-256 hash of a buffer or string
function computeHash(data: Buffer | string): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// ────────────────────────────────────────────────────────────
// URL Content Fetcher
// Fetches the actual text/HTML content of a URL so we can
// hash the CONTENT (not the URL string) for accurate caching.
// Returns { content, title } on success, throws on error.
// ────────────────────────────────────────────────────────────
const URL_FETCH_TIMEOUT_MS = 15_000;   // 15 seconds
const URL_MAX_CONTENT_BYTES = 5 * 1024 * 1024; // 5 MB

interface FetchedUrl {
  content: string;
  extractedTitle: string;
}

async function fetchUrlContent(url: string): Promise<FetchedUrl> {
  let response;
  try {
    response = await axios.get<string>(url, {
      timeout: URL_FETCH_TIMEOUT_MS,
      maxContentLength: URL_MAX_CONTENT_BYTES,
      maxBodyLength: URL_MAX_CONTENT_BYTES,
      responseType: 'text',
      headers: {
        // Polite bot header — helps avoid some bot-detection blocks
        'User-Agent': 'NEXL-LearningBot/1.0 (+https://nexl.app/bot)',
        'Accept': 'text/html,text/plain,application/xhtml+xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'vi,en-US;q=0.9,en;q=0.8',
      },
    });
  } catch (err) {
    const axErr = err as AxiosError;
    const status = axErr.response?.status;
    const isTimeout = axErr.code === 'ECONNABORTED' || axErr.message?.includes('timeout');

    if (isTimeout) {
      throw Object.assign(new Error(`URL did not respond within ${URL_FETCH_TIMEOUT_MS / 1000}s`), { code: 'URL_TIMEOUT' });
    }
    if (status === 404) {
      throw Object.assign(new Error(`URL returned 404 Not Found`), { code: 'URL_NOT_FOUND' });
    }
    if (status && status >= 400) {
      throw Object.assign(new Error(`URL returned HTTP ${status}`), { code: 'URL_HTTP_ERROR' });
    }
    throw Object.assign(new Error(axErr.message || 'Failed to fetch URL'), { code: 'URL_FETCH_FAILED' });
  }

  const rawText: string = typeof response.data === 'string' ? response.data : String(response.data);

  // Extract <title> tag for automatic document naming (works for HTML pages)
  const titleMatch = rawText.match(/<title[^>]*>\s*([\s\S]*?)\s*<\/title>/i);
  const extractedTitle = titleMatch
    ? titleMatch[1].replace(/\s+/g, ' ').trim().slice(0, 200) // max 200 chars
    : '';

  return { content: rawText, extractedTitle };
}

// Upload Route
router.post(
  '/upload',
  upload.single('file'),
  rateLimiter({ limit: 5, windowSec: 60 }), // Rate limit: 5 uploads per minute
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
      let hash = '';
      let title = req.body.title || '';
      let sourceContent = req.body.text || '';
      const url = req.body.url || '';
      let fileBuffer: Buffer | undefined;
      let fileName = '';
      let contentType = '';

      if (req.file) {
        fileBuffer = req.file.buffer;
        fileName = req.file.originalname;
        contentType = req.file.mimetype;
        hash = computeHash(fileBuffer);
        if (!title) {
          title = fileName.replace(/\.[^/.]+$/, ""); // strip extension
        }
      } else if (sourceContent) {
        hash = computeHash(sourceContent);
      } else if (url) {
        // ── URL Upload: fetch actual content first, then hash the content ──
        // This ensures cache accuracy: same URL with changed content → different hash.
        let fetchedUrl: FetchedUrl;
        try {
          fetchedUrl = await fetchUrlContent(url);
        } catch (fetchErr: any) {
          console.warn(`[URL Upload] Failed to fetch ${url}: ${fetchErr.message}`);
          return res.status(422).json({
            message: `Không thể truy cập URL: ${fetchErr.message}`,
            detail: {
              code: fetchErr.code || 'URL_FETCH_FAILED',
              url,
              hint: 'Kiểm tra lại URL, đảm bảo trang web công khai và không chặn bot.',
            },
          });
        }

        sourceContent = fetchedUrl.content;
        hash = computeHash(sourceContent); // hash from CONTENT, not URL string
        if (!title) {
          title = fetchedUrl.extractedTitle || url; // use <title> tag or fall back to URL
        }
        console.log(`[URL Upload] Fetched ${url} → ${sourceContent.length} chars, hash=${hash.slice(0, 12)}...`);
      } else {
        return res.status(400).json({
          message: 'Either file, text, or url must be provided',
          detail: { code: 'INVALID_UPLOAD_INPUT' }
        });
      }

      // 1. Check MySQL cache for the hash
      const hashCheck = await query(
        'SELECT document_id FROM document_hash WHERE hash = ? AND user_id = ? LIMIT 1',
        [hash, userId]
      );

      if (hashCheck.rows.length > 0) {
        const lessonId = hashCheck.rows[0].document_id;

        // Cache Hit! Get document info from the lessons table directly
        // (document_hash.document_id FK references lessons.id)
        const lessonQuery = await query(
          'SELECT id, user_id, title, source_content, content_markdown, source_file_url, source_file_name, source_file_mime_type FROM lessons WHERE id = ? LIMIT 1',
          [lessonId]
        );

        if (lessonQuery.rows.length > 0) {
          const lesson = lessonQuery.rows[0];

          // Log/increment Cache Hit stats in MySQL
          const hitUpdate = await query(
            'UPDATE cache_hit SET hit_count = hit_count + 1, last_hit_at = NOW() WHERE user_id = ? AND hash = ?',
            [userId, hash]
          );

          const header = hitUpdate.rows[0];
          const affectedRows = header?.affectedRows || 0;

          if (affectedRows === 0) {
            await query(
              'INSERT INTO cache_hit (user_id, hash, hit_count) VALUES (?, ?, 1)',
              [userId, hash]
            );
          }

          console.log(`Cache HIT for hash ${hash}`);
          return res.json({
            document_id: lesson.id,
            lesson_id: lesson.id,
            title: lesson.title,
            content_markdown: lesson.content_markdown,
            source_content: lesson.source_content,
            source_file_url: lesson.source_file_url,
            source_file_name: lesson.source_file_name,
            source_file_mime_type: lesson.source_file_mime_type,
            cache_hit: true,
            message: 'Document resolved from cache'
          });
        }
      }

      // Cache Miss! Queue job for async processing
      const jobId = crypto.randomUUID();
      
      // Save job details in MySQL ai_jobs
      const payload = {
        userId,
        title,
        sourceContent: fileBuffer ? undefined : sourceContent,
        fileName,
        contentType,
        hash
      };

      await query(
        'INSERT INTO ai_jobs (id, user_id, job_type, status, payload) VALUES (?, ?, ?, ?, ?)',
        [jobId, userId, 'process_upload', 'pending', JSON.stringify(payload)]
      );

      // Add to BullMQ
      await uploadQueue.add(
        'process_upload',
        {
          userId,
          title,
          sourceContent,
          fileBufferBase64: fileBuffer ? fileBuffer.toString('base64') : undefined,
          fileName,
          contentType,
          hash
        },
        { jobId }
      );

      console.log(`Cache MISS for hash ${hash}. Job queued: ${jobId}`);
      return res.status(202).json({
        job_id: jobId,
        status: 'pending',
        message: 'Document upload accepted and queued for processing'
      });

    } catch (error: any) {
      console.error('Upload route error:', error);
      return res.status(500).json({
        message: 'Internal server error during upload',
        error: error.message
      });
    }
  }
);

// Get Job Status Route
router.get(
  '/jobs/:jobId',
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: 'Unauthorized' });
    }

    const { jobId } = req.params;

    try {
      const jobQuery = await query(
        'SELECT status, result, error FROM ai_jobs WHERE id = ? AND user_id = ? LIMIT 1',
        [jobId, userId]
      );

      if (jobQuery.rows.length === 0) {
        return res.status(404).json({
          message: 'Job not found',
          detail: { code: 'JOB_NOT_FOUND' }
        });
      }

      const job = jobQuery.rows[0];

      return res.json({
        job_id: jobId,
        status: job.status,
        result: job.result ? job.result : null,
        error: job.error ? job.error : null
      });

    } catch (error: any) {
      console.error('Get job status error:', error);
      return res.status(500).json({
        message: 'Internal server error checking job status',
        error: error.message
      });
    }
  }
);

export default router;
