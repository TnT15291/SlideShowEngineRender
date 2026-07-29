import { principalSlotId } from "./templatePhotoRequests.mjs";

export function createLayerSceneBuilder({
  library,
  libraryPath,
  endingPhoto,
  heroPhoto,
  getExpandedScenes,
  getGlobalAssignments,
  take,
  claimPhoto,
  pic,
  rect,
  libTheme,
  resolveColor,
  resolveFrame,
  photoStart,
  copyMap,
  pickVariant,
  fill,
  resolveFont,
  defaultTextColor,
  textStart,
  txt,
}) {
  function buildLayerSceneFromLayout(scene) {
    // The recipe's own geometry when the scene names a look, the library's when it does
    // not — lib/lookResolver.mjs settled that upstream, before the photo budget was solved.
    // The lookup stays as the fallback for callers that build a scene without resolving it.
    const layout = scene.resolvedLayout
      || (library.layouts || []).find((l) => l.id === scene.layout);
    if (!layout) throw new Error(`Scene ${scene.id}: unknown layout '${scene.layout}' (not in ${libraryPath})`);
    const canvas = library.meta?.canvas || { width: 1920, height: 1080 };
    const isClosing = scene.durationRole === "closing";
    const bg = isClosing ? { type: "photo_full_bleed", slot: "__bookend" } : (layout.background || { type: "cream" });
    const bgSlotId = bg.type === "photo_full_bleed" ? bg.slot : null;
    const defOf = (id) => (scene.photoSlots || []).find((s) => s.slot === id) || {};
    const layers = [];

    // Every text layer used to hard-code animation:"fade" — the engine has always
    // supported slide_up/down/left/right (src/types.ts LayerAnimation) but nothing
    // ever asked for them. Peak/montage beats now pop in (slide_up, matching the
    // motion planner's own "peak -> snap easing" convention); the closing card stays
    // fade (a settled ending, not another entrance); everything else slides in toward
    // its own reading alignment, which is a fade-adjacent, always-safe motion.
    function textAnimation(align) {
      if (isClosing) return "fade";
      if (scene.transitionRole === "peak" || scene.durationRole === "montage" || scene.arcBeat === "peak") return "slide_up";
      if (align === "left") return "slide_right";
      if (align === "right") return "slide_left";
      return "fade";
    }

    // 1) background: full-bleed photo or a solid theme fill.
    if (bg.type === "photo_full_bleed") {
      const slot = (layout.photoSlots || []).find((s) => s.id === bgSlotId)
        || { x: 0, y: 0, width: canvas.width, height: canvas.height };
      const def = defOf(bgSlotId);
      const file = isClosing ? endingPhoto.file : (scene === getExpandedScenes()?.[0] ? heroPhoto.file
        : getGlobalAssignments().get(`${scene.id}:${bgSlotId}`)?.[0] || take({ orient: def.orient }, 1));
      if (!isClosing && file === heroPhoto.file) { claimPhoto(file, heroPhoto); }
      layers.push(pic(file, slot.x, slot.y, slot.width, slot.height, {
        fit: def.fit || slot.fit || "cover",
        ...(def.motion ? { motion: def.motion } : {}),
      }, scene, { isHero: true, isBackground: true }));
      if (isClosing) layers.push(rect(0, 0, canvas.width, canvas.height, "#000000", 0.42));
    } else {
      const bgColor = bg.type === "cream"
        ? (libTheme().background || "#FBF6ED")
        : resolveColor(bg.color || "#000000");
      layers.push(rect(0, 0, canvas.width, canvas.height, bgColor, 1));
    }

    // 2) panels (scrims / title pills), drawn above the background. Panels with
    //    z:"over_photos" wait until after the photo layers (e.g. a scrim that
    //    must darken foreground photos so text stays legible).
    const allPanels = layout.panels || [];
    for (const p of allPanels.filter((p) => p.z !== "over_photos")) {
      layers.push(rect(p.x, p.y, p.width, p.height, resolveColor(p.color), p.opacity ?? 1));
    }

    // 3) photo slots: the layout drives how many + where; the scene refines
    //    which photo lands in each (orientation, quality, motion, frame).
    let pIdx = 0;
    const isOpening = scene === getExpandedScenes()?.[0];
    for (const slot of layout.photoSlots || []) {
      if (slot.id === bgSlotId) continue;
      const def = defOf(slot.id);
      // The opening's principal photo is the hero — reserved out of the pool precisely so
      // it lands here. Claim it, or the reservation strands a photo the pool needs.
      const file = (isOpening && slot.id === principalSlotId(layout))
        ? heroPhoto.file
        : getGlobalAssignments().get(`${scene.id}:${slot.id}`)?.[0] || take({ orient: def.orient }, 1);
      if (isOpening && file === heroPhoto.file) { claimPhoto(file, heroPhoto); }
      // The look's frame sits between the scene's own and the layout's: a recipe dresses
      // every slot of a look the same way, and a scene may still overrule one slot.
      const frame = resolveFrame(def.frame || scene.resolvedFrame || slot.frame);
      const anim = def.animation || slot.suggestedAnimation;
      const animated = anim && anim !== "none";
      layers.push(pic(file, slot.x, slot.y, slot.width, slot.height, {
        fit: def.fit || slot.fit || "cover",
        ...(def.motion ? { motion: def.motion } : {}),
        ...(frame ? { frame } : {}),
        ...(slot.rotation != null ? { rotation: slot.rotation } : {}),
        ...(animated ? { animation: anim, start: photoStart(pIdx) } : {}),
      }, scene, { isHero: slot.id === "hero" || def.quality === "best" }));
      pIdx++;
    }

    // 4) panels layered over the photos (text-legibility scrims).
    for (const p of allPanels.filter((p) => p.z === "over_photos")) {
      layers.push(rect(p.x, p.y, p.width, p.height, resolveColor(p.color), p.opacity ?? 1));
    }

    // 5) optional full-frame decor PNG (1920x1080 wedding frame) under the text.
    if (scene.frameOverlay) {
      layers.push({
        type: "image", path: scene.frameOverlay,
        x: 0, y: 0, width: canvas.width, height: canvas.height,
        fit: "stretch",
      });
    }

    // 6) text slots: only render the ones this scene supplies copy for.
    for (const slot of layout.textSlots || []) {
      // An AI-written copy map (node B) may override the recipe's canned line, but
      // ONLY for a slot the layout already has. Keys it does not have are never
      // looked up, so an invented scene or slot cannot conjure a text layer.
      const override = copyMap[scene.id]?.[slot.id];
      const slotKey = `${scene.id}:${slot.id}`;
      const raw = typeof override === "string" && override
        ? override
        : pickVariant(scene.text ? scene.text[slot.id] : undefined, slotKey);
      const obj = raw && typeof raw === "object" ? raw : null;
      const value = fill(obj ? pickVariant(obj.value, `${slotKey}:value`) : raw);
      if (!value) continue;
      const role = obj?.fontRole || slot.fontRole || "body";
      const align = slot.align || "left";
      layers.push(txt(
        value,
        resolveFont(role),
        slot.x, slot.y, slot.width, slot.height,
        obj?.sizePx || slot.sizePx || 40,
        obj?.color || slot.color || (isClosing ? "#FFFFFF" : defaultTextColor(slot, layout)),
        align,
        {
          ...(slot.lineSpacing ? { lineSpacing: slot.lineSpacing } : {}),
          animation: textAnimation(align),
          start: textStart(slot.role),
        }
      ));
    }

    return { effect: "layer_scene", captions: [], layers };
  }

  return buildLayerSceneFromLayout;
}