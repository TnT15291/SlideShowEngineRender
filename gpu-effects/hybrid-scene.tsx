import React from "react";
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { GlTransition } from "./gl-transition";
import { ConfettiBloom } from "./confetti-bloom";

export type HybridSceneProps = {
  template: "page_flip" | "filmstrip" | "title" | "portrait_echo" | "triptych" |
    "card_gallery" | "paper_peel" | "panel_reveal" | "floating_frame" | "light_rays" |
    "gl_transition" | "glass_frame" | "confetti_bloom";
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
  return <TitleCard assets={assets} params={params} />;
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
  return <AbsoluteFill style={{ background: "#eeeae3", alignItems: "center", justifyContent: "center" }}>
    <AbsoluteFill><Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "blur(28px)", opacity: .22, transform: "scale(1.08)" }} /></AbsoluteFill>
    <Img src={src} style={{ width: "48%", height: "84%", objectFit: "contain", boxShadow: "0 28px 70px rgba(0,0,0,.25)" }} />
    <div style={{ position: "absolute", bottom: "9%", color: "white", fontFamily: "Georgia, serif", fontSize: 62, textShadow: "0 3px 18px #000", opacity }}>{String(params.title ?? "Our Wedding")}</div>
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
