import type { AcceptedVideoFormat } from "@repo/shared";
import type { ProbeOutput } from "./ffmpeg.server";

/**
 * Video codecs every browser plays. Published boards are seen in browsers the
 * Owner doesn't control, so a codec only some of them decode would be a broken
 * tile for the rest — HEVC above all, the iPhone camera's default, which
 * Firefox and most Chrome installs can't play.
 *
 * Nothing is transcoded, so this list is what decides it. A transcoded
 * `playback` derivative is the way to widen it later.
 */
const PLAYABLE_CODECS = new Set(["h264", "vp8", "vp9"]);

/** What ingest records about a video, read off what ffprobe found. */
export type VideoMetadata = {
  codec: string;
  /** As displayed, after any rotation the file asks for. */
  width: number;
  height: number;
  /** Null when the container never says. */
  durationMs: number | null;
};

export type VideoVerdict = { ok: true; video: VideoMetadata } | { ok: false; message: string };

/**
 * Decides whether a probed file is a video Substratum keeps, and if so what it
 * records about it. Every refusal says what to do instead.
 *
 * `container` is what the leading bytes said; ffprobe has to agree, or the file
 * is not what it looks like.
 */
export function describeVideo(probe: ProbeOutput, container: AcceptedVideoFormat): VideoVerdict {
  const formatNames = (probe.format?.format_name ?? "").split(",");
  const expected = container === "webm" ? "webm" : "mp4";
  if (!formatNames.includes(expected)) {
    return { ok: false, message: "That video file is damaged, or isn't what it appears to be." };
  }

  // Cover art in an MP4 is a video stream too, one flagged as an attached
  // picture; it is never the thing to play.
  const stream = probe.streams?.find(
    (candidate) => candidate.codec_type === "video" && !candidate.disposition?.attached_pic,
  );
  if (!stream) return { ok: false, message: "That file has no video in it." };

  const codec = stream.codec_name ?? "unknown";
  if (!PLAYABLE_CODECS.has(codec)) return { ok: false, message: unplayableMessage(codec) };

  if (!stream.width || !stream.height) {
    return { ok: false, message: "That video has no dimensions." };
  }

  // A phone holds portrait footage as landscape frames plus an instruction to
  // turn them, and players obey it — so the size anyone sees is the turned one.
  const quarterTurned = Math.abs(rotationOf(stream)) % 180 === 90;

  return {
    ok: true,
    video: {
      codec,
      width: quarterTurned ? stream.height : stream.width,
      height: quarterTurned ? stream.width : stream.height,
      durationMs: durationOf(probe, stream),
    },
  };
}

type ProbedStream = NonNullable<ProbeOutput["streams"]>[number];

/** Degrees, from the display matrix where there is one, else the legacy tag. */
function rotationOf(stream: ProbedStream): number {
  const matrix = stream.side_data_list?.find((data) => data.side_data_type === "Display Matrix");
  if (matrix?.rotation !== undefined) return Math.round(matrix.rotation);
  return Math.round(Number(stream.tags?.rotate ?? 0)) || 0;
}

function durationOf(probe: ProbeOutput, stream: ProbedStream): number | null {
  for (const raw of [probe.format?.duration, stream.duration]) {
    const seconds = Number(raw);
    if (raw !== undefined && Number.isFinite(seconds) && seconds > 0) {
      return Math.round(seconds * 1000);
    }
  }
  return null;
}

function unplayableMessage(codec: string): string {
  const named: Record<string, string> = {
    hevc: "HEVC (H.265), which most browsers can't play",
    av1: "AV1, which older devices can't play",
  };
  const why = named[codec] ?? `${codec}, which not every browser can play`;
  return `That video is ${why} — export it as H.264 to save it.`;
}
