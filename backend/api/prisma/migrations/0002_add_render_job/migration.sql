CREATE TABLE "RenderJob" (
    "id"           TEXT NOT NULL,
    "projectId"    TEXT NOT NULL,
    "status"       TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "outputS3Key"  TEXT,
    "cuesJson"     JSONB NOT NULL,
    "styleJson"    JSONB,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RenderJob_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RenderJob" ADD CONSTRAINT "RenderJob_projectId_fkey"
    FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
