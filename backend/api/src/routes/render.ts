import { Router } from "express";
import { z } from "zod";
import path from "path";
import os from "os";
import fs from "fs";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import { prisma } from "../prisma";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { s3, generateDownloadUrl } from "../services/s3";
import { generateAss, type SubtitleCue, type SubtitleStyle } from "../services/assGenerator";
import { config } from "../config";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";

const router = Router();

const startSchema = z.object({
  cues: z.array(
    z.object({
      text: z.string(),
      startTime: z.number(),
      endTime: z.number().nullable(),
    })
  ),
  style: z.record(z.unknown()).optional(),
});

// POST /api/render/:projectId — enqueue a server-side FFmpeg + ASS render job
router.post("/:projectId", authenticate, validate(startSchema), async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;
  const { cues, style } = req.body as z.infer<typeof startSchema>;

  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const job = await prisma.renderJob.create({
    data: {
      projectId,
      status: "processing",
      cuesJson: cues as any,
      styleJson: style as any ?? null,
    },
  });

  // Run async — don't await
  processRenderJob(job.id, project, cues, style as SubtitleStyle | undefined).catch(async (err) => {
    console.error("Render job failed:", err);
    await prisma.renderJob.update({
      where: { id: job.id },
      data: { status: "error", errorMessage: err instanceof Error ? err.message : String(err) },
    });
  });

  res.json({ jobId: job.id, status: "processing" });
});

// GET /api/render/:projectId/job/:jobId — poll render job status
router.get("/:projectId/job/:jobId", authenticate, async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId, jobId } = req.params;

  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const job = await prisma.renderJob.findFirst({ where: { id: jobId, projectId } });
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (job.status === "done" && job.outputS3Key) {
    const downloadUrl = await generateDownloadUrl(job.outputS3Key);
    res.json({ status: "done", downloadUrl });
    return;
  }

  res.json({ status: job.status, errorMessage: job.errorMessage ?? undefined });
});

async function processRenderJob(
  jobId: string,
  project: { id: string; videoS3Key: string; videoFilename: string; videoDuration: number | null },
  rawCues: Array<{ text: string; startTime: number; endTime: number | null }>,
  style?: SubtitleStyle,
) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subtitle-render-"));

  try {
    // 1. Download source video from S3
    const videoPath = path.join(tmpDir, "input" + path.extname(project.videoFilename || ".mp4"));
    const s3Object = await s3.send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: project.videoS3Key })
    );
    if (!s3Object.Body) throw new Error("Empty S3 response for video");
    await pipeline(s3Object.Body as Readable, createWriteStream(videoPath));

    // 2. Generate ASS file
    const cues: SubtitleCue[] = rawCues.map((c) => ({
      text: c.text,
      startTime: c.startTime,
      endTime: c.endTime,
    }));
    const assContent = generateAss(cues, style ?? {}, project.videoDuration ?? 0);
    const assPath = path.join(tmpDir, "subtitles.ass");
    fs.writeFileSync(assPath, assContent, "utf-8");

    // 3. Run FFmpeg: burn ASS subtitles into video
    const outputPath = path.join(tmpDir, "output.mp4");
    await new Promise<void>((resolve, reject) => {
      // The lavfi/ass filter requires the path wrapped in single quotes.
      // Escape backslashes (Windows) and single quotes inside the path.
      const escapedAssPath = assPath
        .replace(/\\/g, "/")
        .replace(/'/g, "\\'")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
      ffmpeg(videoPath)
        .videoFilters(`ass='${escapedAssPath}'`)
        .outputOptions([
          "-c:v libx264",
          "-preset fast",
          "-crf 18",
          "-c:a copy",
          "-movflags +faststart",
        ])
        .output(outputPath)
        .on("stderr", (line: string) => console.log("ffmpeg:", line))
        .on("end", () => resolve())
        .on("error", (err: Error) => {
          reject(new Error(`FFmpeg failed: ${err.message}`));
        })
        .run();
    });

    // 4. Upload rendered video to S3
    const ext = ".mp4";
    const outputS3Key = `users/${project.id}/renders/${jobId}${ext}`;
    const fileBuffer = fs.readFileSync(outputPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: outputS3Key,
        Body: fileBuffer,
        ContentType: "video/mp4",
      })
    );

    // 5. Mark job done
    await prisma.renderJob.update({
      where: { id: jobId },
      data: { status: "done", outputS3Key },
    });
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export default router;
