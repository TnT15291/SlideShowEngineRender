import { audioEncodeArgs } from "./quality";
import type { QualityProfile } from "./quality";
import type { AudioAutomationPoint, MusicTrack, VoiceoverConfig } from "./types";

export interface AudioMuxSpec {
  tracks: MusicTrack[];
  trackDurations: number[];
  fadeIn: number;
  fadeOut: number;
  crossfade: number;
  automation?: AudioAutomationPoint[];
  voiceover?: VoiceoverConfig;
}

/** Build the playlist, automation, fades, ducking and final audio mux graph. */
export function buildAudioMuxArgs(
  videoPath: string,
  spec: AudioMuxSpec,
  videoDuration: number,
  output: string,
  quality: QualityProfile
): string[] {
  const cf = spec.crossfade;
  const filters: string[] = [];
  const single = spec.tracks.length === 1;
  const playlistDur =
    spec.trackDurations.reduce((sum, duration) => sum + duration, 0) -
    cf * (spec.tracks.length - 1);
  const repeats = single
    ? 1
    : Math.min(50, Math.max(1, Math.ceil(videoDuration / Math.max(playlistDur, 1))));

  const inputs: string[] = ["-i", videoPath];
  if (single) {
    inputs.push("-stream_loop", "-1", "-i", spec.tracks[0].path);
  } else {
    for (let repeat = 0; repeat < repeats; repeat++) {
      for (const track of spec.tracks) inputs.push("-i", track.path);
    }
  }

  const trackCount = single ? 1 : spec.tracks.length * repeats;
  for (let index = 0; index < trackCount; index++) {
    const track = spec.tracks[index % spec.tracks.length];
    const trim = track.start != null || track.end != null
      ? `atrim=start=${track.start ?? 0}${track.end != null ? `:end=${track.end}` : ""},asetpts=PTS-STARTPTS,`
      : "";
    filters.push(`[${index + 1}:a]${trim}volume=${track.volume}[t${index}]`);
  }

  let bed: string;
  if (trackCount === 1) {
    bed = "t0";
  } else if (cf > 0) {
    let previous = "t0";
    for (let index = 1; index < trackCount; index++) {
      const joined = index === trackCount - 1 ? "joined" : `j${index}`;
      filters.push(`[${previous}][t${index}]acrossfade=d=${cf}:c1=tri:c2=tri[${joined}]`);
      previous = joined;
    }
    bed = "joined";
  } else {
    const labels = Array.from({ length: trackCount }, (_, index) => `[t${index}]`).join("");
    filters.push(`${labels}concat=n=${trackCount}:v=0:a=1[joined]`);
    bed = "joined";
  }

  const chain = [`apad=whole_dur=${videoDuration}`, `atrim=0:${videoDuration}`, "asetpts=PTS-STARTPTS"];
  if (spec.automation?.length) {
    chain.push(`volume='${automationExpr(spec.automation)}':eval=frame`);
  }
  if (spec.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${spec.fadeIn}`);
  if (spec.fadeOut > 0) {
    chain.push(`afade=t=out:st=${Math.max(0, videoDuration - spec.fadeOut)}:d=${spec.fadeOut}`);
  }
  filters.push(`[${bed}]${chain.join(",")}[bed]`);

  let master = "bed";
  if (spec.voiceover) {
    const voiceover = spec.voiceover;
    const delayMs = Math.round(voiceover.start * 1000);
    const voiceoverIndex = single ? 2 : 1 + trackCount;
    filters.push(
      `[${voiceoverIndex}:a]volume=${voiceover.volume},adelay=${delayMs}|${delayMs},` +
        `apad=whole_dur=${videoDuration},atrim=0:${videoDuration}[vo]`
    );
    if (voiceover.ducking) {
      filters.push("[vo]asplit[voKey][voMix]");
      filters.push("[bed][voKey]sidechaincompress=threshold=0.03:ratio=10:attack=100:release=500[ducked]");
      filters.push("[ducked][voMix]amix=inputs=2:normalize=0[aout]");
    } else {
      filters.push("[bed][vo]amix=inputs=2:normalize=0[aout]");
    }
    master = "aout";
  }

  return [
    "-y",
    ...inputs,
    ...(spec.voiceover ? ["-i", spec.voiceover.path] : []),
    "-filter_complex", filters.join(";"),
    "-map", "0:v",
    "-map", `[${master}]`,
    "-c:v", "copy",
    ...audioEncodeArgs(quality),
    "-t", String(videoDuration),
    output,
  ];
}

function automationExpr(points: AudioAutomationPoint[]): string {
  const last = points[points.length - 1];
  let expression = String(last.volume);
  for (let index = points.length - 2; index >= 0; index--) {
    const current = points[index];
    const next = points[index + 1];
    const span = Math.max(next.at - current.at, 0.001);
    const lerp = `${current.volume}+(${next.volume}-${current.volume})*(t-${current.at})/${span}`;
    expression = `if(lt(t,${next.at}),${lerp},${expression})`;
  }
  return `if(lt(t,${points[0].at}),${points[0].volume},${expression})`;
}
