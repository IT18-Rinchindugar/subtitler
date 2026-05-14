import fs from "fs";
import os from "os";
import path from "path";
import { generateAss } from "../services/assGenerator";
import type { SubtitleCue, SubtitleStyle } from "../services/assGenerator";
import { ffmpegMock } from "./__mocks__/fluent-ffmpeg";

// ── Helpers that mirror the production escaping logic in render.ts ────────────

function escapeAssPath(p: string): string {
  return p
    .replace(/\\/g, "/")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]");
}

function buildAssFilter(assPath: string): string {
  return `ass='${escapeAssPath(assPath)}'`;
}

// ── ASS path escaping ─────────────────────────────────────────────────────────

describe("ASS filter path escaping", () => {
  it("wraps path in single quotes", () => {
    const filter = buildAssFilter("/tmp/abc/subtitles.ass");
    expect(filter).toBe("ass='/tmp/abc/subtitles.ass'");
  });

  it("converts Windows backslashes to forward slashes", () => {
    const filter = buildAssFilter("C:\\tmp\\subtitle-render-xyz\\subtitles.ass");
    expect(filter).toContain("C:/tmp/subtitle-render-xyz/subtitles.ass");
  });

  it("escapes single quotes inside the path", () => {
    const filter = buildAssFilter("/tmp/it's a file/subtitles.ass");
    // The internal single quote must be backslash-escaped
    expect(filter).toContain("\\'");
    // Extract just the path between the outer quotes: ass='<path>'
    const inner = filter.slice(5, -1); // strip "ass='" prefix and trailing "'"
    expect(inner).not.toMatch(/(?<!\\)'/); // no unescaped single quote inside
  });

  it("escapes square brackets (lavfi special chars)", () => {
    const filter = buildAssFilter("/tmp/render[1]/subtitles.ass");
    expect(filter).toContain("\\[1\\]");
  });

  it("leaves normal Unix paths untouched", () => {
    const p = "/var/folders/subtitle-render-abc123/subtitles.ass";
    const filter = buildAssFilter(p);
    expect(filter).toBe(`ass='${p}'`);
  });
});

// ── ASS file written to disk ──────────────────────────────────────────────────

describe("ASS file disk output", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ass-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes a valid ASS file that FFmpeg can reference", () => {
    const cues: SubtitleCue[] = [
      { text: "Hello", startTime: 0, endTime: 2 },
      { text: "World", startTime: 3, endTime: 5 },
    ];
    const assPath = path.join(tmpDir, "subtitles.ass");
    const content = generateAss(cues, {}, 10);
    fs.writeFileSync(assPath, content, "utf-8");

    expect(fs.existsSync(assPath)).toBe(true);
    const written = fs.readFileSync(assPath, "utf-8");
    expect(written).toContain("[Script Info]");
    expect(written).toContain("Dialogue:");
    expect(written).toContain("Hello");
    expect(written).toContain("World");
  });

  it("written file contains correct cue count", () => {
    const cues: SubtitleCue[] = [
      { text: "A", startTime: 0, endTime: 1 },
      { text: "B", startTime: 2, endTime: 3 },
      { text: "C", startTime: 4, endTime: 5 },
    ];
    const content = generateAss(cues, {}, 10);
    const dialogueCount = (content.match(/^Dialogue:/gm) ?? []).length;
    expect(dialogueCount).toBe(3);
  });
});

// ── FFmpeg mock invocation ────────────────────────────────────────────────────

describe("FFmpeg invocation via mock", () => {
  beforeEach(() => ffmpegMock.reset());

  it("calls videoFilters with ass filter containing the .ass path", async () => {
    const ffmpeg = (await import("./__mocks__/fluent-ffmpeg")).default;
    const assPath = "/tmp/test/subtitles.ass";

    await new Promise<void>((resolve, reject) => {
      ffmpeg("/tmp/test/input.mp4")
        .videoFilters(buildAssFilter(assPath))
        .outputOptions(["-c:v libx264", "-preset fast", "-crf 18", "-c:a copy"])
        .output("/tmp/test/output.mp4")
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    expect(ffmpegMock.lastVideoFilters).toHaveLength(1);
    expect(ffmpegMock.lastVideoFilters[0]).toMatch(/^ass='/);
    expect(ffmpegMock.lastVideoFilters[0]).toContain("subtitles.ass");
  });

  it("passes libx264, crf 18, and faststart output options", async () => {
    const ffmpeg = (await import("./__mocks__/fluent-ffmpeg")).default;

    await new Promise<void>((resolve, reject) => {
      ffmpeg("/tmp/input.mp4")
        .videoFilters("ass='/tmp/sub.ass'")
        .outputOptions(["-c:v libx264", "-preset fast", "-crf 18", "-c:a copy", "-movflags +faststart"])
        .output("/tmp/output.mp4")
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    expect(ffmpegMock.lastOutputOptions).toContain("-c:v libx264");
    expect(ffmpegMock.lastOutputOptions).toContain("-crf 18");
    expect(ffmpegMock.lastOutputOptions).toContain("-movflags +faststart");
  });

  it("records the correct input and output paths", async () => {
    const ffmpeg = (await import("./__mocks__/fluent-ffmpeg")).default;

    await new Promise<void>((resolve, reject) => {
      ffmpeg("/media/input.mp4")
        .videoFilters("ass='/tmp/sub.ass'")
        .outputOptions([])
        .output("/media/output.mp4")
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    expect(ffmpegMock.lastInputPath).toBe("/media/input.mp4");
    expect(ffmpegMock.lastOutputPath).toBe("/media/output.mp4");
  });

  it("rejects the promise when FFmpeg fails", async () => {
    const ffmpeg = (await import("./__mocks__/fluent-ffmpeg")).default;
    ffmpegMock.shouldFail = true;

    await expect(
      new Promise<void>((resolve, reject) => {
        ffmpeg("/tmp/input.mp4")
          .videoFilters("ass='/tmp/sub.ass'")
          .outputOptions([])
          .output("/tmp/output.mp4")
          .on("end", resolve)
          .on("error", (err: Error) => reject(new Error(`FFmpeg failed: ${err.message}`)))
          .run();
      })
    ).rejects.toThrow("FFmpeg failed");
  });
});

// ── End-to-end: generate ASS → write to disk → build filter string ────────────

describe("full pipeline: cues → ASS file → FFmpeg filter", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-test-"));
    ffmpegMock.reset();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces a filter string pointing to a file that contains the cue text", async () => {
    const ffmpeg = (await import("./__mocks__/fluent-ffmpeg")).default;

    const cues: SubtitleCue[] = [
      { text: "Opening subtitle", startTime: 0.5, endTime: 3.0 },
      { text: "Closing subtitle", startTime: 8.0, endTime: 10.0 },
    ];
    const style: SubtitleStyle = { fontFamily: "Helvetica", fontSizePx: 40, color: "#ffff00" };

    const assContent = generateAss(cues, style, 12);
    const assPath = path.join(tmpDir, "subtitles.ass");
    fs.writeFileSync(assPath, assContent, "utf-8");

    const filter = buildAssFilter(assPath);

    await new Promise<void>((resolve, reject) => {
      ffmpeg(path.join(tmpDir, "input.mp4"))
        .videoFilters(filter)
        .outputOptions(["-c:v libx264", "-preset fast", "-crf 18", "-c:a copy", "-movflags +faststart"])
        .output(path.join(tmpDir, "output.mp4"))
        .on("end", resolve)
        .on("error", (err: Error) => reject(new Error(`FFmpeg failed: ${err.message}`)))
        .run();
    });

    // Filter references the correct .ass file
    expect(ffmpegMock.lastVideoFilters[0]).toContain(assPath.replace(/\\/g, "/"));

    // The .ass file on disk contains both cues
    const written = fs.readFileSync(assPath, "utf-8");
    expect(written).toContain("Opening subtitle");
    expect(written).toContain("Closing subtitle");

    // Style was applied
    expect(written).toContain("Helvetica");
    expect(written).toContain(",40,");

    // Yellow (#ffff00) → BGR = 0000ffff
    expect(written).toContain("&H0000ffff");
  });

  it("cues with null endTime are excluded from the rendered ASS", async () => {
    const cues: SubtitleCue[] = [
      { text: "Shown", startTime: 1.0, endTime: 3.0 },
      { text: "Hidden — no end", startTime: 4.0, endTime: null },
    ];

    const assContent = generateAss(cues, {}, 10);
    const assPath = path.join(tmpDir, "subtitles.ass");
    fs.writeFileSync(assPath, assContent, "utf-8");

    const written = fs.readFileSync(assPath, "utf-8");
    expect(written).toContain("Shown");
    expect(written).not.toContain("Hidden — no end");
  });
});
