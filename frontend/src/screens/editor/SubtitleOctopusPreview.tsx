import * as React from "react";
import SubtitlesOctopus from "libass-wasm";
import type { style } from "./Style.gen";
import type { subtitleCue } from "./Subtitles.gen";
import { generateAssFromStyle } from "../../codecs/generateAss";

interface Props {
  width: number;
  height: number;
  cues: subtitleCue[];
  subtitleStyle: style & { _videoWidth: number; _videoHeight: number };
  currentTime: number;
}

function weightToName(w: number): string {
  if (w >= 700) return "Bold";
  return "Regular";
}

export const SubtitleOctopusPreview: React.FC<Props> = ({
  width,
  height,
  cues,
  subtitleStyle,
  currentTime,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const octopusRef = React.useRef<SubtitlesOctopus | null>(null);

  // Reinitialize whenever cues or style changes
  React.useEffect(() => {
    if (!canvasRef.current) return;

    octopusRef.current?.dispose();
    octopusRef.current = null;

    const assContent = generateAssFromStyle(cues, subtitleStyle);
    const fontFamily = subtitleStyle.fontFamily;
    const weight = weightToName(subtitleStyle.fontWeight);

    const instance = new SubtitlesOctopus({
      canvas: canvasRef.current,
      subContent: assContent,
      workerUrl: "/subtitles-octopus/subtitles-octopus-worker.js",
      legacyWorkerUrl: "/subtitles-octopus/subtitles-octopus-worker-legacy.js",
      fonts: [`/fonts/${fontFamily}/${fontFamily}-${weight}.woff2`],
    });

    octopusRef.current = instance;

    return () => {
      instance.dispose();
      octopusRef.current = null;
    };
  }, [cues, subtitleStyle]);

  // Seek to current time whenever it changes
  React.useEffect(() => {
    octopusRef.current?.setCurrentTime(currentTime);
  }, [currentTime]);

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        width: `${width}px`,
        height: `${height}px`,
        transformOrigin: "top left",
      }}
    />
  );
};
