import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { style } from "./screens/editor/Style.gen";
import { useChunksState } from "./screens/editor/ChunksList/ChunksList.gen";
import RenderWorker from "./codecs/render-worker?worker";
import { Spinner } from "./ui/Spinner";
import { LandingDropzone } from "./screens/LandingDropzone";
import { Progress } from "./ui/Progress.gen";
import { makeEditorContextComponent, useEditorContext } from "./screens/editor/EditorContext.gen";
import { Transition } from "@headlessui/react";
import type {
  Target,
  RenderWorkerMessage,
  ConfigSupportResponseMessage,
  RenderProgressMessage,
  OutputFormat,
  OutputVideoCodec,
  OutputAudioCodec,
} from "./codecs/render-worker";
import { ShowErrorContext, UserFacingError } from "./ErrorBoundary";
import { log } from "./hooks/useAnalytics";
import HeartIcon from "@heroicons/react/20/solid/HeartIcon";
import { ProductHuntIcon } from "./ui/Icons.res.mjs";
import {
  projectsApi,
  uploadApi,
  uploadFileToS3,
  getVideoMetadata,
  renderApi,
  type ProjectDetail,
  type SubtitleCue,
  type WordChunk,
} from "./api/client";
import { useAutoSave } from "./hooks/useAutoSave";
import Constants from "./transcriber/Constants";

const Editor = React.lazy(() =>
  import("./screens/editor/Editor.gen").then((m) => ({ default: m.Editor })),
);

type VideoFile = {
  name: string;
  file: File | null;       // null when loaded from server (objectURL comes from presigned URL)
  objectURL: string;
  audioBuffer: AudioBuffer;
  audioCtx: AudioContext;
};

export type ProgressItem = {
  id: string;
  title: string;
  progress: number;
};

type FormatConfig = {
  extension: string;
  mimeType: string;
  description: string;
};

const FORMAT_CONFIGS: Record<OutputFormat, FormatConfig> = {
  mp4: { extension: ".mp4", mimeType: "video/mp4", description: "MP4 Video" },
  webm: { extension: ".webm", mimeType: "video/webm", description: "WebM Video" },
  mov: { extension: ".mov", mimeType: "video/quicktime", description: "QuickTime Video" },
};

function getOutputFileName(originalName: string, format: OutputFormat): string {
  return `transcribed_${originalName.replace(/\.[^/.]+$/, "")}${FORMAT_CONFIGS[format].extension}`;
}

async function createTarget(name: string, format: OutputFormat): Promise<Target> {
  const suggestedName = getOutputFileName(name, format);
  const config = FORMAT_CONFIGS[format];
  if ("showSaveFilePicker" in window) {
    const fileHandle = await (window as any).showSaveFilePicker({
      suggestedName,
      types: [{ description: config.description, accept: { [config.mimeType]: [config.extension] } }],
    });
    return { type: "filehandle", handle: fileHandle };
  }
  return { type: "arraybuffer", fileName: suggestedName };
}

function saveTarget(target: Target, format: OutputFormat) {
  if (target.type === "populated_arraybuffer") {
    const config = FORMAT_CONFIGS[format];
    const blob = new Blob([target.arrayBuffer!], { type: config.mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = target.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}

type EditorMode =
  | { type: "landing" }
  | { type: "uploading"; progress: number }
  | { type: "polling" }
  | { type: "loading_project" }
  | { type: "transcription_error"; message: string }
  | { type: "ready" };

function StyleSyncBridge({
  onStyle,
  onStyleVersion,
}: {
  onStyle: (s: Record<string, unknown>) => void;
  onStyleVersion: React.Dispatch<React.SetStateAction<number>>;
}) {
  const ctx = useEditorContext();
  const [style] = ctx.useStyle();
  React.useEffect(() => {
    onStyle({
      ...(style as unknown as Record<string, unknown>),
      _videoWidth: ctx.videoMeta.width,
      _videoHeight: ctx.videoMeta.height,
    });
    onStyleVersion((v) => v + 1);
  }, [style]);
  return null;
}

export default function EditorPage() {
  const failWith = React.useContext(ShowErrorContext);
  const params = useParams({ strict: false }) as { projectId?: string };
  const navigate = useNavigate();
  const projectId = params.projectId;

  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const rendererPreviewCanvasRef = React.useRef<HTMLCanvasElement>(null);
  const [progressItems, setProgressItems] = React.useState<ProgressItem[]>([]);

  const [mode, setMode] = React.useState<EditorMode>(
    projectId ? { type: "loading_project" } : { type: "landing" }
  );
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [file, setFile] = React.useState<VideoFile | null>(null);
  const [project, setProject] = React.useState<ProjectDetail | null>(null);
  const [serverCues, setServerCues] = React.useState<SubtitleCue[]>([]);
  const [language, setLanguage] = React.useState("en");

  const liveStyleJsonRef = React.useRef<Record<string, unknown> | null>(null);
  const [styleVersion, setStyleVersion] = React.useState(0);

  const [renderState, setRenderState] = React.useState<"idle" | "rendering" | "done" | "error" | "server_rendering" | "server_done">("idle");
  const [renderError, setRenderError] = React.useState<string | null>(null);
  const [serverDownloadUrl, setServerDownloadUrl] = React.useState<string | null>(null);
  const resetPlayerStateRef = React.useRef<(() => void) | null>(null);
  const [renderCanvasKey, setRenderCanvasKey] = React.useState(0);

  const videoRef = React.useRef<HTMLVideoElement>(null);
  const timelineVideoRef = React.useRef<HTMLVideoElement>(null);

  const [EditorContext, setEditorContext] = React.useState<{
    make: (props: any) => React.ReactElement;
  } | null>(null);

  // ── Load existing project on mount ─────────────────────────────────────────

  React.useEffect(() => {
    if (!projectId) {
      setMode({ type: "landing" });
      return;
    }

    let cancelled = false;

    async function load() {
      if (!projectId) return;
      try {
        const proj = await projectsApi.get(projectId);
        if (cancelled) return;

        if (proj.status === "ready") {
          await initFromProject(proj);
        } else if (proj.status === "error") {
          setMode({ type: "transcription_error", message: proj.errorMessage ?? "Transcription failed" });
        } else {
          setProject(proj);
          setMode({ type: "polling" });
        }
      } catch (e) {
        if (!cancelled) failWith(e);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [projectId]);

  // ── Poll for transcription completion ──────────────────────────────────────

  React.useEffect(() => {
    if (mode.type !== "polling" || !projectId) return;

    let cancelled = false;
    const MAX_POLL_MS = 10 * 60 * 1000;
    const start = Date.now();

    async function poll() {
      while (!cancelled && Date.now() - start < MAX_POLL_MS) {
        await new Promise((r) => setTimeout(r, 3000));
        if (cancelled) return;
        const status = await projectsApi.getStatus(projectId!).catch(() => null);
        if (!status || cancelled) return;

        if (status.status === "ready") {
          const proj = await projectsApi.get(projectId!);
          if (!cancelled) await initFromProject(proj);
          return;
        }
        if (status.status === "error") {
          if (!cancelled)
            setMode({ type: "transcription_error", message: status.errorMessage ?? "Transcription failed" });
          return;
        }
      }
      if (!cancelled)
        setMode({ type: "transcription_error", message: "Transcription timed out. Please try again." });
    }

    poll().catch(failWith);
    return () => { cancelled = true; };
  }, [mode.type, projectId]);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function initFromProject(proj: ProjectDetail) {
    if (!proj.videoUrl) return;
    setProject(proj);
    setServerCues(proj.cues);

    // Fetch the video blob from S3 presigned URL so the canvas player works
    const videoBlob = await fetch(proj.videoUrl).then((r) => r.blob());
    const objectURL = URL.createObjectURL(videoBlob);

    const audioCtx = new AudioContext({ sampleRate: Constants.SAMPLING_RATE });
    const arrayBuffer = await videoBlob.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    setFile({
      name: proj.title ?? "video",
      file: null,
      objectURL,
      audioBuffer,
      audioCtx,
    });
    setMode({ type: "ready" });
  }

  async function readAndPrepareAudioContext(blob: Blob): Promise<{ audioBuffer: AudioBuffer; audioCtx: AudioContext }> {
    try {
      const audioCtx = new AudioContext({ sampleRate: Constants.SAMPLING_RATE });
      const arrayBuffer = await blob.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      return { audioBuffer, audioCtx };
    } catch (e) {
      throw new UserFacingError("We couldn't find a decodable audio stream in your video", e);
    }
  }

  async function validateFileCodecSupported(file: File) {
    const worker = new RenderWorker();
    worker.postMessage({ type: "validate", payload: { dataUri: file } } as RenderWorkerMessage);
    return new Promise<boolean>((res, rej) =>
      worker.addEventListener(
        "message",
        ({ data }: MessageEvent<ConfigSupportResponseMessage>) => {
          if (data.type === "error") rej(new UserFacingError(data.message, data.error));
          if (data.type === "config-support") {
            if (data.encoderSupported && data.decoderSupported && data.encoderConfig) {
              res(true);
            } else {
              const which =
                !data.encoderSupported && !data.decoderSupported
                  ? "both encoding and decoding"
                  : !data.encoderSupported
                  ? "encoding"
                  : "decoding";
              rej(new UserFacingError(`Your browser does not support ${which} for your video file codec.`, new Error("WebCodecs unsupported")));
            }
          }
        },
        { once: true }
      )
    ).finally(() => worker.terminate());
  }

  // ── New project upload flow ─────────────────────────────────────────────────

  const onFile = async (acceptedFiles: File[]) => {
    const f = acceptedFiles[0];
    if (!f) return;

    log("video_uploaded");
    document.title = `Uploading ${f.name}…`;

    try {
      await validateFileCodecSupported(f);

      setMode({ type: "uploading", progress: 0 });

      // 1. Get presigned URL (creates project row)
      const { projectId: pid, uploadUrl } = await uploadApi.getPresignedUrl(
        f.name, f.type, f.size, language
      );

      // 2. Upload directly to S3
      await uploadFileToS3(uploadUrl, f, (pct) => {
        setUploadProgress(pct);
        setMode({ type: "uploading", progress: pct });
      });

      // 3. Read video metadata locally
      const meta = await getVideoMetadata(f);

      // 4. Tell server upload is done → triggers transcription
      await uploadApi.complete(pid, meta.duration, meta.width, meta.height);

      // 5. Navigate to editor — will enter polling mode
      navigate({ to: `/editor/${pid}` });
    } catch (e) {
      failWith(e);
      setMode({ type: "landing" });
    }
  };

  // ── Subtitle state (server cues fed in; ReScript editor unchanged) ──────────

  const subtitlesManager = useChunksState(
    serverCues,
    false, // transcriptionInProgress = false — server already did the work
    Constants.DEFAULT_CHUNK_THRESHOLD_CHARS,
  );

  // ── Auto-save ───────────────────────────────────────────────────────────────

  const saveStatus = useAutoSave(
    projectId ?? null,
    mode.type === "ready" ? subtitlesManager : null,
    mode.type === "ready" ? () => liveStyleJsonRef.current : null,
    styleVersion,
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const handleBackToEditor = React.useCallback(() => {
    setRenderState("idle");
    setServerDownloadUrl(null);
    resetPlayerStateRef.current?.();
    setRenderCanvasKey((k) => k + 1);
  }, []);

  const render = React.useCallback(
    async (style: style, outputFormat: string = "mp4", videoCodec?: string, audioCodec?: string, renderMode: string = "client") => {
      log("video_render_started");
      if (!file) return Promise.reject(new Error("No file"));

      // ── Server render path ────────────────────────────────────────────────
      if (renderMode === "server") {
        const token = localStorage.getItem("subtitle_app_token");
        if (!token) {
          setRenderError("Sign in to use server render.");
          setRenderState("error");
          return;
        }

        setRenderState("server_rendering");
        setServerDownloadUrl(null);

        try {
          // If no project yet, upload the video first then save cues
          let pid = projectId;
          if (!pid) {
            if (!file.file) {
              setRenderError("Original video file is not available for upload.");
              setRenderState("error");
              return;
            }
            const meta = await getVideoMetadata(file.file);
            const { projectId: newPid, uploadUrl } = await uploadApi.getPresignedUrl(
              file.file.name, file.file.type, file.file.size, language
            );
            await uploadFileToS3(uploadUrl, file.file);
            await uploadApi.complete(newPid, meta.duration, meta.width, meta.height);
            pid = newPid;
            // Navigate so the URL reflects the new project and projectId state updates
            navigate({ to: `/editor/${newPid}` });
          }

          const cues = subtitlesManager.activeSubtitles.map((c: any) => ({
            text: c.text,
            startTime: c.timestamp[0],
            endTime: c.timestamp[1] ?? null,
          }));

          // Save current cues to the project before rendering
          await projectsApi.patch(pid, {
            cues: subtitlesManager.activeSubtitles.map((c: any) => ({
              text: c.text,
              timestamp: c.timestamp,
            })),
            styleJson: style as unknown as Record<string, unknown>,
          });

          const { jobId } = await renderApi.start(
            pid,
            cues,
            style as unknown as Record<string, unknown>,
          );

          const poll = async () => {
            while (true) {
              await new Promise((r) => setTimeout(r, 3000));
              const status = await renderApi.getStatus(pid!, jobId);
              if (status.status === "done" && status.downloadUrl) {
                setServerDownloadUrl(status.downloadUrl);
                setRenderState("server_done");
                log("video_rendered");
                return;
              }
              if (status.status === "error") {
                setRenderError(status.errorMessage ?? "Server render failed");
                setRenderState("error");
                return;
              }
            }
          };
          poll().catch((e) => {
            setRenderError(e instanceof Error ? e.message : String(e));
            setRenderState("error");
          });
        } catch (e) {
          setRenderError(e instanceof Error ? e.message : String(e));
          setRenderState("error");
        }
        return;
      }
      // ── Client render path (existing) ────────────────────────────────────

      const validFormat: OutputFormat =
        outputFormat === "webm" ? "webm" : outputFormat === "mov" ? "mov" : "mp4";
      const validVideoCodec: OutputVideoCodec | undefined =
        videoCodec && ["avc", "hevc", "vp9", "vp8", "av1"].includes(videoCodec) ? (videoCodec as OutputVideoCodec) : undefined;
      const validAudioCodec: OutputAudioCodec | undefined =
        audioCodec && ["aac", "opus", "mp3", "vorbis", "flac"].includes(audioCodec) ? (audioCodec as OutputAudioCodec) : undefined;

      // Show render page immediately so the user sees progress — file picker
      // (if any) will appear on top of it. Must happen before any await so
      // React commits the canvas to the DOM before we call transferControlToOffscreen.
      setRenderState("rendering");
      setProgressItems([
        { id: "filereadprogress", title: "Reading file", progress: 0 },
        { id: "renderprogress", title: "Rendering frames", progress: 0 },
      ]);

      try {
        // Wait one frame so React flushes the render-page state and mounts the
        // rendererPreviewCanvas before we try to grab it.
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

        if (!rendererPreviewCanvasRef.current) {
          throw new Error("Canvas not ready — please try again.");
        }

        const offscreenCanvas = rendererPreviewCanvasRef.current.transferControlToOffscreen();

        // Fetch dataUri and open file picker in parallel — both happen after the
        // canvas is transferred so the user gesture is still live.
        const [dataUri, target] = await Promise.all([
          file.file
            ? Promise.resolve(file.file)
            : fetch(file.objectURL).then((r) => r.arrayBuffer()).then((buf) => new Blob([buf])),
          createTarget(file.name, validFormat),
        ]);

        const worker = new RenderWorker();

        worker.addEventListener("message", (e: MessageEvent<RenderProgressMessage>) => {
          if (e.data.type === "error") {
            setRenderError(e.data.message);
            setRenderState("error");
            setProgressItems([]);
            worker.terminate();
          }
          if (e.data.type === "done") {
            log("video_rendered");
            saveTarget(e.data.target, e.data.outputFormat);
            document.title = `✅ Subtitles rendered!`;
            setRenderState("done");
            setProgressItems([]);
            worker.terminate();
            import("js-confetti").then(({ default: JsConfetti }) => new JsConfetti().addConfetti());
          }
          if (
            e.data.type === "renderprogress" ||
            e.data.type === "encodeprogress" ||
            e.data.type === "filereadprogress"
          ) {
            const progress = e.data.progress;
            setProgressItems((prev) =>
              prev.map((item) => (item.id === e.data.type ? { ...item, progress } : item))
            );
            if (e.data.type === "renderprogress")
              document.title = `${Math.floor(progress)}% — subtitles for ${file.name}`;
          }
        });

        worker.postMessage(
          {
            type: "render",
            payload: {
              style,
              target,
              dataUri,
              canvas: offscreenCanvas,
              cues: subtitlesManager.activeSubtitles,
              outputFormat: validFormat,
              videoCodec: validVideoCodec,
              audioCodec: validAudioCodec,
              wordAnimationData:
                style.showWordAnimation &&
                subtitlesManager.transcriptionState !== "TranscriptionInProgress"
                  ? {
                      wordChunks: subtitlesManager.transcriptionState.wordChunks,
                      cueRanges: subtitlesManager.transcriptionState.cueRanges,
                    }
                  : undefined,
            },
          } as RenderWorkerMessage,
          [offscreenCanvas]
        );
      } catch (e) {
        // User cancelled file picker (AbortError) — silently go back to editor.
        // Any other error — show it on the render page.
        if (e instanceof Error && e.name === "AbortError") {
          setRenderState("idle");
          setProgressItems([]);
        } else {
          setRenderError(e instanceof Error ? e.message : String(e));
          setRenderState("error");
          setProgressItems([]);
        }
        return Promise.reject(e);
      }
    },
    [subtitlesManager, file]
  );


  const handleMetadataLoad = React.useCallback(
    (e: React.FormEvent<HTMLVideoElement>) => {
      if (!EditorContext) {
        const component = makeEditorContextComponent(
          {
            duration: e.currentTarget.duration,
            width: e.currentTarget.videoWidth,
            height: e.currentTarget.videoHeight,
          },
          videoRef,
          timelineVideoRef,
          subtitlesManager.subtitlesRef,
          canvasRef,
          file?.audioBuffer,
        );
        setEditorContext(component);
      }
    },
    [file]
  );

  // ── Render modes ────────────────────────────────────────────────────────────

  if (mode.type === "landing") {
    return (
      <LandingDropzone
        onDrop={onFile}
        language={language}
        setLanguage={setLanguage}
      />
    );
  }

  if (mode.type === "uploading") {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 flex-col h-dvh md:h-screen">
        <GridBackground />
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4">
          <Spinner sizeRem={3} />
          <h1 className="text-2xl md:text-5xl text-center">Uploading video</h1>
        </div>
        <p className="text-center text-gray-400 text-sm md:text-base mt-4">
          Uploading your video to the server…
        </p>
        <div className="w-full mt-8 max-w-[34rem] px-4">
          <Progress name="Upload" progress={uploadProgress} />
        </div>
      </div>
    );
  }

  if (mode.type === "polling") {
    return (
      <div className="container mx-auto flex items-center justify-center px-4 flex-col h-dvh md:h-screen">
        <GridBackground />
        <div className="flex flex-col md:flex-row items-center justify-center gap-3 md:gap-4">
          <Spinner sizeRem={3} />
          <h1 className="text-2xl md:text-5xl text-center">Transcribing</h1>
        </div>
        <p className="text-center text-gray-400 text-sm md:text-base mt-4 max-w-md text-balance">
          The server is transcribing your video with Whisper AI. The editor will appear shortly.
        </p>
      </div>
    );
  }

  if (mode.type === "loading_project") {
    return (
      <div className="flex h-dvh items-center justify-center bg-zinc-900">
        <Spinner sizeRem={3} />
      </div>
    );
  }

  if (mode.type === "transcription_error") {
    return (
      <div className="flex flex-col h-dvh items-center justify-center bg-zinc-900 px-4 text-center">
        <h1 className="text-2xl md:text-4xl font-bold text-red-400 mb-3">Transcription Failed</h1>
        <p className="text-gray-400 max-w-md mb-6">{mode.message}</p>
        <button
          onClick={() => navigate({ to: "/dashboard" })}
          className="rounded-lg bg-orange-600 px-6 py-3 font-medium text-white hover:bg-orange-500 transition-colors"
        >
          ← Back to dashboard
        </button>
      </div>
    );
  }

  // mode === "ready"
  return (
    <>
      <video ref={videoRef} className="hidden" src={file?.objectURL} onLoadedMetadata={handleMetadataLoad} />
      <video muted ref={timelineVideoRef} className="hidden" src={file?.objectURL} />

      {EditorContext && (
        <EditorContext.make>
          <StyleSyncBridge
            onStyle={(s) => { liveStyleJsonRef.current = s; }}
            onStyleVersion={setStyleVersion}
          />
          <React.Suspense
            fallback={
              <div className="flex items-center justify-center h-dvh md:h-screen">
                <Spinner sizeRem={3} />
              </div>
            }
          >
            <Editor
              render={render}
              subtitlesManager={subtitlesManager}
              rendererPreviewCanvasRef={rendererPreviewCanvasRef}
              renderCanvasKey={renderCanvasKey}
              videoFileName={file?.name ?? "video"}
              saveStatus={saveStatus}
              projectTitle={file?.name ?? project?.title ?? "Untitled"}
              projectId={projectId}
              onBack={() => navigate({ to: "/dashboard" })}
              onResetPlayerState={(fn: () => void) => {
                resetPlayerStateRef.current = fn;
              }}
            />
          </React.Suspense>
        </EditorContext.make>
      )}

      <Transition show={renderState !== "idle"}>
        <div className="fixed inset-0 z-[60] flex flex-col bg-zinc-950 transition duration-300 ease-in data-[closed]:opacity-0">
          {/* Render page header */}
          <header className="flex items-center gap-3 border-b border-zinc-800 px-4 py-3 md:px-6 shrink-0">
            {renderState !== "rendering" && renderState !== "server_rendering" && (
              <button
                onClick={handleBackToEditor}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back to editor
              </button>
            )}
            <span className="flex-1 truncate text-sm font-medium text-white text-center pr-20">
              {file?.name ?? project?.title ?? "Untitled"}
            </span>
          </header>

          {/* Render page body */}
          <div className="flex flex-1 flex-col items-center justify-center px-4">

            {renderState === "rendering" && (
              <div className="flex w-full max-w-lg flex-col items-center gap-6">
                {/* Animated ring */}
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 80 80">
                    <circle cx="40" cy="40" r="34" fill="none" stroke="#27272a" strokeWidth="6" />
                    <circle
                      cx="40" cy="40" r="34"
                      fill="none"
                      stroke="#f97316"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeDasharray={`${2 * Math.PI * 34}`}
                      strokeDashoffset={`${2 * Math.PI * 34 * (1 - (progressItems.find(i => i.id === "renderprogress")?.progress ?? 0) / 100)}`}
                      className="transition-all duration-300"
                    />
                  </svg>
                  <span className="text-sm font-semibold text-white tabular-nums">
                    {`${Math.floor(progressItems.find(i => i.id === "renderprogress")?.progress ?? 0)}%`}
                  </span>
                </div>

                <div className="text-center">
                  <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
                    Rendering your video
                  </h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    Feel free to switch tabs — it continues in the background.
                  </p>
                </div>

                <div className="w-full flex flex-col gap-3">
                  {progressItems.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between text-xs text-zinc-400">
                        <span>{item.title}</span>
                        <span className="tabular-nums">{Math.floor(item.progress ?? 0)}%</span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-orange-500 transition-all duration-300"
                          style={{ width: `${item.progress ?? 0}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {renderState === "error" && (
              <div className="flex max-w-md flex-col items-center gap-4 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-500/10">
                  <svg className="h-8 w-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-red-400">Rendering Failed</h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    {renderError || "An unknown error occurred during rendering."}
                  </p>
                </div>
                <button
                  onClick={handleBackToEditor}
                  className="rounded-lg border border-zinc-700 px-4 py-2 text-sm text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
                >
                  ← Back to editor
                </button>
              </div>
            )}

            {renderState === "done" && (
              <div className="flex max-w-md flex-col items-center gap-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Video Rendered!</h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    Your video with subtitles has been saved. Time for publishing!
                  </p>
                </div>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <a
                    href="https://www.producthunt.com/products/fframes-subtitles/reviews/new"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-orange-500"
                  >
                    <ProductHuntIcon.make className="size-4 text-orange-200" />
                    Leave a Review
                  </a>
                  <a
                    href="https://github.com/sponsors/dmtrKovalenko"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-rose-500"
                  >
                    <HeartIcon className="size-4" />
                    Support Author
                  </a>
                </div>
                <button
                  onClick={handleBackToEditor}
                  className="text-sm text-zinc-500 underline underline-offset-4 transition-colors hover:text-zinc-300"
                >
                  ← Back to editor
                </button>
              </div>
            )}

            {renderState === "server_rendering" && (
              <div className="flex w-full max-w-lg flex-col items-center gap-6">
                <div className="relative flex h-20 w-20 items-center justify-center">
                  <Spinner sizeRem={3} />
                </div>
                <div className="text-center">
                  <h2 className="text-2xl font-bold tracking-tight text-white md:text-3xl">
                    Rendering on server
                  </h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    {projectId
                      ? "FFmpeg is burning ASS subtitles into your video. This may take a minute."
                      : "Uploading video then rendering with FFmpeg + ASS subtitles…"}
                  </p>
                </div>
              </div>
            )}

            {renderState === "server_done" && serverDownloadUrl && (
              <div className="flex max-w-md flex-col items-center gap-6 text-center">
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                  <svg className="h-8 w-8 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white">Server Render Complete!</h2>
                  <p className="mt-2 text-sm text-zinc-400">
                    Your video was rendered with FFmpeg + ASS subtitles.
                  </p>
                </div>
                <a
                  href={serverDownloadUrl}
                  download
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-orange-500"
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Download Video
                </a>
                <button
                  onClick={handleBackToEditor}
                  className="text-sm text-zinc-500 underline underline-offset-4 transition-colors hover:text-zinc-300"
                >
                  ← Back to editor
                </button>
              </div>
            )}

          </div>
        </div>
      </Transition>
    </>
  );
}

function GridBackground() {
  return (
    <svg className="absolute inset-0 -z-10 h-full w-full stroke-white/10 [mask-image:radial-gradient(100%_100%_at_top_right,white,transparent)]" aria-hidden="true">
      <defs>
        <pattern id="grid-bg" width={200} height={200} x="50%" y={-1} patternUnits="userSpaceOnUse">
          <path d="M.5 200V.5H200" fill="none" />
        </pattern>
      </defs>
      <svg x="50%" y={-1} className="overflow-visible fill-gray-800/20">
        <path d="M-200 0h201v201h-201Z M600 0h201v201h-201Z M-400 600h201v201h-201Z M200 800h201v201h-201Z" strokeWidth={0} />
      </svg>
      <rect width="100%" height="100%" strokeWidth={0} fill="url(#grid-bg)" />
    </svg>
  );
}
