import { Composition } from "remotion";
import { PageFlipDemo } from "./page-flip";
import { HybridScene } from "./hybrid-scene";

export const GpuEffectsRoot = () => (
  <>
    <Composition
      id="PageFlipDemo"
      component={PageFlipDemo}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
    <Composition
      id="HybridScene"
      component={HybridScene}
      durationInFrames={300}
      fps={30}
      width={1920}
      height={1080}
      defaultProps={{ template: "title", assets: ["gpu-effects/page-a.jpg"], params: {}, durationInFrames: 300 }}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.max(1, Math.round(props.durationInFrames ?? 300)),
      })}
    />
  </>
);
