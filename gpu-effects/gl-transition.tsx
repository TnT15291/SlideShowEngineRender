import React, { useEffect, useMemo, useState } from "react";
import { continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const glTransitions: any[] = require("gl-transitions");

// Curated for wedding highlight reveals — full catalog has 125 entries, most are
// glitch/VHS demo shaders that read as cheap rather than "thịnh hành" for this genre.
export const CURATED_GL_TRANSITIONS = [
  "heart", "kaleidoscope", "cube", "doorway", "circleopen",
  "ripple", "windowslice", "DreamyZoom", "FilmBurn", "morph",
] as const;

const VERTEX = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

function buildFragmentShader(glsl: string): string {
  return `
    varying vec2 vUv;
    uniform sampler2D from;
    uniform sampler2D to;
    uniform vec2 fromSize;
    uniform vec2 toSize;
    uniform vec2 resolution;
    uniform float progress;
    uniform float ratio;

    vec2 coverUv(vec2 uv, vec2 texSize, vec2 outSize) {
      float texAspect = texSize.x / texSize.y;
      float outAspect = outSize.x / outSize.y;
      vec2 scale = texAspect > outAspect ? vec2(outAspect / texAspect, 1.0) : vec2(1.0, texAspect / outAspect);
      return (uv - 0.5) * scale + 0.5;
    }
    vec4 getFromColor(vec2 uv) { return texture2D(from, coverUv(uv, fromSize, resolution)); }
    vec4 getToColor(vec2 uv) { return texture2D(to, coverUv(uv, toSize, resolution)); }

    ${glsl}

    void main() {
      gl_FragColor = transition(vUv);
    }
  `;
}

function useImageTexture(src: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const handle = delayRender(`gl_transition texture ${src}`);
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

const TransitionPlane = ({
  from, to, glsl, progress, extraUniforms, width, height,
}: {
  from: THREE.Texture; to: THREE.Texture; glsl: string; progress: number;
  extraUniforms: Record<string, unknown>; width: number; height: number;
}) => {
  const material = useMemo(() => {
    const uniforms: Record<string, { value: unknown }> = {
      from: { value: from },
      to: { value: to },
      fromSize: { value: new THREE.Vector2((from.image as HTMLImageElement).width, (from.image as HTMLImageElement).height) },
      toSize: { value: new THREE.Vector2((to.image as HTMLImageElement).width, (to.image as HTMLImageElement).height) },
      resolution: { value: new THREE.Vector2(width, height) },
      progress: { value: 0 },
      ratio: { value: width / height },
    };
    for (const [key, value] of Object.entries(extraUniforms)) uniforms[key] = { value };
    return new THREE.ShaderMaterial({ uniforms, vertexShader: VERTEX, fragmentShader: buildFragmentShader(glsl), depthTest: false, depthWrite: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, glsl]);
  material.uniforms.progress.value = progress;
  return <mesh material={material}><planeGeometry args={[2, 2]} /></mesh>;
};

export const GlTransition = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const requested = String(params.name ?? "heart");
  const name = (CURATED_GL_TRANSITIONS as readonly string[]).includes(requested) ? requested : "heart";
  const entry = glTransitions.find((t) => t.name === name);
  const fromTex = useImageTexture(staticFile(assets[0]));
  const toTex = useImageTexture(staticFile(assets[1] ?? assets[0]));

  const holdStart = durationInFrames * 0.2;
  const holdEnd = durationInFrames * 0.8;
  const progress = interpolate(frame, [holdStart, holdEnd], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  if (!fromTex || !toTex || !entry) return <div style={{ width, height, background: "black" }} />;

  const overrides = (params.shaderParams as Record<string, unknown>) ?? {};
  const extraUniforms: Record<string, unknown> = { ...entry.defaultParams, ...overrides };

  return (
    <ThreeCanvas width={width} height={height} linear flat>
      <TransitionPlane from={fromTex} to={toTex} glsl={entry.glsl} progress={progress} extraUniforms={extraUniforms} width={width} height={height} />
    </ThreeCanvas>
  );
};
