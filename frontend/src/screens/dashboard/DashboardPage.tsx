import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useDropzone } from "react-dropzone";
import clsx from "clsx";
import { projectsApi, uploadApi, uploadFileToS3, getVideoMetadata, type ProjectSummary } from "../../api/client";
import { useAuth } from "../../contexts/AuthContext";
import { Spinner } from "../../ui/Spinner";
import { RenderHistoryModal } from "./RenderHistoryModal";

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

function ProjectCard({
  project,
  onClick,
  onDelete,
  onRename,
  onShowHistory,
}: {
  project: ProjectSummary;
  onClick: () => void;
  onDelete: () => void;
  onRename: (newTitle: string) => void;
  onShowHistory: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(project.title);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const duration = project.videoDuration
    ? `${Math.floor(project.videoDuration / 60)}:${String(Math.floor(project.videoDuration % 60)).padStart(2, "0")}`
    : null;

  const date = new Date(project.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation();
    setDraft(project.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== project.title) onRename(trimmed);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") commitEdit();
    if (e.key === "Escape") setEditing(false);
  }

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900 transition-all hover:border-orange-500/40 hover:shadow-lg hover:shadow-orange-500/5">
      {/* Action buttons — top-right corner, visible on hover */}
      <div className="absolute right-2 top-2 z-10 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={startEdit}
          title="Rename"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800/90 text-zinc-400 backdrop-blur-sm transition-colors hover:bg-zinc-700 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 0l.172.172a2 2 0 010 2.828L12 16H9v-3z" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onShowHistory(); }}
          title="Render history"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800/90 text-zinc-400 backdrop-blur-sm transition-colors hover:bg-zinc-700 hover:text-white"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-800/90 text-zinc-400 backdrop-blur-sm transition-colors hover:bg-red-900/80 hover:text-red-300"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M9 7h6m-7 0a1 1 0 01-1-1V5a1 1 0 011-1h6a1 1 0 011 1v1a1 1 0 01-1 1H9z" />
          </svg>
        </button>
      </div>

      {/* Thumbnail — clickable to open */}
      <button
        onClick={onClick}
        disabled={project.status !== "ready"}
        className="relative aspect-video w-full bg-zinc-800 overflow-hidden disabled:cursor-default"
      >
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
      </button>

      {/* Info */}
      <div className="flex flex-col gap-1.5 p-3">
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
            className="w-full truncate rounded bg-zinc-800 px-2 py-0.5 text-sm font-medium text-white outline-none ring-1 ring-orange-500"
          />
        ) : (
          <p className="truncate font-medium text-white">{project.title}</p>
        )}
        <div className="flex items-center justify-between">
          <StatusBadge status={project.status} />
          <span className="text-xs text-zinc-500">{date}</span>
        </div>
      </div>
    </div>
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
  const [deleteConfirm, setDeleteConfirm] = React.useState<string | null>(null);
  const [historyProject, setHistoryProject] = React.useState<ProjectSummary | null>(null);

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

  const deleteMutation = useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: () => {
      setDeleteConfirm(null);
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  const renameMutation = useMutation({
    mutationFn: ({ projectId, title }: { projectId: string; title: string }) =>
      projectsApi.patch(projectId, { title }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
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
                onDelete={() => setDeleteConfirm(project.id)}
                onRename={(title) => renameMutation.mutate({ projectId: project.id, title })}
                onShowHistory={() => setHistoryProject(project)}
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

      {/* Render history modal */}
      {historyProject && (
        <RenderHistoryModal
          projectId={historyProject.id}
          projectTitle={historyProject.title}
          currentStyle={null}
          onClose={() => setHistoryProject(null)}
        />
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-xl">
            <h3 className="text-base font-semibold text-white">Delete project?</h3>
            <p className="mt-2 text-sm text-zinc-400">
              This will permanently delete the video and all its subtitles. This cannot be undone.
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMutation.mutate(deleteConfirm)}
                disabled={deleteMutation.isPending}
                className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:opacity-60"
              >
                {deleteMutation.isPending && <Spinner sizeRem={0.875} />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
