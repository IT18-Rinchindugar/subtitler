// Controllable mock for fluent-ffmpeg used in render tests.
// Tests set ffmpegMock.shouldFail = true to simulate FFmpeg errors.

export const ffmpegMock = {
  shouldFail: false,
  lastVideoFilters: [] as string[],
  lastOutputOptions: [] as string[],
  lastInputPath: "",
  lastOutputPath: "",
  reset() {
    this.shouldFail = false;
    this.lastVideoFilters = [];
    this.lastOutputOptions = [];
    this.lastInputPath = "";
    this.lastOutputPath = "";
  },
};

function createChain(inputPath: string) {
  ffmpegMock.lastInputPath = inputPath;

  const chain: any = {
    videoFilters(filter: string) {
      ffmpegMock.lastVideoFilters.push(filter);
      return chain;
    },
    outputOptions(opts: string[]) {
      ffmpegMock.lastOutputOptions.push(...opts);
      return chain;
    },
    output(outPath: string) {
      ffmpegMock.lastOutputPath = outPath;
      return chain;
    },
    on(event: string, cb: (...args: any[]) => void) {
      if (event === "end" && !ffmpegMock.shouldFail) {
        setImmediate(cb);
      }
      if (event === "error" && ffmpegMock.shouldFail) {
        setImmediate(() => cb(new Error("FFmpeg mock error")));
      }
      return chain;
    },
    run() {
      return chain;
    },
  };

  return chain;
}

export default createChain;
