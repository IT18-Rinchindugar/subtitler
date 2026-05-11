import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import clsx from "clsx";
import { projectsApi, uploadApi, uploadFileToS3, getVideoMetadata, type ProjectSummary } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { Spinner } from "../../ui/Spinner";

function StatusBadge({ status }: { status: ProjectSummary["status"] }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "ready" && "bg-green-500/10 text-green-400",
        (status === "uploading" || status === "transcribing") && "bg-amber-500/10 text-amber-400",
        status === "error" && "bg-red-500/10 text-red-400"
      )}
    >
      {(status === "uploading" || status === "transcribing") && (
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      )}
      {status === "ready" && <span className="h-1.5 w-1.5 rounded-full bg-green-400" />}
      {status === "error" && <span className="h-1.5 w-1.5 rounded-full bg-red-400" />}
      {status === "uploading" ? "Uploading" : status === "transcribing" ? "Transcribing" : status === "ready" ? "Ready" : "Error"}
    </span>
  );
}

function ProjectCard({ project, onClick }: { project: ProjectSummary; onClick: () => void }) {
  const duration = project.videoDuration
    ? `${Math.floor(project.videoDuration / 60)}:${String(Math.floor(project.videoDuration % 60)).padStart(2, "0")}`
    : null;

  const date = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <button
      onClick={onClick}
      disabled={project.status !== "ready"}
      className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 text-left transition-all hover:border-orange-500/40 hover:shadow-lg hover:shadow-orange-500/5 disabled:cursor-default disabled:opacity-70"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full bg-zinc-800 overflow-hidden">
        {project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt={project.title}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full items-center justify-center">
            <svg className="h-10 w-10 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.854v6.292a1 1 0 01-1.447.893L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
            </svg>
          </div>
        )}
        {(project.status === "transcribing" || project.status === "uploading") && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/60 backdrop-blur-sm">
            <Spinner sizeRem={2} />
          </div>
        )}
        {duration && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
            {duration}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-3">
        <p className="truncate font-medium text-white">{project.title}</p>
        <div className="flex items-center justify-between">
          <StatusBadge status={project.status} />
          <span className="text-xs text-zinc-500">{date}</span>
        </div>
      </div>
    </button>
  );
}

function NewProjectDropzone({ onProjectCreated }: { onProjectCreated: (projectId: string) => void }) {
  const [uploading, setUploading] = React.useState(false);
  const [uploadPct, setUploadPct] = React.useState(0);
  const [error, setError] = React.useState<string | null>(null);
  const [language, setLanguage] = React.useState("en");

  const onDrop = React.useCallback(async (files: File[]) => {
    const file = files[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const { projectId, uploadUrl } = await uploadApi.getPresignedUrl(file.name, file.type, file.size, language);
      await uploadFileToS3(uploadUrl, file, setUploadPct);
      const meta = await getVideoMetadata(file);
      await uploadApi.complete(projectId, meta.duration, meta.width, meta.height);
      onProjectCreated(projectId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
      setUploading(false);
    }
  }, [language, onProjectCreated]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "video/*": [".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ogv", ".3gp"] },
    maxFiles: 1,
    disabled: uploading,
  });

  return (
    <div
      {...getRootProps()}
      className={clsx(
        "flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer aspect-video",
        isDragActive ? "border-orange-400 bg-orange-500/5" : "border-zinc-700 hover:border-zinc-500"
      )}
    >
      <input {...getInputProps()} />
      {uploading ? (
        <>
          <Spinner sizeRem={2} />
          <p className="text-sm text-zinc-400">Uploading… {uploadPct}%</p>
        </>
      ) : (
        <>
          <svg className="h-8 w-8 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
          </svg>
          <div>
            <p className="font-medium text-white text-sm">New project</p>
            <p className="text-xs text-zinc-500 mt-0.5">Drop a video or click to browse</p>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["projects"],
    queryFn: () => projectsApi.list(1, 50),
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasActive = items.some(
        (p) => p.status === "uploading" || p.status === "transcribing"
      );
      return hasActive ? 4000 : false;
    },
  });

  function handleProjectCreated(projectId: string) {
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    navigate({ to: `/editor/${projectId}` });
  }

  return (
    <div className="min-h-dvh bg-zinc-950 text-white">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 md:px-6">
          <h1 className="font-display text-xl text-white">Subtitles</h1>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-zinc-400 md:block">{user?.email}</span>
            <button
              onClick={logout}
              className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto max-w-7xl px-4 py-8 md:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-medium text-white">Your videos</h2>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <Spinner sizeRem={2.5} />
          </div>
        )}

        {isError && (
          <p className="py-20 text-center text-sm text-red-400">
            Failed to load projects. Please refresh.
          </p>
        )}

        {data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {/* New project tile */}
            <NewProjectDropzone onProjectCreated={handleProjectCreated} />

            {/* Project cards */}
            {data.items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onClick={() => navigate({ to: `/editor/${project.id}` })}
              />
            ))}
          </div>
        )}

        {data && data.items.length === 0 && (
          <p className="mt-4 text-sm text-zinc-500 text-center">
            Drop a video in the box above to get started.
          </p>
        )}
      </main>
    </div>
  );
}
