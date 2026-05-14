import { Router } from "express";
import { z } from "zod";
import { prisma } from "../prisma";
import { config } from "../config";
import { validate } from "../middleware/validate";
import { generateAndUploadThumbnail } from "../services/thumbnail";

const router = Router();

const callbackSchema = z.object({
  projectId: z.string(),
  status: z.enum(["ready", "error"]),
  errorMessage: z.string().optional(),
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

router.post(
  "/transcription-complete",
  (req, res, next) => {
    // Verify internal secret header
    const secret = req.headers["x-internal-secret"];
    if (secret !== config.internalSecret) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  },
  validate(callbackSchema),
  async (req, res) => {
    const body = req.body as z.infer<typeof callbackSchema>;

    if (body.status === "error") {
      await prisma.project.update({
        where: { id: body.projectId },
        data: { status: "error", errorMessage: body.errorMessage ?? "Transcription failed" },
      });
      res.json({ ok: true });
      return;
    }

    const project = await prisma.$transaction(async (tx) => {
      const updated = await tx.project.update({
        where: { id: body.projectId },
        data: { status: "ready" },
        select: { id: true, videoS3Key: true, videoFilename: true },
      });

      if (body.cues && body.cues.length > 0) {
        await tx.subtitleCue.deleteMany({ where: { projectId: body.projectId } });
        await tx.subtitleCue.createMany({
          data: body.cues.map((cue, i) => ({
            projectId: body.projectId,
            position: i,
            text: cue.text,
            startTime: cue.timestamp[0],
            endTime: cue.timestamp[1] ?? null,
            wordChunks: cue.wordChunks ?? null,
          })),
        });
      }

      return updated;
    });

    res.json({ ok: true });

    // Generate thumbnail asynchronously — don't block the response
    generateAndUploadThumbnail(project.id, project.videoS3Key, project.videoFilename)
      .then((thumbKey) =>
        prisma.project.update({
          where: { id: project.id },
          data: { thumbnailS3Key: thumbKey },
        })
      )
      .catch((err) => console.error("Thumbnail generation failed:", err));
  }
);

export default router;
