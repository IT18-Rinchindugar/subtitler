import type { style } from "../screens/editor/Style.gen";
import type { subtitleCue } from "../screens/editor/Subtitles.gen";

function secondsToAssTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const cs = Math.round((secs % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function hexToAssBgr(hex: string): string {
  const clean = hex.replace("#", "").padEnd(6, "0");
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `00${b}${g}${r}`;
}

function alignToAssAnchor(align: string): number {
  if (align === "Left") return 7;
  if (align === "Right") return 9;
  return 8;
}

function wrapText(text: string, maxWidth: number, font: string): string {
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = font;
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines.join("\\N");
}

export function generateAssFromStyle(
  cues: subtitleCue[],
  s: style & { _videoWidth: number; _videoHeight: number }
): string {
  const fontName = s.fontFamily;
  const fontSize = s.fontSizePx;
  const bold = s.fontWeight >= 700 ? -1 : 0;
  const primaryColor = `&H${hexToAssBgr(s.color)}`;
  const outlineColor = `&H${hexToAssBgr(s.strokeColor ?? "#000000")}`;
  const outlineWidth = s.strokeWidth;
  const anAnchor = alignToAssAnchor(s.align);
  const blockWidth = s.blockSize.width;
  // Konva stores x,y as top-left of the block. ASS \pos anchor depends on \an:
  //   \an7 (Left)   → anchor is top-left  → posX = x
  //   \an8 (Center) → anchor is top-center → posX = x + blockWidth/2
  //   \an9 (Right)  → anchor is top-right  → posX = x + blockWidth
  const posX =
    s.align === "Center" ? Math.round(s.x + blockWidth / 2) :
    s.align === "Right"  ? Math.round(s.x + blockWidth) :
    s.x;
  const posY = s.y;
  const maxWidth = blockWidth;
  const font = `${s.fontWeight} ${s.fontSizePx}px "${s.fontFamily}"`;

  let styleLines = `Style: Default,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},&H80000000,${bold},0,0,0,100,100,0,0,1,${outlineWidth},0,7,0,0,0,1`;

  if (s.showBackground) {
    const bg = s.background;
    const alphaHex = Math.round((1 - bg.opacity) * 255).toString(16).padStart(2, "0");
    const bgBgr = hexToAssBgr(bg.color);
    const backColor = `&H${alphaHex}${bgBgr.slice(2)}`;
    styleLines += `\nStyle: DefaultBg,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},${backColor},${bold},0,0,0,100,100,0,0,3,0,0,7,0,0,0,1`;
  }

  const styleName = s.showBackground ? "DefaultBg" : "Default";

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${s._videoWidth}
PlayResY: ${s._videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = cues
    .filter((c) => {
      const end = c.timestamp[1];
      return end != null && end > c.timestamp[0];
    })
    .map((c) => {
      const start = secondsToAssTime(c.timestamp[0]);
      const end = secondsToAssTime(c.timestamp[1] as number);
      const rawText = c.text.replace(/\n/g, " ");
      const wrappedText = wrapText(rawText, maxWidth, font);
      return `Dialogue: 0,${start},${end},${styleName},,0,0,0,,{\\an${anAnchor}\\pos(${posX},${posY})\\q2}${wrappedText}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}
