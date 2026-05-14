import { config } from "../config";

interface TranscribeJobPayload {
  project_id: string;
  s3_key: string;
  language: string;
  callback_url: string;
  internal_secret: string;
}

const MAX_RETRIES = 5;
const RETRY_BASE_MS = 2000;

export async function dispatchTranscriptionJob(
  projectId: string,
  s3Key: string,
  language: string
): Promise<void> {
  const callbackUrl = process.env.API_SELF_URL
    ? `${process.env.API_SELF_URL}/api/internal/transcription-complete`
    : `http://api:3001/api/internal/transcription-complete`;

  const payload: TranscribeJobPayload = {
    project_id: projectId,
    s3_key: s3Key,
    language,
    callback_url: callbackUrl,
    internal_secret: config.internalSecret,
  };

  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, RETRY_BASE_MS * 2 ** (attempt - 1)));
    }
    try {
      const res = await fetch(`${config.transcriber.url}/transcribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Transcriber service error: ${res.status}`);
      return;
    } catch (err) {
      lastError = err;
      console.warn(`Transcription dispatch attempt ${attempt + 1} failed:`, err);
    }
  }
  throw lastError;
}
