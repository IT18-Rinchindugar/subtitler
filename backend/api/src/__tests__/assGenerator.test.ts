import { generateAss } from "../services/assGenerator";
import type { SubtitleCue, SubtitleStyle } from "../services/assGenerator";

const basicCues: SubtitleCue[] = [
  { text: "Hello world", startTime: 1.0, endTime: 3.5 },
  { text: "Second line", startTime: 4.0, endTime: 6.0 },
];

describe("generateAss", () => {
  describe("file structure", () => {
    it("contains all three required ASS sections", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("[Script Info]");
      expect(out).toContain("[V4+ Styles]");
      expect(out).toContain("[Events]");
    });

    it("includes the Format header line before Dialogue lines", () => {
      const out = generateAss(basicCues, {}, 10);
      const formatIdx = out.indexOf("Format: Layer, Start, End");
      const dialogueIdx = out.indexOf("Dialogue:");
      expect(formatIdx).toBeGreaterThan(-1);
      expect(dialogueIdx).toBeGreaterThan(formatIdx);
    });
  });

  describe("timestamp formatting", () => {
    it("formats start and end times as H:MM:SS.cc", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("0:00:01.00");
      expect(out).toContain("0:00:03.50");
    });

    it("correctly formats timestamps that cross the minute boundary", () => {
      const cues: SubtitleCue[] = [{ text: "Test", startTime: 65.25, endTime: 70.0 }];
      const out = generateAss(cues, {}, 120);
      expect(out).toContain("0:01:05.25");
      expect(out).toContain("0:01:10.00");
    });

    it("correctly formats timestamps that cross the hour boundary", () => {
      const cues: SubtitleCue[] = [{ text: "Test", startTime: 3661.0, endTime: 3665.5 }];
      const out = generateAss(cues, {}, 4000);
      expect(out).toContain("1:01:01.00");
      expect(out).toContain("1:01:05.50");
    });
  });

  describe("cue filtering", () => {
    it("renders cues with valid start/end times", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("Hello world");
      expect(out).toContain("Second line");
    });

    it("drops cues where endTime is null", () => {
      const cues: SubtitleCue[] = [
        { text: "Visible", startTime: 1.0, endTime: 3.0 },
        { text: "No end", startTime: 4.0, endTime: null },
      ];
      const out = generateAss(cues, {}, 10);
      expect(out).toContain("Visible");
      expect(out).not.toContain("No end");
    });

    it("drops cues where endTime <= startTime", () => {
      const cues: SubtitleCue[] = [
        { text: "Valid", startTime: 1.0, endTime: 3.0 },
        { text: "Zero duration", startTime: 2.0, endTime: 2.0 },
        { text: "Reversed", startTime: 5.0, endTime: 4.0 },
      ];
      const out = generateAss(cues, {}, 10);
      expect(out).toContain("Valid");
      expect(out).not.toContain("Zero duration");
      expect(out).not.toContain("Reversed");
    });

    it("produces no Dialogue lines when all cues are invalid", () => {
      const cues: SubtitleCue[] = [
        { text: "A", startTime: 1.0, endTime: null },
        { text: "B", startTime: 3.0, endTime: 3.0 },
      ];
      const out = generateAss(cues, {}, 10);
      expect(out).not.toContain("Dialogue:");
    });
  });

  describe("text handling", () => {
    it("converts newlines to ASS \\N line breaks", () => {
      const cues: SubtitleCue[] = [{ text: "Line one\nLine two", startTime: 1.0, endTime: 3.0 }];
      const out = generateAss(cues, {}, 10);
      expect(out).toContain("Line one\\NLine two");
    });

    it("preserves text content exactly", () => {
      const cues: SubtitleCue[] = [{ text: "Héllo wörld 你好", startTime: 1.0, endTime: 3.0 }];
      const out = generateAss(cues, {}, 10);
      expect(out).toContain("Héllo wörld 你好");
    });
  });

  describe("style: colors", () => {
    it("applies default white primary color when none given", () => {
      const out = generateAss(basicCues, {}, 10);
      // white in BGR = 00ffffff
      expect(out).toContain("&H00ffffff");
    });

    it("converts hex color to ASS BGR format", () => {
      const style: SubtitleStyle = { color: "#ff0000" }; // red
      const out = generateAss(basicCues, style, 10);
      // red: R=ff G=00 B=00 → BGR = 000000ff
      expect(out).toContain("&H000000ff");
    });

    it("converts strokeColor to ASS BGR format", () => {
      const style: SubtitleStyle = { strokeColor: "#0000ff" }; // blue
      const out = generateAss(basicCues, style, 10);
      // blue: R=00 G=00 B=ff → BGR = 00ff0000
      expect(out).toContain("&H00ff0000");
    });
  });

  describe("style: font", () => {
    it("uses Arial as default font", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("Arial");
    });

    it("uses provided fontFamily", () => {
      const out = generateAss(basicCues, { fontFamily: "Roboto" }, 10);
      expect(out).toContain("Roboto");
    });

    it("uses provided fontSizePx", () => {
      const out = generateAss(basicCues, { fontSizePx: 48 }, 10);
      expect(out).toMatch(/Style: Default,\w+,48,/);
    });

    it("sets bold flag for fontWeight >= 700", () => {
      const out = generateAss(basicCues, { fontWeight: 700 }, 10);
      // bold = -1 in ASS
      expect(out).toMatch(/Style: Default,[^,]+,\d+,[^,]+,[^,]+,[^,]+,[^,]+,-1,/);
    });

    it("sets bold flag for fontWeight 800", () => {
      const out = generateAss(basicCues, { fontWeight: 800 }, 10);
      expect(out).toMatch(/Style: Default,[^,]+,\d+,[^,]+,[^,]+,[^,]+,[^,]+,-1,/);
    });

    it("sets not-bold flag for fontWeight 400", () => {
      const out = generateAss(basicCues, { fontWeight: 400 }, 10);
      expect(out).toMatch(/Style: Default,[^,]+,\d+,[^,]+,[^,]+,[^,]+,[^,]+,0,/);
    });
  });

  describe("style: positioning via \\pos and \\an", () => {
    it("emits \\pos tag with style.x and style.y coordinates", () => {
      const style: SubtitleStyle = { x: 320, y: 540 };
      const out = generateAss(basicCues, style, 10);
      expect(out).toContain("\\pos(320,540)");
    });

    it("defaults \\pos to (0,0) when x/y not provided", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("\\pos(0,0)");
    });

    it("emits \\an8 for Center (default)", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("\\an8");
    });

    it("emits \\an7 for Left alignment", () => {
      const style: SubtitleStyle = { align: "Left" };
      const out = generateAss(basicCues, style, 10);
      expect(out).toContain("\\an7");
    });

    it("emits \\an9 for Right alignment", () => {
      const style: SubtitleStyle = { align: "Right" };
      const out = generateAss(basicCues, style, 10);
      expect(out).toContain("\\an9");
    });

    it("emits \\q2 to disable libass word-wrapping", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("\\q2");
    });

    it("global Style Alignment is always 7 (top-left anchor, overridden per-dialogue)", () => {
      const out = generateAss(basicCues, {}, 10);
      const styleLine = out.split("\n").find((l) => l.startsWith("Style:"))!;
      const parts = styleLine.split(",");
      expect(parts[18]).toBe("7");
    });
  });

  describe("style: background", () => {
    it("uses BorderStyle 3 and BackColour when showBackground is true", () => {
      const style: SubtitleStyle = {
        showBackground: true,
        background: {
          color: "#000000",
          opacity: 0.8,
          paddingX: 10,
          paddingY: 5,
          borderRadius: 4,
          strokeWidth: 0,
        },
      };
      const out = generateAss(basicCues, style, 10);
      expect(out).toContain("Style: DefaultBg");
      // BorderStyle 3 is field index 15 in the Style line
      const bgLine = out.split("\n").find((l) => l.startsWith("Style: DefaultBg"))!;
      expect(bgLine).toBeDefined();
      const parts = bgLine.split(",");
      expect(parts[15]).toBe("3");
    });

    it("uses DefaultBg style name in Dialogue lines when showBackground is true", () => {
      const style: SubtitleStyle = {
        showBackground: true,
        background: { color: "#000000", opacity: 0.5, paddingX: 0, paddingY: 0, borderRadius: 0, strokeWidth: 0 },
      };
      const out = generateAss(basicCues, style, 10);
      expect(out).toContain("Dialogue: 0,");
      const dialogueLine = out.split("\n").find((l) => l.startsWith("Dialogue:"))!;
      // Style field is the 4th comma-separated field (index 3)
      const parts = dialogueLine.split(",");
      expect(parts[3]).toBe("DefaultBg");
    });

    it("uses Default style name when showBackground is false", () => {
      const out = generateAss(basicCues, { showBackground: false }, 10);
      const dialogueLine = out.split("\n").find((l) => l.startsWith("Dialogue:"))!;
      const parts = dialogueLine.split(",");
      expect(parts[3]).toBe("Default");
    });
  });

  describe("style: video resolution", () => {
    it("defaults PlayRes to 1920x1080", () => {
      const out = generateAss(basicCues, {}, 10);
      expect(out).toContain("PlayResX: 1920");
      expect(out).toContain("PlayResY: 1080");
    });

    it("uses provided _videoWidth and _videoHeight", () => {
      const out = generateAss(basicCues, { _videoWidth: 1280, _videoHeight: 720 }, 10);
      expect(out).toContain("PlayResX: 1280");
      expect(out).toContain("PlayResY: 720");
    });
  });
});
