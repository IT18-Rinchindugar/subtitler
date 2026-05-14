import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { renderApi, type RenderVersion } from "../../api/client";
import { Spinner } from "../../ui/Spinner";

function diffStyles(
  current: Record<string, unknown> | null,
  snapshot: Record<string, unknown> | null
): Array<{ key: string; from: unknown; to: unknown }> {
  const curr = current ?? {};
  const snap = snapshot ?? {};
  const allKeys = new Set([...Object.keys(curr), ...Object.keys(snap)]);
  return [...allKeys]
    .filter((k) => !k.startsWith("_"))
    .filter((k) => JSON.stringify(curr[k]) !== JSON.stringify(snap[k]))
    .map((k) => ({ key: k, from: snap[k], to: curr[k] }));
}

function StyleDiff({
  currentStyle,
  snapshotStyle,
}: {
  currentStyle: Record<string, unknown> | null;
  snapshotStyle: Record<string, unknown> | null;
}) {
  const [open, setOpen] = React.useState(false);
  const diffs = diffStyles(currentStyle, snapshotStyle);

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        <svg
          className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        Style diff
        {diffs.length > 0 && (
          <span className="ml-1 rounded-full bg-orange-500/20 px-1.5 py-0.5 text-orange-400">
            {diffs.length} change{diffs.length !== 1 ? "s" : ""}
          </span>
        )}
      </button>
      {open && (
        <div className="mt-2 rounded-lg border border-zinc-700 bg-zinc-950 p-3">
          {diffs.length === 0 ? (
            <p className="text-xs text-zinc-500">No style changes vs current.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {diffs.map(({ key, from, to }) => (
                <li key={key} className="flex items-center gap-2 text-xs font-mono">
                  <span className="text-zinc-400 min-w-0 truncate">{key}</span>
                  <span className="text-red-400 truncate">{String(from ?? "—")}</span>
                  <svg className="h-3 w-3 shrink-0 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="text-green-400 truncate">{String(to ?? "—")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function VersionRow({
  version,
  currentStyle,
}: {
  version: RenderVersion;
  currentStyle: Record<string, unknown> | null;
}) {
  const [previewing, setPreviewing] = React.useState(false);
  const date = new Date(version.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="shrink-0 rounded-full bg-orange-500/15 px-2.5 py-0.5 text-xs font-semibold text-orange-400">
            v{version.versionNumber}
          </span>
          <span className="truncate text-sm text-zinc-400">{date}</span>
        </div>
        {version.downloadUrl ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => setPreviewing((p) => !p)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
            >
              {previewing ? (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Close
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Preview
                </>
              )}
            </button>
            <a
              href={version.downloadUrl}
              download
              className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download
            </a>
          </div>
        ) : (
          <span className="shrink-0 text-xs text-zinc-600">Unavailable</span>
        )}
      </div>

      {previewing && version.downloadUrl && (
        <div className="mt-3 overflow-hidden rounded-lg bg-black">
          <video
            src={version.downloadUrl}
            controls
            className="w-full max-h-64 object-contain"
          />
        </div>
      )}

      <StyleDiff currentStyle={currentStyle} snapshotStyle={version.styleJson} />
    </div>
  );
}

export function RenderHistoryModal({
  projectId,
  projectTitle,
  currentStyle,
  onClose,
}: {
  projectId: string;
  projectTitle: string;
  currentStyle: Record<string, unknown> | null;
  onClose: () => void;
}) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["render-history", projectId],
    queryFn: () => renderApi.getHistory(projectId),
    staleTime: 30_000,
  });

  // Newest first for display
  const versions = data ? [...data.versions].reverse() : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-zinc-700 bg-zinc-900 shadow-xl flex flex-col max-h-[80dvh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-white">Render history</h3>
            <p className="mt-0.5 text-xs text-zinc-500 truncate max-w-xs">{projectTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5">
          {isLoading && (
            <div className="flex items-center justify-center py-12">
              <Spinner sizeRem={2} />
            </div>
          )}
          {isError && (
            <p className="py-12 text-center text-sm text-red-400">Failed to load render history.</p>
          )}
          {data && versions.length === 0 && (
            <p className="py-12 text-center text-sm text-zinc-500">No completed renders yet.</p>
          )}
          {data && versions.length > 0 && (
            <div className="flex flex-col gap-3">
              {versions.map((v) => (
                <VersionRow
                  key={v.id}
                  version={v}
                  currentStyle={currentStyle}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
