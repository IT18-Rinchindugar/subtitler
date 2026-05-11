import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { authenticate, AuthRequest } from "../middleware/auth";
import { validate } from "../middleware/validate";
import { generateDownloadUrl, deleteObject } from "../services/s3";

const router = Router();

router.get("/", authenticate, async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const page = Math.max(1, parseInt(req.query.page as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    prisma.project.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        videoFilename: true,
        videoDuration: true,
        thumbnailS3Key: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
    prisma.project.count({ where: { userId } }),
  ]);

  const itemsWithUrls = await Promise.all(
    items.map(async (p) => ({
      ...p,
      thumbnailUrl: p.thumbnailS3Key ? await generateDownloadUrl(p.thumbnailS3Key) : null,
    }))
  );

  res.json({ items: itemsWithUrls, total, page, limit });
});

router.get("/:projectId", authenticate, async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    include: {
      subtitleCues: { orderBy: { position: "asc" } },
    },
  });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const videoUrl = project.status === "ready"
    ? await generateDownloadUrl(project.videoS3Key)
    : null;

  const cues = project.subtitleCues.map((c) => ({
    id: c.position,
    text: c.text,
    timestamp: [c.startTime, c.endTime] as [number, number | null],
  }));

  // Collect word chunks from the first cue that has them (they're stored flat)
  const wordChunks = project.subtitleCues
    .filter((c) => c.wordChunks)
    .flatMap((c) => c.wordChunks as unknown[]);

  res.json({
    id: project.id,
    title: project.title,
    status: project.status,
    errorMessage: project.errorMessage,
    videoUrl,
    videoDuration: project.videoDuration,
    videoWidth: project.videoWidth,
    videoHeight: project.videoHeight,
    language: project.language,
    styleJson: project.styleJson,
    cues,
    wordChunks,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  });
});

const patchSchema = z.object({
  title: z.string().min(1).optional(),
  styleJson: z.record(z.unknown()).optional(),
  cues: z
    .array(
      z.object({
        text: z.string(),
        timestamp: z.tuple([z.number(), z.number().nullable()]),
        wordChunks: z.array(z.unknown()).optional(),
      })
    )
    .optional(),
  wordChunks: z.array(z.unknown()).optional(),
});

router.patch("/:projectId", authenticate, validate(patchSchema), async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;
  const body = req.body as z.infer<typeof patchSchema>;

  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (body.title !== undefined || body.styleJson !== undefined) {
      await tx.project.update({
        where: { id: projectId },
        data: {
          ...(body.title !== undefined && { title: body.title }),
          ...(body.styleJson !== undefined && { styleJson: body.styleJson }),
        },
      });
    }

    if (body.cues) {
      await tx.subtitleCue.deleteMany({ where: { projectId } });
      await tx.subtitleCue.createMany({
        data: body.cues.map((cue, i) => ({
          projectId,
          position: i,
          text: cue.text,
          startTime: cue.timestamp[0],
          endTime: cue.timestamp[1] ?? null,
          wordChunks: cue.wordChunks ?? null,
        })),
      });
    }
  });

  const updated = await prisma.project.findUnique({
    where: { id: projectId },
    select: { updatedAt: true },
  });

  res.json({ updatedAt: updated?.updatedAt });
});

router.delete("/:projectId", authenticate, async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Delete S3 objects
  await Promise.allSettled([
    deleteObject(project.videoS3Key),
    project.thumbnailS3Key ? deleteObject(project.thumbnailS3Key) : Promise.resolve(),
  ]);

  await prisma.project.delete({ where: { id: projectId } });
  res.status(204).send();
});

router.get("/:projectId/status", authenticate, async (req, res) => {
  const userId = (req as AuthRequest).userId;
  const { projectId } = req.params;

  const project = await prisma.project.findFirst({
    where: { id: projectId, userId },
    select: { status: true, errorMessage: true },
  });

  if (!project) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  res.json({ status: project.status, errorMessage: project.errorMessage });
});

export default router;
