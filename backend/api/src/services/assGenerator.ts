export interface SubtitleCue {
  text: string;
  startTime: number;
  endTime: number | null;
}

export interface SubtitleStyle {
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: string | number;
  color?: string;       // hex like #ffffff
  backgroundColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  verticalPosition?: "top" | "center" | "bottom";
  alignment?: "left" | "center" | "right";
  _videoWidth?: number;
  _videoHeight?: number;
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

function alignmentToAssInt(h: "left" | "center" | "right", v: "top" | "center" | "bottom"): number {
  const col = h === "left" ? 1 : h === "center" ? 2 : 3;
  const row = v === "bottom" ? 0 : v === "center" ? 3 : 6;
  return col + row;
}

export function generateAss(cues: SubtitleCue[], style: SubtitleStyle, videoDuration: number): string {
  const fontName = style.fontFamily ?? "Arial";
  const fontSize = style.fontSize ?? 32;
  const bold = style.fontWeight === "bold" || Number(style.fontWeight) >= 700 ? -1 : 0;
  const primaryColor = `&H${hexToAssBgr(style.color ?? "#ffffff")}`;
  const outlineColor = `&H${hexToAssBgr(style.outlineColor ?? "#000000")}`;
  const outlineWidth = style.outlineWidth ?? 2;
  const alignment = alignmentToAssInt(
    (style.alignment as "left" | "center" | "right") ?? "center",
    (style.verticalPosition as "top" | "center" | "bottom") ?? "bottom",
  );
  const marginV = alignment <= 3 ? 20 : 0; // bottom margin

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${style._videoWidth ?? 1920}
PlayResY: ${style._videoHeight ?? 1080}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},&H80000000,${bold},0,0,0,100,100,0,0,1,${outlineWidth},0,${alignment},10,10,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;

  const events = cues
    .filter((c) => c.endTime !== null && c.endTime !== undefined && c.endTime > c.startTime)
    .map((c) => {
      const start = secondsToAssTime(c.startTime);
      const end = secondsToAssTime(c.endTime as number);
      const text = c.text.replace(/\n/g, "\\N");
      return `Dialogue: 0,${start},${end},Default,,0,0,0,,${text}`;
    })
    .join("\n");

  return `${header}\n${events}\n`;
}
