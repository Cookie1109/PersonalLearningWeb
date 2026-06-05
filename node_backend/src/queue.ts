import { Queue, Worker, Job } from 'bullmq';
import axios from 'axios';
import FormData from 'form-data';
import { config } from './config';
import { query } from './db';
import { redis } from './redis';

// Use shared Redis connection for BullMQ

export const uploadQueue = new Queue('upload-processing', {
  connection: redis as any,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { age: 86400 },   // cleanup completed jobs after 24h
    removeOnFail: false,                 // keep failed jobs for debugging (DLQ)
  },
});

// Worker setup
export const worker = new Worker(
  'upload-processing',
  async (job: Job) => {
    const { userId, title, sourceContent, fileBufferBase64, fileName, contentType } = job.data;
    
    // Update job status to 'processing' in MySQL
    await query(
      'UPDATE ai_jobs SET status = ?, updated_at = NOW() WHERE id = ?',
      ['processing', job.id]
    );

    try {
      const form = new FormData();
      form.append('user_id', userId.toString());
      if (title) form.append('title', title);
      
      if (fileBufferBase64) {
        // fileBuffer is stored as base64 string to minimize Redis memory usage
        const buffer = Buffer.from(fileBufferBase64, 'base64');
        form.append('file', buffer, {
          filename: fileName || 'document',
          contentType: contentType || 'application/octet-stream',
        });
      } else if (sourceContent) {
        form.append('source_content', sourceContent);
      } else {
        throw new Error('Either fileBuffer or sourceContent must be provided');
      }

      // Call FastAPI backend internally (authenticated via shared secret header)
      const response = await axios.post(`${config.fastapiUrl}/api/documents/process-async`, form, {
        headers: {
          ...form.getHeaders(),
          'X-Internal-Secret': config.internalServiceSecret,
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      const result = response.data;
      const lessonId = result.lesson_id;

      // Update job status to 'completed' and write the result
      await query(
        'UPDATE ai_jobs SET status = ?, result = ?, updated_at = NOW() WHERE id = ?',
        ['completed', JSON.stringify(result), job.id]
      );

      // We will write the hash map to MySQL document_hash
      if (job.data.hash) {
        await query(
          'INSERT INTO document_hash (hash, user_id, document_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE document_id = VALUES(document_id)',
          [job.data.hash, userId, lessonId]
        );
      }

      return result;

    } catch (error: any) {
      console.error(`Error processing job ${job.id}:`, error.message);
      const errMsg = error.response?.data?.detail || error.message || 'Unknown error';
      
      // Update job status to 'failed' and log error
      await query(
        'UPDATE ai_jobs SET status = ?, error = ?, updated_at = NOW() WHERE id = ?',
        ['failed', errMsg, job.id]
      );
      
      throw error;
    }
  },
  {
    connection: redis as any,
    concurrency: 5,
    stalledInterval: 30000,   // check for stalled jobs every 30s
  }
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} completed successfully`);
});

worker.on('failed', (job, err) => {
  const attemptsMade = job?.attemptsMade ?? '?';
  const attemptsTotal = job?.opts?.attempts ?? '?';
  console.error(`Job ${job?.id} failed (attempt ${attemptsMade}/${attemptsTotal}):`, err.message);
});

worker.on('stalled', (jobId) => {
  console.warn(`Job ${jobId} has stalled — will be retried automatically`);
});
