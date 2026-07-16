import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { TransitionSeries, springTiming } from "@remotion/transitions";
import { flip } from "@remotion/transitions/flip";

const StudioPage = ({ src, side }: { src: string; side: "left" | "right" }) => {
  const frame = useCurrentFrame();
  const drift = interpolate(frame, [0, 150], [side === "left" ? -18 : 18, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg, #fff 0%, #f4f0e8 52%, #ddd7cc 100%)" }}>
      <AbsoluteFill style={{ filter: "blur(30px)", opacity: 0.22, transform: "scale(1.12)" }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </AbsoluteFill>
      <div
        style={{
          position: "absolute",
          left: "27%",
          top: "8%",
          width: "46%",
          height: "80%",
          padding: 22,
          background: "white",
          boxShadow: "0 38px 85px rgba(45, 38, 30, 0.28)",
          transform: `translateX(${drift}px)`,
        }}
      >
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
      </div>
      <div
        style={{
          position: "absolute",
          left: "27%",
          top: "89%",
          width: "46%",
          height: "9%",
          background: "linear-gradient(to bottom, rgba(90,80,68,.20), transparent)",
          filter: "blur(8px)",
          transform: "scaleY(-1)",
          opacity: 0.45,
        }}
      />
    </AbsoluteFill>
  );
};

export const PageFlipDemo = () => (
  <TransitionSeries>
    <TransitionSeries.Sequence durationInFrames={90}>
      <StudioPage src={staticFile("gpu-effects/page-a.jpg")} side="left" />
    </TransitionSeries.Sequence>
    <TransitionSeries.Transition
      presentation={flip({ direction: "from-right", perspective: 1100 })}
      timing={springTiming({ durationInFrames: 30, config: { damping: 18, stiffness: 120 } })}
    />
    <TransitionSeries.Sequence durationInFrames={90}>
      <StudioPage src={staticFile("gpu-effects/page-b.jpg")} side="right" />
    </TransitionSeries.Sequence>
  </TransitionSeries>
);
