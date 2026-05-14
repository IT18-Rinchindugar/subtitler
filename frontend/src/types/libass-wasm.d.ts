declare module "libass-wasm" {
  interface SubtitlesOctopusOptions {
    canvas?: HTMLCanvasElement;
    video?: HTMLVideoElement;
    subUrl?: string;
    subContent?: string;
    workerUrl?: string;
    legacyWorkerUrl?: string;
    fonts?: string[];
    availableFonts?: Record<string, string>;
    lazyFileLoading?: boolean;
    renderAhead?: number;
    onReady?: () => void;
    onError?: (e: unknown) => void;
  }

  class SubtitlesOctopus {
    constructor(options: SubtitlesOctopusOptions);
    setCurrentTime(currentTime: number): void;
    freeTrack(): void;
    dispose(): void;
  }

  export = SubtitlesOctopus;
}
