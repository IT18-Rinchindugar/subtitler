export interface SubtitleCue {
  text: string;
  startTime: number;
  endTime: number | null;
}

export interface SubtitleStyle {
  x?: number;
  y?: number;
  fontFamily?: string;
  fontWeight?: number;          // 100–900
  fontSizePx?: number;
  color?: string;               // hex
  strokeColor?: string;
  strokeWidth?: number;
  align?: "Left" | "Center" | "Right";
  blockSize?: { width: number; height: number };
  showBackground?: boolean;
  background?: {
    color: string;
    opacity: number;
    paddingX: number;
    paddingY: number;
    borderRadius: number;
    strokeColor?: string;
    strokeWidth: number;
  };
  _videoWidth?: number;
  _videoHeight?: number;
  _fontUrl?: string;
}

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

function alignToAssAnchor(align?: string): number {
  if (align === "Left") return 7;
  if (align === "Right") return 9;
  return 8; // Center default
}

export function generateAss(cues: SubtitleCue[], style: SubtitleStyle, _videoDuration: number): string {
  const fontName = style.fontFamily ?? "Arial";
  const fontSize = style.fontSizePx ?? 32;
  const bold = (style.fontWeight ?? 400) >= 700 ? -1 : 0;
  const primaryColor = `&H${hexToAssBgr(style.color ?? "#ffffff")}`;
  const outlineColor = `&H${hexToAssBgr(style.strokeColor ?? "#000000")}`;
  const outlineWidth = style.strokeWidth ?? 2;
  const videoWidth = style._videoWidth ?? 1920;
  const videoHeight = style._videoHeight ?? 1080;
  const anAnchor = alignToAssAnchor(style.align);
  const blockWidth = style.blockSize?.width ?? videoWidth;
  // Konva stores x,y as top-left of the block. ASS \pos anchor depends on \an:
  //   \an7 (Left)   → anchor is top-left   → posX = x
  //   \an8 (Center) → anchor is top-center → posX = x + blockWidth/2
  //   \an9 (Right)  → anchor is top-right  → posX = x + blockWidth
  const rawX = style.x ?? 0;
  const posX =
    style.align === "Center" ? Math.round(rawX + blockWidth / 2) :
    style.align === "Right"  ? Math.round(rawX + blockWidth) :
    rawX;
  const posY = style.y ?? 0;

  // BackColour: fully transparent (&HFF000000) — only matters for BorderStyle=3 box mode,
  // which is not used on Default. Keeping it transparent avoids accidental shadow tinting.
  let styleLines = `Style: Default,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},&HFF000000,${bold},0,0,0,100,100,0,0,1,${outlineWidth},0,7,0,0,0,1`;

  if (style.showBackground && style.background) {
    const bg = style.background;
    const alphaHex = Math.round((1 - bg.opacity) * 255).toString(16).padStart(2, "0");
    const bgBgr = hexToAssBgr(bg.color);
    const backColor = `&H${alphaHex}${bgBgr.slice(2)}`; // drop the leading "00" from hexToAssBgr
    styleLines += `\nStyle: DefaultBg,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},${backColor},${bold},0,0,0,100,100,0,0,3,0,0,7,0,0,0,1`;
  }

  const styleName = style.showBackground && style.background ? "DefaultBg" : "Default";

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${videoWidth}
PlayResY: ${videoHeight}
ScaledBorderAndShadow: yes
WrapStyle: 1
Timer: 100.0000
Collisions: Normal

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleLines}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  // Margins confine WrapStyle wrapping to blockSize.width
  const marginL = Math.max(0, rawX);
  const marginR = Math.max(0, videoWidth - (rawX + blockWidth));

  const events = cues
    .filter((c) => c.endTime !== null && c.endTime !== undefined && c.endTime > c.startTime)
    .map((c) => {
      const start = secondsToAssTime(c.startTime);
      const end = secondsToAssTime(c.endTime as number);
      const text = c.text.replace(/\n/g, "\\N");
      return `Dialogue: 0,${start},${end},${styleName},,${marginL},${marginR},0,,{\\an${anAnchor}\\pos(${posX},${posY})}${text}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}
