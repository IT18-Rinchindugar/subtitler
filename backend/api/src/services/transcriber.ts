import { config } from "../config";

interface TranscribeJobPayload {
  project_id: string;
  s3_key: string;
  language: string;
  callback_url: string;
  internal_secret: string;
}

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

  const res = await fetch(`${config.transcriber.url}/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Transcriber service error: ${res.status}`);
  }
}
