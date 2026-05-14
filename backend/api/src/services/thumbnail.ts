import path from "path";
import os from "os";
import fs from "fs";
import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import ffmpeg from "fluent-ffmpeg";
import { GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { Readable } from "stream";
import { s3 } from "./s3";
import { config } from "../config";

export async function generateAndUploadThumbnail(
  projectId: string,
  videoS3Key: string,
  videoFilename: string
): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "subtitle-thumb-"));
  try {
    const videoPath = path.join(tmpDir, "input" + path.extname(videoFilename || ".mp4"));
    const s3Object = await s3.send(
      new GetObjectCommand({ Bucket: config.s3.bucket, Key: videoS3Key })
    );
    if (!s3Object.Body) throw new Error("Empty S3 response for video");
    await pipeline(s3Object.Body as Readable, createWriteStream(videoPath));

    const thumbPath = path.join(tmpDir, "thumb.jpg");
    await new Promise<void>((resolve, reject) => {
      ffmpeg(videoPath)
        .seekInput(1)
        .frames(1)
        .output(thumbPath)
        .on("end", () => resolve())
        .on("error", (err: Error) => reject(new Error(`FFmpeg thumbnail failed: ${err.message}`)))
        .run();
    });

    const thumbKey = `users/${projectId}/thumbnails/thumb.jpg`;
    const fileBuffer = fs.readFileSync(thumbPath);
    await s3.send(
      new PutObjectCommand({
        Bucket: config.s3.bucket,
        Key: thumbKey,
        Body: fileBuffer,
        ContentType: "image/jpeg",
      })
    );

    return thumbKey;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
