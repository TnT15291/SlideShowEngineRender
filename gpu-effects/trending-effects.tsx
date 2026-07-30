import React, { useEffect, useMemo, useState } from "react";
import {
  AbsoluteFill,
  Img,
  continueRender,
  delayRender,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
import { useBundledFont } from "./fonts";
import { focusPosition, focusX } from "./framing";

type EffectProps = { assets: string[]; params: Record<string, unknown> };
type ShaderVariant = "dither" | "glass" | "particle";

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const HASH = `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
`;

// An 8x8 Bayer ORDERED dither matrix, built by recursion instead of a lookup table so it
// needs no uniform and no integer maths. bayer8() returns the cell's threshold in [0,1).
//
// This exists because "ordered dither" was a claim, not a fact: dither_dissolve thresholded
// on hash21(), which is white noise. White noise dissolves look like television static or a
// corrupt JPEG — a known trap in this repo (the reveal masks hit it too, see the note in
// scripts/generateMasks.mjs). An ordered matrix is what gives the classic halftone
// crosshatch that reads as a designed transition instead of signal damage.
const BAYER = `
  float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
  #define bayer4(a) (bayer2(0.5 * (a)) * 0.25 + bayer2(a))
  #define bayer8(a) (bayer4(0.5 * (a)) * 0.25 + bayer2(a))
`;

const shaderFor = (variant: ShaderVariant) => `
  varying vec2 vUv;
  uniform sampler2D tex0;
  uniform sampler2D tex1;
  uniform vec2 size0;
  uniform vec2 size1;
  uniform vec2 resolution;
  uniform float progress;

  vec2 coverUv(vec2 uv, vec2 texSize) {
    float texAspect = texSize.x / texSize.y;
    float outAspect = resolution.x / resolution.y;
    vec2 scale = texAspect > outAspect
      ? vec2(outAspect / texAspect, 1.0)
      : vec2(1.0, texAspect / outAspect);
    return (uv - 0.5) * scale + 0.5;
  }

  ${HASH}
  ${BAYER}

  void main() {
    vec2 uv0 = coverUv(vUv, size0);
    vec2 uv1 = coverUv(vUv, size1);
    vec4 fromColor = texture2D(tex0, uv0);
    vec4 toColor = texture2D(tex1, uv1);
    ${variant === "dither" ? `
      // Dot size scales with the output so the pattern is the same texture at 540p and 4K.
      // It used to be a flat 5 device pixels, which meant the transition looked coarse on a
      // proxy render and nearly invisible on the delivered one.
      float dotSize = max(2.0, floor(resolution.y / 270.0));
      float threshold = bayer8(gl_FragCoord.xy / dotSize);
      // The window is narrower than one of the 64 Bayer levels, so each dot flips cleanly
      // (anti-aliased, not blurred) and the ordered pattern stays legible. Progress is
      // widened past [0,1] by the same window so the first frame is fully the outgoing
      // photograph and the last is fully the incoming one.
      float window = 0.02;
      float p = progress * (1.0 + 2.0 * window) - window;
      float reveal = smoothstep(threshold - window, threshold + window, p);
      gl_FragColor = mix(fromColor, toColor, reveal);
    ` : variant === "glass" ? `
      const float LENS_RADIUS = 0.24;
      float aspect = resolution.x / resolution.y;
      vec2 center = vec2(-0.25 + progress * 1.5, 0.5 + sin(progress * 3.14159) * 0.08);
      // Screen-space offset from the lens centre, so the lens stays circular on a 16:9 frame.
      vec2 warped = (vUv - center) * vec2(aspect, 1.0);
      float dist = length(warped);
      float radial = dist / LENS_RADIUS;
      // A softer shoulder and a warmer rim. At a 6% falloff with a cold blue-grey edge the
      // disc read as a magnifying glass laid on the picture; widened to 18% and tinted the
      // colour of light through a lens, it reads as a flare crossing the frame, which is
      // the family — light leaks, bokeh, halation — the wedding grades already speak.
      float lens = 1.0 - smoothstep(LENS_RADIUS * 0.82, LENS_RADIUS, dist);
      float rim = smoothstep(LENS_RADIUS * 0.62, LENS_RADIUS * 0.94, dist) * lens;
      // A lens deviates NOTHING through its optical centre and most at its rim. This ran the
      // other way round — magnitude (1.0 - dist/0.255) peaked dead centre, where normalize()
      // of a near-zero vector also stops having a defined direction — so instead of glass the
      // middle of the disc showed a pinched swirl. Squaring the radius puts the bend back at
      // the edge and takes it to zero at the centre, which also disarms the singularity: the
      // unstable direction is now multiplied by 0.
      float bend = radial * radial;
      vec2 direction = dist > 0.0001 ? warped / dist : vec2(0.0);
      // Back out of screen space: an equal shift in x and y must be equal in PIXELS, not uv.
      vec2 refracted = uv1 - direction / vec2(aspect, 1.0) * (0.045 * lens * bend);
      vec4 glassColor = texture2D(tex1, clamp(refracted, 0.002, 0.998));
      glassColor.rgb += rim * vec3(0.30, 0.22, 0.12);
      float passed = 1.0 - smoothstep(center.x - 0.04, center.x + 0.04, vUv.x);
      gl_FragColor = mix(fromColor, glassColor, max(lens, passed));
    ` : `
      // PARTICLES THAT ACTUALLY MOVE.
      //
      // The first version displaced the SAMPLE coordinate of a cell that stayed put, and
      // scaled that displacement by (1.0 - remaining) — which is ~0 for as long as the cell
      // is still visible and only reaches its maximum once the cell has already been
      // replaced by the incoming photograph. So the flight was, by construction, invisible:
      // what shipped was a blocky in-place noise wipe.
      //
      // A cell now genuinely travels, shrinks and fades. Since a fragment shader is asked
      // "what is at THIS pixel" rather than "where did this cell go", each pixel tests the
      // 3x3 neighbourhood of cells and keeps the one whose moved, shrunken body covers it.
      // That bounds travel at just over one cell — enough to read as lift-off at 34px cells
      // — for nine cheap iterations and a single texture fetch outside the loop, which also
      // keeps the fetch in uniform control flow.
      vec2 grid = vec2(56.0, 32.0);
      vec2 pos = vUv * grid;
      vec2 base = floor(pos);
      vec2 sampleUv = vUv;
      float alpha = 0.0;
      for (int ox = -1; ox <= 1; ox++) {
        for (int oy = -1; oy <= 1; oy++) {
          vec2 cell = base + vec2(float(ox), float(oy));
          vec2 cellCenter = (cell + 0.5) / grid;
          float seed = hash21(cell);
          // A diagonal wave from the bottom-left, jittered hard per cell so the dissolving
          // edge is a scatter of grains rather than a ruled line.
          float order = cellCenter.x * 0.30 + cellCenter.y * 0.20 + seed * 0.50;
          float life = clamp((progress * 1.45 - order) / 0.32, 0.0, 1.0);
          float ease = life * life;
          // Mostly upward, like ash lifting, with a per-cell sideways drift.
          vec2 drift = vec2((hash21(cell + 31.7) - 0.5) * 1.5, 1.15) * ease * 1.2;
          float shrink = max(0.08, 1.0 - ease * 0.8);
          vec2 local = (pos - cell - drift - 0.5) / shrink + 0.5;
          // ROUND GRAINS, NOT TILES. A square cell fading out is the visual language of a
          // corrupted file — data-moshing, a dropped frame — which is a strange thing to say
          // about a photograph of two people getting married. The same motion carried by a
          // soft round grain reads as ash, petals, confetti: a wedding image. The cell stays
          // square in the maths; only what is drawn inside it is round, and it only rounds
          // as the grain leaves, so the picture is still whole while it is still whole.
          float radius = length(local - 0.5) * 2.0;
          float grain = mix(
            step(max(abs(local.x - 0.5), abs(local.y - 0.5)) * 2.0, 1.0),
            1.0 - smoothstep(0.72, 1.0, radius),
            smoothstep(0.0, 0.08, ease)
          );
          float opacity = grain * (1.0 - ease);
          if (opacity > alpha) {
            alpha = opacity;
            sampleUv = clamp((cell + local) / grid, 0.001, 0.999);
          }
        }
      }
      vec3 flying = texture2D(tex0, coverUv(sampleUv, size0)).rgb;
      vec3 color = mix(toColor.rgb, flying, alpha);
      // A warm ember on grains that are mid-flight. Applied to the moving body rather than
      // to a threshold band, so it glows on the particle instead of outlining square tiles.
      color += vec3(0.13, 0.09, 0.04) * alpha * (1.0 - alpha) * 3.2;
      gl_FragColor = vec4(color, 1.0);
    `}
  }
`;

function useTexture(src: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const handle = delayRender(`trending effect texture ${src}`);
    let cancelled = false;
    new THREE.TextureLoader().load(
      src,
      (loaded) => {
        if (!cancelled) setTexture(loaded);
        continueRender(handle);
      },
      undefined,
      () => continueRender(handle),
    );
    return () => { cancelled = true; };
  }, [src]);
  return texture;
}

const ShaderPlane = ({
  first,
  second,
  variant,
  progress,
  width,
  height,
}: {
  first: THREE.Texture;
  second: THREE.Texture;
  variant: ShaderVariant;
  progress: number;
  width: number;
  height: number;
}) => {
  const material = useMemo(() => new THREE.ShaderMaterial({
    uniforms: {
      tex0: { value: first },
      tex1: { value: second },
      size0: { value: new THREE.Vector2((first.image as HTMLImageElement).width, (first.image as HTMLImageElement).height) },
      size1: { value: new THREE.Vector2((second.image as HTMLImageElement).width, (second.image as HTMLImageElement).height) },
      resolution: { value: new THREE.Vector2(width, height) },
      progress: { value: 0 },
    },
    vertexShader: VERTEX,
    fragmentShader: shaderFor(variant),
    depthTest: false,
    depthWrite: false,
  }), [first, second, variant, width, height]);
  material.uniforms.progress.value = progress;
  return <mesh material={material}><planeGeometry args={[2, 2]} /></mesh>;
};

const ProceduralShaderEffect = ({ assets, variant }: EffectProps & { variant: ShaderVariant }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const first = useTexture(staticFile(assets[0]));
  const second = useTexture(staticFile(assets[1]));
  const progress = interpolate(
    frame,
    [durationInFrames * .16, durationInFrames * .84],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  if (!first || !second) return <AbsoluteFill style={{ background: "#111" }} />;
  return <ThreeCanvas width={width} height={height} linear flat>
    <ShaderPlane first={first} second={second} variant={variant} progress={progress} width={width} height={height} />
  </ThreeCanvas>;
};

export const DitherDissolve = (props: EffectProps) =>
  <ProceduralShaderEffect {...props} variant="dither" />;

export const GlassRefraction = (props: EffectProps) =>
  <ProceduralShaderEffect {...props} variant="glass" />;

export const ParticleDissolve = (props: EffectProps) =>
  <ProceduralShaderEffect {...props} variant="particle" />;

export const KineticTypography = ({ assets, params }: EffectProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const title = String(params.title ?? "Our Story");
  const subtitle = String(params.subtitle ?? "");
  // Bundled by default: the previous default, "Georgia, serif", silently detaches the tone
  // marks of ố/ầ/… — see gpu-effects/fonts.ts. Cormorant Garamond is the same serif
  // layouts/library.json gives the white_weddings theme, and it covers Vietnamese in full.
  const fontFamily = useBundledFont(params.fontFamily ?? "fonts/CormorantGaramond-Regular.ttf");
  const characters = Array.from(title);
  const defaultFontSize = Math.min(width * .07, width * .76 / Math.max(1, characters.length * .58));
  const exit = interpolate(
    frame,
    [durationInFrames * .78, durationInFrames * .96],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  // WHICH SIDE THE WORDS GO. The scrim used to be nailed to the left, so on a photograph
  // whose subject stands left of centre the copy was laid straight over the couple and the
  // darkest part of the gradient sat on their faces. Put the words in the empty half.
  const subjectLeft = focusX(params) < .5;
  const scrim = subjectLeft
    ? "linear-gradient(270deg,rgba(8,7,6,.62),transparent 66%)"
    : "linear-gradient(90deg,rgba(8,7,6,.62),transparent 66%)";
  // The headline is spread over a real slice of the shot instead of 26 frames flat. At 25
  // characters the old spacing worked out to one frame each, so the "per-character stagger"
  // resolved to every letter arriving at once — the effect existed in the source and not on
  // screen. Three frames apart, capped so a long Vietnamese title still lands well before
  // the exit fade.
  const perCharacter = Math.max(2, Math.min(5, Math.round(durationInFrames * .35 / Math.max(1, characters.length))));
  const subtitleStart = 8 + characters.length * perCharacter + 6;
  return <AbsoluteFill style={{ background: String(params.background ?? "#151310"), overflow: "hidden" }}>
    <Img src={staticFile(assets[0])} style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: focusPosition(params),
      // The photograph used to be dimmed THREE times over — 0.68 opacity onto a near-black
      // ground, then brightness 0.72, then a 0.7-alpha scrim across two thirds of the width.
      // Measured on a real render it left the couple at 38% of the source luminance: the
      // "text over a greyed-out photo" look of a free template, on the one image the
      // customer actually paid for. The scrim alone is enough to seat the type.
      filter: "saturate(.94) brightness(.92)",
      transform: `scale(${1.04 + frame / durationInFrames * .05})`,
    }} />
    <AbsoluteFill style={{
      background: scrim,
      justifyContent: "center",
      alignItems: subjectLeft ? "flex-end" : "flex-start",
      padding: "8%",
      boxSizing: "border-box",
    }}>
      <div style={{ display: "flex", whiteSpace: "nowrap", maxWidth: "84%", lineHeight: .92 }}>
        {characters.map((character, index) => {
          const start = 8 + index * perCharacter;
          const reveal = interpolate(frame, [start, start + 20], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return <span key={`${character}-${index}`} style={{
            whiteSpace: character === " " ? "pre" : undefined,
            color: String(params.color ?? "#fffaf0"),
            fontFamily,
            fontSize: Number(params.fontSize ?? defaultFontSize),
            opacity: reveal * exit,
            filter: `blur(${(1 - reveal) * 14}px)`,
            transform: `translateY(${(1 - reveal) * 90}px) rotate(${(1 - reveal) * 5}deg)`,
            display: "inline-block",
          }}>{character}</span>;
        })}
      </div>
      {subtitle && <div style={{
        // Sized off the frame, not in fixed pixels: 30px is a caption at 1080p and a
        // rumour at 4K.
        marginTop: width * .0177,
        // The subtitle used to inherit nothing and land in the host's default UI font —
        // the same "whichever font the machine happens to have" gamble as the headline.
        fontFamily,
        color: "#fff",
        fontSize: width * .0156,
        letterSpacing: width * .0042,
        textTransform: "uppercase",
        // Enters after the headline has finished assembling rather than on a fixed frame 30,
        // which on a long title used to put the small type up before the big type.
        opacity: interpolate(frame, [subtitleStart, subtitleStart + 24], [0, .82], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) * exit,
      }}>{subtitle}</div>}
    </AbsoluteFill>
  </AbsoluteFill>;
};

// The card this effect flies around the frame, as fractions of the composition. Its margins
// are symmetric on purpose (27% either side, 7% top and bottom) — that margin IS the travel
// budget below. Grown from 40x82: at the old size the photograph occupied a third of the
// frame and half the shot measured as bare background, which reads as an unfinished layout
// rather than as generous margin.
const ECHO_CARD = { left: .27, top: .07, width: .46, height: .86 };
const ECHO_MAX_TILT = 4; // degrees; the largest |rotate| keyframe

export const ImageEchoTrail = ({ assets, params }: EffectProps) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const copies = Math.max(5, Math.min(14, Math.round(Number(params.copies ?? 9))));

  // Travel used to be written as fixed viewport units — translate(-34vw, 12vh) at one end,
  // (32vw, -8vh) at the other — against a card that only has 30% of the width and 9% of the
  // height to spare. So the hero photograph left the canvas on BOTH sides (-4%..102%) and
  // clipped past the bottom edge, which is the off-canvas bleed the engine's preflight
  // rejects everywhere else. Derive the budget from the card's own margins instead, so the
  // authored motion SHAPE is preserved but cannot outgrow the frame at any resolution.
  const cardWidth = width * ECHO_CARD.width;
  const cardHeight = height * ECHO_CARD.height;
  const tilt = ECHO_MAX_TILT * Math.PI / 180;
  // A tilted rectangle occupies a larger box than an upright one; that growth is margin the
  // translation may not also spend.
  const spreadX = (cardWidth * Math.cos(tilt) + cardHeight * Math.sin(tilt) - cardWidth) / 2;
  const spreadY = (cardWidth * Math.sin(tilt) + cardHeight * Math.cos(tilt) - cardHeight) / 2;
  const budgetX = Math.max(0, width * ECHO_CARD.left - spreadX);
  const budgetY = Math.max(0, height * ECHO_CARD.top - spreadY);

  const positionAt = (at: number) => {
    const phase = Math.max(0, Math.min(1, at / durationInFrames));
    return {
      x: interpolate(phase, [0, .5, 1], [-1, .94, -.29]) * budgetX,
      y: interpolate(phase, [0, .5, 1], [1, -.67, .33]) * budgetY,
      rotate: interpolate(phase, [0, .5, 1], [-4, 3, -1]),
    };
  };
  // The white border is the whole difference between a photographic PRINT moving across a
  // page and a JPEG sliding across a background — it is the same mat FlyInDuo, PortraitEcho
  // and FloatingFrame already put around their photographs, and this template was the odd
  // one out. Only the lead copy wears it; a matted echo would smear white, not photograph.
  const mat = Math.round(Math.min(width, height) * .012);
  return <AbsoluteFill style={{ background: String(params.background ?? "#eee8df"), overflow: "hidden" }}>
    {Array.from({ length: copies }, (_, index) => {
      const delayed = frame - (copies - 1 - index) * 3;
      const position = positionAt(delayed);
      const isLead = index === copies - 1;
      return <Img key={index} src={staticFile(assets[0])} style={{
        position: "absolute",
        left: `${ECHO_CARD.left * 100}%`,
        top: `${ECHO_CARD.top * 100}%`,
        width: `${ECHO_CARD.width * 100}%`,
        height: `${ECHO_CARD.height * 100}%`,
        objectFit: "cover",
        objectPosition: focusPosition(params),
        transform: `translate(${position.x}px,${position.y}px) rotate(${position.rotate}deg)`,
        // The trail used to be eight barely-blurred rectangles stacked a few pixels apart,
        // which reads as a scanner artefact — a stepped ramp with visible straight edges —
        // rather than as motion. Blurred hard so they melt into one smear, but NOT faded
        // into nothing: an echo trail whose echoes cannot be seen is not a softer effect,
        // it is a still photograph. The nearest copy stays legible; the oldest is a breath.
        opacity: isLead ? 1 : .05 + index / copies * .17,
        filter: isLead ? "none" : `blur(${(copies - index) * 1.2}px)`,
        ...(isLead ? { background: "#fffdf9", padding: mat, boxShadow: "0 26px 64px rgba(25,20,16,.26)" } : {}),
        boxSizing: "border-box",
      }} />;
    })}
  </AbsoluteFill>;
};

export const AudioReactive = ({ assets, params }: EffectProps) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const supplied = Array.isArray(params.beatFrames)
    ? params.beatFrames.map(Number).filter(Number.isFinite)
    : [];
  const bpm = Math.max(40, Math.min(240, Number(params.bpm ?? 120)));
  const interval = fps * 60 / bpm;
  const beats = supplied.length > 0
    ? supplied
    : Array.from({ length: Math.ceil(durationInFrames / interval) + 1 }, (_, index) => index * interval);
  // A beat HITS and then decays; it does not swell in advance. The old |frame - beat| made
  // the pulse symmetric, so the photograph started brightening before the note landed.
  const elapsed = beats.reduce(
    (best, beat) => (beat <= frame && frame - beat < best ? frame - beat : best),
    Number.POSITIVE_INFINITY,
  );
  const pulse = Number.isFinite(elapsed) ? Math.exp(-elapsed * .16) : 0;
  // A SHOT, not just a modifier. Stripped of its visualiser rings this was a still
  // photograph with a faint flicker on it — nothing that earns a scene of its own. The beat
  // now rides on top of a slow push-in, so between beats the frame is still travelling, and
  // the pulse punctuates a move instead of interrupting a freeze.
  const push = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp" });
  const drift = (push - .5) * width * .01;
  return <AbsoluteFill style={{ background: "#090909", overflow: "hidden", alignItems: "center", justifyContent: "center" }}>
    <Img src={staticFile(assets[0])} style={{
      width: "100%",
      height: "100%",
      objectFit: "cover",
      objectPosition: focusPosition(params),
      // The floor used to be 0.72, i.e. the photograph sat 28% under-exposed for all of the
      // shot except the instants a beat landed on. On a wedding film the photograph is the
      // subject and the beat is punctuation, so the pulse now rides just above nominal
      // exposure instead of climbing out of a hole.
      filter: `brightness(${.94 + pulse * .1}) saturate(${1 + pulse * .12})`,
      transform: `translateX(${drift}px) scale(${1.02 + push * .05 + pulse * .018})`,
    }} />
    {/*
      Three concentric white rings used to sit dead centre, which on a portrait means over
      the couple's faces, and which reads as an audio visualiser — a club motif, not a
      wedding one. The beat is now carried by LIGHT: a warm bloom lifts off the centre and
      the corners release their weight, so the pulse is felt without anything being drawn on
      top of the photograph. Warm rather than neutral grey — this is candlelight, not a
      level meter.
    */}
    <AbsoluteFill style={{
      background: `radial-gradient(ellipse at 50% 46%, rgba(255,226,178,${.04 + pulse * .1}) 0%, ` +
        `rgba(0,0,0,0) 44%, rgba(38,22,10,${.30 - pulse * .13}) 100%)`,
    }} />
    <AbsoluteFill style={{
      // Halation: the beat blooms out of the highlights, the way film does, instead of
      // raising the whole frame's exposure like a dimmer switch.
      background: `radial-gradient(circle at 50% 44%, rgba(255,236,206,${pulse * .12}) 0%, rgba(255,236,206,0) ${Math.round(height * .034)}%)`,
      mixBlendMode: "screen",
    }} />
  </AbsoluteFill>;
};
