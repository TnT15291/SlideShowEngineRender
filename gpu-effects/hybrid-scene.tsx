import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GlTransition } from "./gl-transition";
import { ConfettiBloom } from "./confetti-bloom";
import { useBundledFont } from "./fonts";
import { focusPosition } from "./framing";
import {
  AudioReactive,
  DitherDissolve,
  GlassRefraction,
  ImageEchoTrail,
  KineticTypography,
  ParticleDissolve,
} from "./trending-effects";

export type HybridSceneProps = {
  template: "page_flip" | "filmstrip" | "title" | "portrait_echo" | "triptych" |
    "card_gallery" | "paper_peel" | "panel_reveal" | "floating_frame" | "light_rays" |
    "gl_transition" | "glass_frame" | "confetti_bloom" |
    "fly_in_duo" | "corner_fly_four" | "hero_filmstrip" |
    "depth_parallax_stack" | "radial_gallery" | "contact_sheet_zoom" |
    "ribbon_cascade" | "aperture_reveal" | "match_cut_windows" |
    "checker_mosaic" | "flash_burst" | "shared_frame_morph" |
    "kinetic_typography" | "dither_dissolve" |
    "image_echo_trail" | "glass_refraction" | "audio_reactive" |
    "particle_dissolve";
  assets: string[];
  params?: Record<string, unknown>;
  durationInFrames?: number;
};

export const HybridScene = ({ template, assets, params = {} }: HybridSceneProps) => {
  if (template === "page_flip") return <PageFlip assets={assets} params={params} />;
  if (template === "filmstrip") return <Filmstrip assets={assets} params={params} />;
  if (template === "portrait_echo") return <PortraitEcho assets={assets} />;
  if (template === "triptych") return <Triptych assets={assets} />;
  if (template === "card_gallery") return <CardGallery assets={assets} />;
  if (template === "paper_peel") return <PaperPeel assets={assets} />;
  if (template === "panel_reveal") return <PanelReveal assets={assets} />;
  if (template === "floating_frame") return <FloatingFrame assets={assets} />;
  if (template === "light_rays") return <LightRays assets={assets} />;
  if (template === "gl_transition") return <GlTransition assets={assets} params={params} />;
  if (template === "glass_frame") return <GlassFrame assets={assets} params={params} />;
  if (template === "confetti_bloom") return <ConfettiBloom assets={assets} params={params} />;
  if (template === "fly_in_duo") return <FlyInDuo assets={assets} />;
  if (template === "corner_fly_four") return <CornerFlyFour assets={assets} />;
  if (template === "hero_filmstrip") return <HeroFilmstrip assets={assets} params={params} />;
  if (template === "depth_parallax_stack") return <DepthParallaxStack assets={assets} />;
  if (template === "radial_gallery") return <RadialGallery assets={assets} />;
  if (template === "contact_sheet_zoom") return <ContactSheetZoom assets={assets} />;
  if (template === "ribbon_cascade") return <RibbonCascade assets={assets} />;
  if (template === "aperture_reveal") return <ApertureReveal assets={assets} />;
  if (template === "match_cut_windows") return <MatchCutWindows assets={assets} />;
  if (template === "checker_mosaic") return <CheckerMosaic assets={assets} params={params} />;
  if (template === "flash_burst") return <FlashBurst assets={assets} />;
  if (template === "shared_frame_morph") return <SharedFrameMorph assets={assets} params={params} />;
  if (template === "kinetic_typography") return <KineticTypography assets={assets} params={params} />;
  if (template === "dither_dissolve") return <DitherDissolve assets={assets} params={params} />;
  if (template === "image_echo_trail") return <ImageEchoTrail assets={assets} params={params} />;
  if (template === "glass_refraction") return <GlassRefraction assets={assets} params={params} />;
  if (template === "audio_reactive") return <AudioReactive assets={assets} params={params} />;
  if (template === "particle_dissolve") return <ParticleDissolve assets={assets} params={params} />;
  return <TitleCard assets={assets} params={params} />;
};

// THE FRAME THESE TEMPLATES WERE DRAWN AGAINST.
//
// Positions here are percentages, but the distances things TRAVEL were tuned by eye and
// then written as literal pixels — ±1100 for a fly-in, ±650 for a corner entrance. A literal
// pixel is only correct at exactly one output size. At 640x360 the ±1100px card is nearly
// two frame widths away, so a fifth of the way into the shot it has not arrived yet and the
// render is a bare background; test/regression/hybrid-scene-render.test.mjs measured
// hero_filmstrip as a completely flat frame at that size, and fly_in_duo, corner_fly_four
// and ribbon_cascade as 99-100% empty.
//
// The authored numbers are SCALED rather than re-derived from each card's geometry: scaling
// reproduces the 1920x1080 composition — the one that was reviewed, rendered and shipped —
// exactly, at any output size, and `scaleX(1920) === 1` keeps that guarantee checkable.
const AUTHORED_WIDTH = 1920;
const AUTHORED_HEIGHT = 1080;
const scaleX = (width: number) => width / AUTHORED_WIDTH;
const scaleY = (height: number) => height / AUTHORED_HEIGHT;

const enterHoldExit = (frame: number, duration: number, distance: number) =>
  interpolate(
    frame,
    [0, duration * 0.18, duration * 0.78, duration],
    [distance, 0, 0, distance],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

const FlyInDuo = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const travel = 1100 * scaleX(width);
  const leftX = enterHoldExit(frame, durationInFrames, -travel);
  const rightX = enterHoldExit(frame, durationInFrames, travel);
  return <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%,#fff,#e8e2d9)", overflow: "hidden" }}>
    {[leftX, rightX].map((x, i) => <Img key={i} src={safeAsset(assets, i)} style={{
      position: "absolute", left: i ? "52%" : "8%", top: i ? "14%" : "9%",
      width: "40%", height: "78%", objectFit: "cover", background: "white", padding: 12,
      transform: `translateX(${x}px) rotate(${i ? 2.5 : -2.5}deg)`,
      boxShadow: "0 24px 55px rgba(32,24,18,.24)",
    }} />)}
  </AbsoluteFill>;
};

const CornerFlyFour = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const positions = [
    { left: "7%", top: "8%", x: -900, y: -650, r: -4 },
    { left: "53%", top: "6%", x: 900, y: -650, r: 3 },
    { left: "10%", top: "53%", x: -900, y: 650, r: 2 },
    { left: "56%", top: "50%", x: 900, y: 650, r: -3 },
  ];
  return <AbsoluteFill style={{ background: "linear-gradient(135deg,#f7f2ea,#ddd5c8)", overflow: "hidden" }}>
    {positions.map((p, i) => {
      const x = enterHoldExit(frame, durationInFrames, p.x * scaleX(width));
      const y = enterHoldExit(frame, durationInFrames, p.y * scaleY(height));
      return <Img key={i} src={safeAsset(assets, i)} style={{
        position: "absolute", left: p.left, top: p.top, width: "37%", height: "39%",
        objectFit: "cover", background: "white", padding: 9,
        transform: `translate(${x}px,${y}px) rotate(${p.r}deg)`,
        boxShadow: "0 18px 42px rgba(35,28,20,.2)",
      }} />;
    })}
  </AbsoluteFill>;
};

const HeroFilmstrip = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const heroX = enterHoldExit(frame, durationInFrames, -900 * scaleX(width));
  const stripX = enterHoldExit(frame, durationInFrames, 720 * scaleX(width));
  const travel = interpolate(frame, [0, durationInFrames], [-80, 80]) * scaleY(height);
  return <AbsoluteFill style={{ background: String(params.background ?? "#181512"), overflow: "hidden" }}>
    <Img src={safeAsset(assets, 0)} style={{
      position: "absolute", left: "5%", top: "7%", width: "65%", height: "86%",
      objectFit: "cover", transform: `translateX(${heroX}px)`, boxShadow: "0 25px 65px #0008",
    }} />
    <div style={{
      position: "absolute", right: "4%", top: "-12%", width: "24%", height: "124%",
      transform: `translateX(${stripX}px) translateY(${travel}px) rotate(2deg)`,
      background: "#0a0908", padding: "42px 18px", borderLeft: "10px dashed #d7c9ad",
      borderRight: "10px dashed #d7c9ad", display: "flex", flexDirection: "column", gap: 24,
    }}>
      {[1, 2, 3, 4].map((i) => <Img key={i} src={safeAsset(assets, i)} style={{
        width: "100%", height: "23%", objectFit: "cover", border: "8px solid #f5efe4",
        boxSizing: "border-box",
      }} />)}
    </div>
  </AbsoluteFill>;
};

const DepthParallaxStack = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const phase = interpolate(frame, [0, durationInFrames], [-1, 1]);
  const cards = [
    { left: 7, top: 17, width: 31, depth: .76, rotate: -7 },
    { left: 27, top: 7, width: 38, depth: 1, rotate: 2 },
    { left: 59, top: 19, width: 31, depth: .82, rotate: 6 },
    { left: 37, top: 48, width: 30, depth: .9, rotate: -2 },
  ];
  return <AbsoluteFill style={{ background: "radial-gradient(circle at 50% 45%,#f8f5ee,#cfc7ba)", perspective: 1500, overflow: "hidden" }}>
    {cards.map((card, i) => <Img key={i} src={safeAsset(assets, i)} style={{
      position: "absolute", left: `${card.left}%`, top: `${card.top}%`, width: `${card.width}%`,
      height: i === 3 ? "43%" : "64%", objectFit: "cover", padding: 10, background: "#fff",
      transform: `translate3d(${phase * (i - 1.5) * 70}px,${phase * (1.5 - i) * 24}px,${card.depth * 120}px) rotate(${card.rotate}deg) scale(${card.depth})`,
      boxShadow: "0 24px 58px rgba(35,28,20,.28)",
    }} />)}
  </AbsoluteFill>;
};

const RadialGallery = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const turn = interpolate(frame, [0, durationInFrames], [-18, 18]);
  const radius = interpolate(frame, [0, durationInFrames * .2], [80, 330], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "radial-gradient(circle,#fffdf8,#ded7cb)", overflow: "hidden" }}>
    {Array.from({ length: 6 }, (_, i) => {
      const angle = (i * 60 + turn) * Math.PI / 180;
      return <Img key={i} src={safeAsset(assets, i)} style={{
        position: "absolute", left: `calc(50% + ${Math.cos(angle) * radius}px - 150px)`,
        top: `calc(50% + ${Math.sin(angle) * radius * .65}px - 190px)`,
        width: 300, height: 380, objectFit: "cover", padding: 8, background: "white",
        transform: `rotate(${i * 60 + turn + 90}deg)`, boxShadow: "0 16px 38px #46382938",
      }} />;
    })}
  </AbsoluteFill>;
};

const ContactSheetZoom = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const scale = interpolate(frame, [durationInFrames * .5, durationInFrames], [1, 2.25], { extrapolateLeft: "clamp" });
  const assemble = interpolate(frame, [0, durationInFrames * .22], [90, 0], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#111", overflow: "hidden" }}>
    <div style={{
      position: "absolute", inset: "5%", display: "grid", gridTemplateColumns: "repeat(3,1fr)",
      gridTemplateRows: "repeat(3,1fr)", gap: 12, transform: `scale(${scale}) translate(-8%,6%)`,
      transformOrigin: "66% 33%",
    }}>
      {Array.from({ length: 9 }, (_, i) => <Img key={i} src={safeAsset(assets, i)} style={{
        width: "100%", height: "100%", objectFit: "cover",
        transform: `translateY(${assemble * (i % 2 ? 1 : -1)}px)`,
        opacity: interpolate(frame, [i * 2, i * 2 + 18], [0, 1], { extrapolateRight: "clamp" }),
      }} />)}
    </div>
  </AbsoluteFill>;
};

const RibbonCascade = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const sx = scaleX(width);
  return <AbsoluteFill style={{ background: "linear-gradient(120deg,#eee8dc,#faf8f3)", overflow: "hidden" }}>
    {Array.from({ length: 6 }, (_, i) => {
      const delay = i * 5;
      const x = interpolate(frame, [delay, delay + 24, durationInFrames * .8, durationInFrames], [-850 * sx, 0, 0, 900 * sx], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return <Img key={i} src={safeAsset(assets, i)} style={{
        position: "absolute", left: `${4 + i * 16}%`, top: `${8 + (i % 2) * 14}%`,
        width: "23%", height: "72%", objectFit: "cover", padding: 8, background: "#fff",
        transform: `translateX(${x}px) rotate(${(i - 2.5) * 3}deg)`,
        boxShadow: "0 20px 44px #392e2535",
      }} />;
    })}
  </AbsoluteFill>;
};

const ApertureReveal = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const close = interpolate(frame, [durationInFrames * .28, durationInFrames * .48, durationInFrames * .58, durationInFrames * .78], [100, 0, 0, 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#090908", overflow: "hidden" }}>
    <Img src={safeAsset(assets, 1)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    <AbsoluteFill style={{ clipPath: `circle(${close}% at 50% 50%)` }}>
      <Img src={safeAsset(assets, 0)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    </AbsoluteFill>
    {Array.from({ length: 6 }, (_, i) => <div key={i} style={{
      position: "absolute", left: "50%", top: "50%", width: "54%", height: 4,
      transformOrigin: "left center", transform: `rotate(${i * 60 + frame * .35}deg)`,
      background: "linear-gradient(90deg,#fff9,transparent)", mixBlendMode: "screen",
    }} />)}
  </AbsoluteFill>;
};

const MatchCutWindows = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width } = useVideoConfig();
  const segment = durationInFrames / 3;
  // Img is 130% of its window, centered via left:-15% so it overflows 15%
  // each side. translateX must stay inside that per-side budget or it drags
  // the image off one edge and exposes the AbsoluteFill's #111 behind it —
  // this used to run fixed ±110px regardless of window width, so at 1920px
  // (window = 640px, budget = 96px) the middle/right windows opened a bare
  // gap on their left edge for a third of the clip. 0.85 keeps a safety
  // margin against rounding.
  const maxShift = (width / 3) * 0.15 * 0.85;
  // AbsoluteFill defaults to flexDirection:"column" when the passed style doesn't
  // set one (see remotion/dist/AbsoluteFill.js) — without this override the three
  // windows stacked vertically and shrank to ~33% height each, leaving 66% of the
  // frame as bare #111 to their right. Confirmed by rendering match_cut_windows
  // with 3 real assets: only window 0 painted, windows 1-2 exposed the background.
  return <AbsoluteFill style={{ background: "#111", overflow: "hidden", display: "flex", flexDirection: "row" }}>
    {Array.from({ length: 3 }, (_, i) => {
      const local = frame - i * segment;
      const x = interpolate(local, [-segment, 0, segment], [maxShift, 0, -maxShift], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      return <div key={i} style={{ width: "33.34%", height: "100%", overflow: "hidden", borderRight: "5px solid #fff" }}>
        <Img src={safeAsset(assets, i)} style={{ width: "130%", height: "100%", objectFit: "cover", position: "relative", left: "-15%", transform: `translateX(${x}px)` }} />
      </div>;
    })}
  </AbsoluteFill>;
};

const CheckerMosaic = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const columns = Math.max(4, Math.min(12, Math.round(Number(params.columns ?? 8))));
  const rows = Math.max(3, Math.min(8, Math.round(Number(params.rows ?? 5))));
  const progress = interpolate(
    frame,
    [durationInFrames * .18, durationInFrames * .72],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const from = safeAsset(assets, 0);
  const to = safeAsset(assets, 1);
  const cells = Array.from({ length: columns * rows }, (_, index) => {
    const x = index % columns;
    const y = Math.floor(index / columns);
    const order = (x * 3 + y * 5) % (columns + rows);
    const threshold = order / Math.max(1, columns + rows - 1);
    const local = Math.max(0, Math.min(1, (progress - threshold * .72) / .28));
    return { x, y, local };
  });
  return <AbsoluteFill style={{ background: "#fff", overflow: "hidden" }}>
    <Img src={from} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
    {cells.map(({ x, y, local }) => <div key={`${x}-${y}`} style={{
      position: "absolute",
      left: `${x * 100 / columns}%`,
      top: `${y * 100 / rows}%`,
      width: `${100 / columns + .08}%`,
      height: `${100 / rows + .08}%`,
      overflow: "hidden",
      opacity: local,
      transform: `scale(${.72 + local * .28}) rotate(${(1 - local) * ((x + y) % 2 ? 5 : -5)}deg)`,
    }}>
      <Img src={to} style={{
        position: "absolute",
        left: `${-x * 100}%`,
        top: `${-y * 100}%`,
        width: `${columns * 100}%`,
        height: `${rows * 100}%`,
        objectFit: "cover",
      }} />
    </div>)}
  </AbsoluteFill>;
};

const FlashBurst = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const midpoint = durationInFrames * .48;
  const reveal = interpolate(
    frame,
    [midpoint - durationInFrames * .08, midpoint + durationInFrames * .08],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const flash = interpolate(
    frame,
    [midpoint - durationInFrames * .16, midpoint, midpoint + durationInFrames * .18],
    [0, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const rayScale = interpolate(flash, [0, 1], [.35, 1.9]);
  return <AbsoluteFill style={{ background: "#fff", overflow: "hidden" }}>
    <Img src={safeAsset(assets, reveal < .5 ? 0 : 1)} style={{
      width: "100%", height: "100%", objectFit: "cover",
      transform: `scale(${1 + flash * .035})`,
    }} />
    <AbsoluteFill style={{
      opacity: flash,
      background: "white",
      mixBlendMode: "screen",
    }} />
    <div style={{
      position: "absolute", left: "50%", top: "50%", width: "18%", aspectRatio: "1",
      transform: `translate(-50%,-50%) scale(${rayScale})`,
      opacity: flash,
      background: "repeating-conic-gradient(from 0deg,rgba(255,255,255,.98) 0deg 3deg,transparent 3deg 9deg)",
      filter: "blur(2px)",
      mixBlendMode: "screen",
    }} />
  </AbsoluteFill>;
};

const SharedFrameMorph = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const requestedHero = Math.round(Number(params.heroIndex ?? 0));
  const heroIndex = Math.max(0, Math.min(3, requestedHero));
  const progress = interpolate(
    frame,
    [durationInFrames * .22, durationInFrames * .62],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const smooth = progress * progress * (3 - 2 * progress);
  const gap = Math.round(Math.min(width, height) * .025);
  const marginX = Math.round(width * .08);
  const marginY = Math.round(height * .09);
  const tileWidth = (width - marginX * 2 - gap) / 2;
  const tileHeight = (height - marginY * 2 - gap) / 2;
  const heroMargin = Math.round(Math.min(width, height) * .035);
  const target = {
    x: heroMargin,
    y: heroMargin,
    width: width - heroMargin * 2,
    height: height - heroMargin * 2,
  };

  // The morph occupies [.22,.62] of the shot, and the two ends outside it used to be
  // PIXEL-identical frames: measured on a 120-frame sample, 27 frames of frozen 2x2 gallery
  // followed by 44 frames of frozen hero — 37% of the shot standing perfectly still, which
  // on a premium scene of 9s is over three seconds of dead air. A slow push-in gives both
  // held ends the same life a native ken-burns scene has. It is applied to the whole scene
  // uniformly and NOT per card, because the reason this morph reads as one continuous object
  // is that the tile and the hero share an aspect ratio (1.845 vs 1.836) and therefore the
  // same `cover` crop — anything that scales one and not the other breaks exactly that.
  const camera = interpolate(frame, [0, durationInFrames], [0, 1], { extrapolateRight: "clamp" });
  // 1.03 is the ceiling: past it the push swallows the hero's inset margin and the frame
  // loses the dark border the composition ends on.
  const zoom = 1 + camera * .03;
  const driftX = (camera - .5) * width * .008;
  const driftY = (camera - .5) * height * -.006;

  // A PAGE OF PRINTS, NOT A DASHBOARD. The costume this motion used to wear — four 22px
  // rounded cards, heavy drop shadows, a near-black #171513 ground — is the visual language
  // of a software product page, and it arrived in the middle of films whose own themes
  // describe themselves as "soft, elegant, warm, editorial". The move underneath was always
  // good; only the dressing was wrong. Ivory ground, a white mat around each photograph, a
  // corner radius small enough to read as a trimmed print, and a shadow that suggests paper
  // lying on paper rather than a card floating over a screen.
  //
  // The mat retreats to nothing as the hero grows: a print laid on a page has a border, a
  // photograph filling the frame does not.
  const mat = Math.round(Math.min(width, height) * .013);
  const heroMat = Math.round(mat * (1 - smooth));
  return <AbsoluteFill style={{ background: String(params.background ?? "#f4ede2"), overflow: "hidden" }}>
    <AbsoluteFill style={{ transform: `translate(${driftX}px,${driftY}px) scale(${zoom})` }}>
      {Array.from({ length: 4 }, (_, i) => {
        const column = i % 2;
        const row = Math.floor(i / 2);
        const start = {
          x: marginX + column * (tileWidth + gap),
          y: marginY + row * (tileHeight + gap),
        };
        const isHero = i === heroIndex;
        const x = isHero ? start.x + (target.x - start.x) * smooth : start.x;
        const y = isHero ? start.y + (target.y - start.y) * smooth : start.y;
        const cardWidth = isHero ? tileWidth + (target.width - tileWidth) * smooth : tileWidth;
        const cardHeight = isHero ? tileHeight + (target.height - tileHeight) * smooth : tileHeight;
        const dx = column ? width * .08 : -width * .08;
        const dy = row ? height * .06 : -height * .06;
        const padding = isHero ? heroMat : mat;
        return <div key={i} style={{
          position: "absolute",
          left: x,
          top: y,
          width: cardWidth,
          height: cardHeight,
          zIndex: isHero ? 2 : 1,
          overflow: "hidden",
          background: "#fffdf9",
          padding,
          boxSizing: "border-box",
          borderRadius: isHero ? 5 * (1 - smooth) : 5,
          opacity: isHero ? 1 : 1 - smooth,
          transform: isHero ? "none" : `translate(${dx * smooth}px,${dy * smooth}px) scale(${1 - smooth * .08})`,
          boxShadow: `0 ${10 + smooth * 10}px ${26 + smooth * 20}px rgba(78,62,44,${.16 - smooth * .05})`,
        }}>
          {/* focusPosition, not the centre: a wedding portrait cover-fitted into a 1.8:1
              tile is cropped top and bottom, and a centred crop takes the heads off first —
              which is exactly what this gallery used to do to all four photographs. */}
          <Img src={safeAsset(assets, i)} style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            objectPosition: focusPosition(params),
          }} />
        </div>;
      })}
    </AbsoluteFill>
  </AbsoluteFill>;
};

const PageFlip = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const turnStart = durationInFrames * 0.38;
  const turnEnd = durationInFrames * 0.68;
  const angle = interpolate(frame, [turnStart, turnEnd], [0, -180], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const first = staticFile(assets[0]);
  const second = staticFile(assets[1] ?? assets[0]);
  const paper = String(params.paperColor ?? "#f7f3eb");
  return (
    <AbsoluteFill style={{ background: `radial-gradient(circle at 50% 40%, ${paper}, #c9c1b4)`, perspective: 1800 }}>
      <PhotoPage src={second} />
      <div style={{ position: "absolute", inset: "6% 18%", transformOrigin: "left center", transformStyle: "preserve-3d", transform: `rotateY(${angle}deg)`, filter: "drop-shadow(25px 20px 28px rgba(40,30,20,.28))" }}>
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", background: paper }}><Photo src={first} /></div>
        <div style={{ position: "absolute", inset: 0, backfaceVisibility: "hidden", transform: "rotateY(180deg)", background: paper }}><Photo src={second} /></div>
      </div>
    </AbsoluteFill>
  );
};

const PhotoPage = ({ src }: { src: string }) => <div style={{ position: "absolute", inset: "6% 18%", background: "#f7f3eb", boxShadow: "0 32px 70px rgba(40,30,20,.25)" }}><Photo src={src} /></div>;
const Photo = ({ src }: { src: string }) => <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain", padding: "4%", boxSizing: "border-box" }} />;

const Filmstrip = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const speed = Number(params.speed ?? 3);
  const shift = -(frame * speed) % 520;
  const repeated = [...assets, ...assets, ...assets];
  return <AbsoluteFill style={{ background: String(params.background ?? "#12100f"), overflow: "hidden", justifyContent: "center" }}>
    <div style={{ display: "flex", gap: 28, transform: `translateX(${shift}px) rotate(-2deg)`, width: "max-content", padding: "34px 0", borderTop: "18px dashed #e9dfca", borderBottom: "18px dashed #e9dfca" }}>
      {repeated.map((asset, i) => <Img key={`${asset}-${i}`} src={staticFile(asset)} style={{ width: 430, height: 700, objectFit: "contain", background: "#fff", padding: 14 }} />)}
    </div>
  </AbsoluteFill>;
};

const TitleCard = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 24], [0, 1], { extrapolateRight: "clamp" });
  const src = staticFile(assets[0]);
  // Same Vietnamese tone-mark break kinetic_typography had — this card names params.title
  // too, and "Georgia, serif" cannot draw ố or ầ. See gpu-effects/fonts.ts.
  const fontFamily = useBundledFont(params.fontFamily ?? "fonts/CormorantGaramond-Regular.ttf");
  return <AbsoluteFill style={{ background: "#eeeae3", alignItems: "center", justifyContent: "center" }}>
    <AbsoluteFill><Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(28px)", opacity: .22, transform: "scale(1.08)" }} /></AbsoluteFill>
    <Img src={src} style={{ width: "48%", height: "84%", objectFit: "contain", boxShadow: "0 28px 70px rgba(0,0,0,.25)" }} />
    <div style={{ position: "absolute", bottom: "9%", color: "white", fontFamily, fontSize: 62, textShadow: "0 3px 18px #000", opacity }}>{String(params.title ?? "Our Wedding")}</div>
  </AbsoluteFill>;
};

const safeAsset = (assets: string[], index: number) => staticFile(assets[index % assets.length]);

const PortraitEcho = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 180], [-34, 34], { extrapolateRight: "clamp" });
  const src = safeAsset(assets, 0);
  return <AbsoluteFill style={{ background: "linear-gradient(110deg,#f3f2ef,#d8d9d8)", overflow: "hidden" }}>
    {[-1, 1].map((side) => <Img key={side} src={src} style={{ position: "absolute", width: "32%", height: "74%", objectFit: "contain", left: side < 0 ? "7%" : "61%", top: "13%", opacity: .22, filter: "blur(7px)", transform: `translateX(${side * drift}px) scale(.92)` }} />)}
    <Img src={src} style={{ position: "absolute", width: "38%", height: "84%", objectFit: "contain", left: "31%", top: "8%", background: "white", padding: 12, boxShadow: "0 18px 48px rgba(0,0,0,.22)" }} />
  </AbsoluteFill>;
};

const Triptych = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{ background: "#eee", flexDirection: "row", gap: 18, padding: "5% 6%" }}>
    {[0, 1, 2].map((i) => <Img key={i} src={safeAsset(assets, i)} style={{ width: "33%", height: "100%", objectFit: "contain", background: "white", transform: `translateY(${interpolate(frame, [0, 40], [i % 2 ? 45 : -45, 0], { extrapolateRight: "clamp" })}px)`, boxShadow: "0 12px 30px rgba(0,0,0,.15)" }} />)}
  </AbsoluteFill>;
};

const CardGallery = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const angle = interpolate(frame, [0, 180], [-10, 10], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "radial-gradient(circle,#fff,#d8d8d8)", perspective: 1300, overflow: "hidden" }}>
    {[0, 1, 2].map((i) => <Img key={i} src={safeAsset(assets, i)} style={{ position: "absolute", width: "30%", height: "76%", objectFit: "contain", background: "white", padding: 10, left: `${12 + i * 23}%`, top: `${12 + Math.abs(1 - i) * 5}%`, transform: `rotateY(${angle + (i - 1) * 13}deg) translateZ(${i === 1 ? 90 : 0}px)`, boxShadow: "0 20px 42px rgba(0,0,0,.25)" }} />)}
  </AbsoluteFill>;
};

const PaperPeel = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const reveal = interpolate(frame, [0, durationInFrames * .7], [8, 100], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#eee" }}>
    <Img src={safeAsset(assets, 1)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    <AbsoluteFill style={{ clipPath: `polygon(0 0, ${reveal}% 0, ${Math.max(0, reveal - 18)}% 100%, 0 100%)`, filter: "drop-shadow(18px 0 20px rgba(0,0,0,.3))" }}><Img src={safeAsset(assets, 0)} style={{ width: "100%", height: "100%", objectFit: "contain", background: "white" }} /></AbsoluteFill>
  </AbsoluteFill>;
};

const PanelReveal = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const open = interpolate(frame, [0, durationInFrames * .42], [0, 51], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#eee" }}>
    <Img src={safeAsset(assets, 0)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${51 - open}%`, background: "linear-gradient(90deg,#ddd,#fff)", boxShadow: "8px 0 20px rgba(0,0,0,.14)" }} />
    <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: `${51 - open}%`, background: "linear-gradient(270deg,#ddd,#fff)", boxShadow: "-8px 0 20px rgba(0,0,0,.14)" }} />
  </AbsoluteFill>;
};

const FloatingFrame = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const src = safeAsset(assets, 0);
  const x = interpolate(frame, [0, 180], [-24, 24], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "#ddd", overflow: "hidden" }}>
    <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(9px) brightness(.72)", transform: "scale(1.1)" }} />
    <Img src={src} style={{ position: "absolute", width: "34%", height: "72%", objectFit: "contain", left: "33%", top: "14%", padding: 10, background: "white", transform: `translateX(${x}px) rotateY(${x / 8}deg)`, boxShadow: "0 22px 52px rgba(0,0,0,.35)" }} />
  </AbsoluteFill>;
};

const GlassFrame = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  const src = safeAsset(assets, 0);
  const sweep = interpolate(frame, [durationInFrames * 0.1, durationInFrames * 0.45], [-60, 140], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const rise = interpolate(frame, [0, 20], [24, 0], { extrapolateRight: "clamp" });
  const tint = String(params.tint ?? "255,255,255");
  return (
    <AbsoluteFill style={{ background: "#1c1a17", overflow: "hidden" }}>
      <AbsoluteFill><Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(38px) brightness(.5) saturate(1.15)", transform: "scale(1.15)" }} /></AbsoluteFill>
      <div style={{ position: "absolute", left: "24%", top: "10%", width: "52%", height: "80%", transform: `translateY(${rise}px)`, background: `rgba(${tint},.14)`, backdropFilter: "blur(22px) saturate(165%)", border: `1px solid rgba(${tint},.45)`, boxShadow: `0 30px 70px rgba(0,0,0,.4), inset 0 0 40px rgba(${tint},.15)`, padding: 16, overflow: "hidden" }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
        <div style={{ position: "absolute", top: 0, bottom: 0, left: `${sweep}%`, width: "22%", background: `linear-gradient(75deg, transparent, rgba(${tint},.5), transparent)`, mixBlendMode: "screen" }} />
      </div>
    </AbsoluteFill>
  );
};

const LightRays = ({ assets }: { assets: string[] }) => {
  const frame = useCurrentFrame();
  const pulse = interpolate(frame, [0, 60, 120], [.32, .62, .38], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ background: "white" }}>
    <Img src={safeAsset(assets, 0)} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
    <AbsoluteFill style={{ opacity: pulse, mixBlendMode: "screen", background: "conic-gradient(from 205deg at 8% 0%,transparent 0deg,rgba(255,255,255,.95) 8deg,transparent 18deg,rgba(255,244,210,.8) 28deg,transparent 42deg)" }} />
  </AbsoluteFill>;
};
