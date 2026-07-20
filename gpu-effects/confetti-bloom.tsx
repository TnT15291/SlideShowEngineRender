import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ThreeCanvas } from "@remotion/three";
import * as THREE from "three";

// Blush / ivory / gold / sage / rose — the palette already used across the garden and
// silk-botanical story templates, so this reads as "on brand" rather than generic confetti.
const PALETTE = ["#f2c9c2", "#f2e7d5", "#cda856", "#b9c9a0", "#e8b8bf"];
const PARTICLE_COUNT = 46;
const FOV = 50;

function hash(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function cameraDistance(height: number): number {
  return height / (2 * Math.tan((FOV * Math.PI) / 360));
}

function usePetalTexture(): THREE.Texture {
  return useMemo(() => {
    const size = 128;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(size / 2, size / 2);
    ctx.scale(1, 1.4);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2.3);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.65, "rgba(255,255,255,0.85)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(0, 0, size / 2.3, 0, Math.PI * 2);
    ctx.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
  }, []);
}

function useImageTexture(src: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);
  useEffect(() => {
    const handle = delayRender(`confetti_bloom texture ${src}`);
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

function usePetalGeometry(): THREE.PlaneGeometry {
  // three.js turns on the USE_COLOR shader path for ANY InstancedMesh with instanceColor,
  // regardless of the material's vertexColors flag — it multiplies vColor by the geometry's
  // own per-vertex "color" attribute first. planeGeometry has none, so that read comes back
  // (0,0,0) and every instance renders black unless we give it a neutral white attribute.
  return useMemo(() => {
    const geometry = new THREE.PlaneGeometry(1, 1);
    const white = new Float32Array(geometry.attributes.position.count * 3).fill(1);
    geometry.setAttribute("color", new THREE.BufferAttribute(white, 3));
    return geometry;
  }, []);
}

const Petals = ({ frame, durationInFrames, width, height }: { frame: number; durationInFrames: number; width: number; height: number }) => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const texture = usePetalTexture();
  const geometry = usePetalGeometry();
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const gatherEnd = durationInFrames * 0.4;

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const edgeAngle = hash(i * 3.1) * Math.PI * 2;
      const startRadius = Math.max(width, height) * 0.85;
      const settleRadius = height * (0.34 + hash(i * 7.7) * 0.2);
      const settleAngle = edgeAngle + (hash(i * 5.3) - 0.5) * 0.7;
      const phase = hash(i * 9.1) * gatherEnd * 0.5;
      const localProgress = interpolate(frame, [phase, phase + gatherEnd * 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
      const eased = 1 - Math.pow(1 - localProgress, 3);
      const radius = startRadius + (settleRadius - startRadius) * eased;
      const angle = edgeAngle + (settleAngle - edgeAngle) * eased;
      const bob = Math.sin(frame * 0.05 + i) * 5 * eased;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius * 0.55 + bob;
      const z = -40 - hash(i * 4.2) * 90;
      const scale = (10 + hash(i * 6.6) * 15) * (0.5 + eased * 0.5);
      const rotation = frame * (0.01 + hash(i * 8.8) * 0.02) + edgeAngle * 3;
      dummy.position.set(x, y, z);
      dummy.rotation.set(0, 0, rotation);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mesh.setColorAt(i, new THREE.Color(PALETTE[i % PALETTE.length]));
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [frame, gatherEnd, width, height, dummy]);

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, PARTICLE_COUNT]}>
      <meshBasicMaterial map={texture} transparent depthWrite={false} vertexColors toneMapped={false} />
    </instancedMesh>
  );
};

const PhotoPlane = ({ texture, width, height, zoom }: { texture: THREE.Texture; width: number; height: number; zoom: number }) => {
  const img = texture.image as HTMLImageElement;
  const texAspect = img.width / img.height;
  const frameAspect = width / height;
  const fit = 0.62;
  const [w, h] = texAspect > frameAspect
    ? [width * fit, (width * fit) / texAspect]
    : [height * fit * texAspect, height * fit];
  return (
    <mesh scale={[zoom, zoom, 1]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={texture} toneMapped={false} />
    </mesh>
  );
};

export const ConfettiBloom = ({ assets, params }: { assets: string[]; params: Record<string, unknown> }) => {
  const frame = useCurrentFrame();
  const { durationInFrames, width, height } = useVideoConfig();
  const photoTex = useImageTexture(staticFile(assets[0]));
  const background = String(params.background ?? "#faf6ef");
  const zoom = interpolate(frame, [0, durationInFrames], [0.9, 1.03], { extrapolateRight: "clamp" });

  return (
    <div style={{ width, height, background }}>
      {photoTex ? (
        <ThreeCanvas width={width} height={height} linear flat camera={{ position: [0, 0, cameraDistance(height)], fov: FOV }}>
          <PhotoPlane texture={photoTex} width={width} height={height} zoom={zoom} />
          <Petals frame={frame} durationInFrames={durationInFrames} width={width} height={height} />
        </ThreeCanvas>
      ) : null}
    </div>
  );
};
