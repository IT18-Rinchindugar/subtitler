import * as React from "react";
import { useParams, useNavigate } from "@tanstack/react-router";
import { style } from "./screens/editor/Style.gen";
import { useChunksState } from "./screens/editor/ChunksList/ChunksList.gen";
import RenderWorker from "./codecs/render-worker?worker";
import { Spinner } from "./ui/Spinner";
import { LandingDropzone } from "./screens/LandingDropzone";
import { Progress } from "./ui/Progress.gen";
import { makeEditorContextComponent } from "./screens/editor/EditorContext.gen";
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
import clsx from "clsx";
import { ShowErrorContext, UserFacingError } from "./ErrorBoundary";
import { log } from "./hooks/useAnalytics";
import HeartIcon from "@heroicons/react/20/solid/HeartIcon";
import { ProductHuntIcon } from "./ui/Icons.res.mjs";
import {
  projectsApi,
  uploadApi,
  uploadFileToS3,
  getVideoMetadata,
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

  const [renderState, setRenderState] = React.useState<"idle" | "rendering" | "done" | "error">("idle");
  const [renderError, setRenderError] = React.useState<string | null>(null);
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
      name: proj.videoFilename,
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
    mode.type === "ready" ? project?.styleJson ?? null : null
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  const handleBackToEditor = React.useCallback(() => {
    setRenderState("idle");
    resetPlayerStateRef.current?.();
    setRenderCanvasKey((k) => k + 1);
  }, []);

  const render = React.useCallback(
    async (style: style, outputFormat: string = "mp4", videoCodec?: string, audioCodec?: string) => {
      log("video_render_started");
      const worker = new RenderWorker();
      if (!file || !rendererPreviewCanvasRef.current) return Promise.reject();

      const offscreenCanvas = rendererPreviewCanvasRef.current.transferControlToOffscreen();
      if (!offscreenCanvas) return Promise.reject();

      const validFormat: OutputFormat =
        outputFormat === "webm" ? "webm" : outputFormat === "mov" ? "mov" : "mp4";
      const validVideoCodec: OutputVideoCodec | undefined =
        videoCodec && ["avc", "hevc", "vp9", "vp8", "av1"].includes(videoCodec) ? (videoCodec as OutputVideoCodec) : undefined;
      const validAudioCodec: OutputAudioCodec | undefined =
        audioCodec && ["aac", "opus", "mp3", "vorbis", "flac"].includes(audioCodec) ? (audioCodec as OutputAudioCodec) : undefined;

      const target = await createTarget(file.name, validFormat);
      setRenderState("rendering");
      setProgressItems([
        { id: "filereadprogress", title: "Reading file", progress: 0 },
        { id: "renderprogress", title: "Rendering frames", progress: 0 },
      ]);

      worker.postMessage(
        {
          type: "render",
          payload: {
            style,
            target,
            dataUri: file.file ?? new Blob([await fetch(file.objectURL).then((r) => r.arrayBuffer())]),
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
              onResetPlayerState={(fn: () => void) => {
                resetPlayerStateRef.current = fn;
              }}
            />
          </React.Suspense>
        </EditorContext.make>
      )}

      <Transition show={renderState !== "idle"}>
        <div
          className={clsx(
            "transition flex-col absolute z-[60] w-screen h-dvh md:h-screen bg-white/10 backdrop-blur-xl inset-0 duration-300 ease-in data-[closed]:opacity-0 flex items-center justify-center px-4",
            renderState === "done" && "!bg-green-600/10 !backdrop-blur-2xl",
            renderState === "error" && "!bg-red-600/10 !backdrop-blur-2xl",
          )}
        >
          {renderState === "rendering" && (
            <>
              <h2 className="text-2xl md:text-5xl text-center tracking-wide font-bold">
                Rendering your video
              </h2>
              <p className="text-gray-300 text-balance text-center text-sm md:text-lg max-w-screen-sm mt-4">
                Your video with subtitles is being rendered. Feel free to switch tabs — it continues in the background.
              </p>
              <div className="w-full flex flex-col gap-y-2 mt-6 md:mt-8 max-w-[34rem]">
                {progressItems.map((item) => (
                  <Progress key={item.id} name={item.title} progress={item.progress ?? 0} />
                ))}
              </div>
            </>
          )}

          {renderState === "error" && (
            <>
              <h2 className="text-2xl md:text-5xl text-center tracking-wide font-bold text-red-400">
                Rendering Failed
              </h2>
              <p className="text-gray-200 text-balance text-center max-w-screen-sm text-sm md:text-lg mt-4">
                {renderError || "An unknown error occurred during rendering."}
              </p>
              <button onClick={handleBackToEditor} className="mt-6 text-gray-300 hover:text-white underline underline-offset-4 transition">
                ← Back to editor
              </button>
            </>
          )}

          {renderState === "done" && (
            <>
              <h2 className="text-2xl md:text-5xl text-center tracking-wide font-bold">
                Video Rendered!
              </h2>
              <p className="text-gray-200 text-balance text-center max-w-screen-sm text-sm md:text-lg mt-4">
                You'll find your video at the location you selected. Time for publishing!
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center mt-6">
                <a
                  href="https://www.producthunt.com/products/fframes-subtitles/reviews/new"
                  rel="noopener noreferrer"
                  className="mx-auto outline-none focus-visible:ring ring-orange-500 ring-offset-zinc-900 ring-offset-2 hover:bg-orange-400 transition rounded-lg gap-2 bg-orange-600 inline-flex items-center px-4 py-3 font-medium text-sm md:text-base"
                >
                  <ProductHuntIcon.make className="size-5 md:size-6 text-orange-500" />
                  Leave a Review
                </a>
                <a
                  href="https://github.com/sponsors/dmtrKovalenko"
                  rel="noopener noreferrer"
                  className="mx-auto outline-none focus-visible:ring ring-rose-500 ring-offset-zinc-900 ring-offset-2 hover:bg-rose-400 transition rounded-lg bg-rose-600 gap-2 inline-flex items-center px-4 py-3 font-medium text-sm md:text-base"
                >
                  <HeartIcon className="size-5 md:size-6" />
                  Support Author
                </a>
              </div>
              <button onClick={handleBackToEditor} className="mt-6 text-gray-300 hover:text-white underline underline-offset-4 transition text-sm md:text-base">
                ← Back to editor
              </button>
            </>
          )}
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
