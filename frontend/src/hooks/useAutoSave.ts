import * as React from "react";
import { projectsApi } from "../api/client";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useAutoSave(
  projectId: string | null,
  subtitlesManager: any | null,
  getStyleJson: (() => Record<string, unknown> | null) | null,
  styleVersion: number = 0
): SaveStatus {
  const [status, setStatus] = React.useState<SaveStatus>("idle");
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef(false);

  const activeSubtitles = subtitlesManager?.activeSubtitles;
  const transcriptionState = subtitlesManager?.transcriptionState;

  React.useEffect(() => {
    if (!projectId || !subtitlesManager) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = true;

    timerRef.current = setTimeout(async () => {
      if (!pendingRef.current) return;
      pendingRef.current = false;
      setStatus("saving");

      try {
        const wordChunks =
          transcriptionState && transcriptionState !== "TranscriptionInProgress"
            ? transcriptionState.wordChunks
            : undefined;

        const cues = activeSubtitles?.map((cue: any) => ({
          text: cue.text,
          timestamp: cue.timestamp,
          wordChunks: wordChunks
            ? wordChunks.filter(
                (w: any) =>
                  w.timestamp[0] >= cue.timestamp[0] &&
                  (cue.timestamp[1] === null || w.timestamp[0] <= cue.timestamp[1])
              )
            : undefined,
        }));

        const styleJson = getStyleJson?.();
        await projectsApi.patch(projectId, {
          cues,
          ...(styleJson ? { styleJson } : {}),
        });

        setStatus("saved");
        setTimeout(() => setStatus("idle"), 2000);
      } catch {
        setStatus("error");
        setTimeout(() => setStatus("idle"), 3000);
      }
    }, 2000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeSubtitles, styleVersion, projectId]);

  return status;
}
