import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { generateUploadUrl, videoS3Key } from "../services/s3";
import { dispatchTranscriptionJob } from "../services/transcriber";

const router = Router();

const presignedSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().min(1),
  fileSizeBytes: z.number().positive(),
  language: z.string().default("en"),
});

router.post("/presigned", authenticate, validate(presignedSchema), async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { filename, contentType, language } =
    req.body as z.infer<typeof presignedSchema>;

  // Create project row first so we have an ID
  const project = await prisma.project.create({
    data: {
      userId,
      title: filename.replace(/\.[^/.]+$/, ""),
      videoS3Key: "pending",
      videoFilename: filename,
      status: "uploading",
      language,
    },
  });

  const s3Key = videoS3Key(userId, project.id, filename);
  await prisma.project.update({ where: { id: project.id }, data: { videoS3Key: s3Key } });

  const uploadUrl = await generateUploadUrl(s3Key, contentType);

  res.json({ projectId: project.id, uploadUrl, s3Key });
});

const completeSchema = z.object({
  videoDuration: z.number().positive(),
  videoWidth: z.number().int().positive(),
  videoHeight: z.number().int().positive(),
});

router.post("/:projectId/complete", authenticate, validate(completeSchema), async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;
  const { videoDuration, videoWidth, videoHeight } =
    req.body as z.infer<typeof completeSchema>;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
  });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await prisma.project.update({
    where: { id: projectId },
    data: { videoDuration, videoWidth, videoHeight, status: "transcribing" },
  });

  // Fire-and-forget — transcriber calls back when done
  dispatchTranscriptionJob(projectId, project.videoS3Key, project.language).catch(
    async (err) => {
      console.error("Failed to dispatch transcription job:", err);
      await prisma.project.update({
        where: { id: projectId },
        data: { status: "error", errorMessage: "Failed to start transcription" },
      });
    }
  );

  res.json({ projectId, status: "transcribing" });
});

export default router;
