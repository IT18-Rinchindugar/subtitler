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

  console.log("project", project);

  console.log("cues", cues);
  console.log("style", style);

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

// GET /api/render/:projectId/history — list all completed render versions
router.get("/:projectId/history", authenticate, async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const jobs = await prisma.renderJob.findMany({
    where: { projectId, status: "done" },
    orderBy: { createdAt: "asc" },
    select: { id: true, createdAt: true, outputS3Key: true, styleJson: true },
  });

  const versions = await Promise.all(
    jobs.map(async (job, i) => ({
      id: job.id,
      versionNumber: i + 1,
      createdAt: job.createdAt,
      downloadUrl: job.outputS3Key ? await generateDownloadUrl(job.outputS3Key) : null,
      styleJson: job.styleJson,
    }))
  );

  res.json({ versions });
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
  project: { id: string; videoS3Key: string; videoFilename: string; videoDuration: number | null; videoWidth: number | null; videoHeight: number | null },
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

    const styleWithDimensions: SubtitleStyle = {
      ...(style ?? {}),
      _videoWidth: project.videoWidth ?? style?._videoWidth,
      _videoHeight: project.videoHeight ?? style?._videoHeight,
    };

    // 2a. Download custom font so libass can render it correctly
    const fontsDir = path.join(tmpDir, "fonts");
    fs.mkdirSync(fontsDir);
    if (style?._fontUrl) {
      const fontExt = style._fontUrl.includes(".otf") ? ".otf" : ".ttf";
      await downloadGoogleFont(style._fontUrl, path.join(fontsDir, `font${fontExt}`));
    }

    const assContent = generateAss(cues, styleWithDimensions, project.videoDuration ?? 0);
    const assPath = path.join(tmpDir, "subtitles.ass");
    fs.writeFileSync(assPath, assContent, "utf-8");

    // 3. Run FFmpeg: burn ASS subtitles into video
    const outputPath = path.join(tmpDir, "output.mp4");
    await new Promise<void>((resolve, reject) => {
      const escapedAssPath = assPath
        .replace(/\\/g, "/")
        .replace(/'/g, "\\'")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]");
      const escapedFontsDir = fontsDir
        .replace(/\\/g, "/")
        .replace(/'/g, "\\'")
        .replace(/\[/g, "\\[")
        .replace(/\]/g, "\\]")
        .replace(/:/g, "\\:");
      ffmpeg(videoPath)
        .videoFilters(`ass='${escapedAssPath}':fontsdir='${escapedFontsDir}':shaping=1`)
        .outputOptions([
          "-c:v libx264",
          "-preset slow",
          "-crf 16",
          "-profile:v high",
          "-level 4.1",
          "-pix_fmt yuv420p",
          "-tune film",
          "-x264opts", "no-fast-pskip=1:dct-decimate=0:rc-lookahead=60",
          "-colorspace bt709",
          "-color_primaries bt709",
          "-color_trc bt709",
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

// Fetch a Google Fonts CSS URL, extract the first TTF/OTF url, download it to destPath.
// Returns true on success, false if font could not be resolved (caller falls back to system font).
async function downloadGoogleFont(cssUrl: string, destPath: string): Promise<boolean> {
  try {
    // Google Fonts returns woff2 by default; request a plain UA to get TTF urls
    const cssRes = await fetch(cssUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!cssRes.ok) return false;
    const css = await cssRes.text();

    const match = css.match(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.(?:ttf|otf))\)/);
    if (!match) return false;

    const fontRes = await fetch(match[1]);
    if (!fontRes.ok) return false;
    const buf = Buffer.from(await fontRes.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return true;
  } catch {
    return false;
  }
}

export default router;
