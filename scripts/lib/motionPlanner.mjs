const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/** Subject-aware, conservative motion choices for Tier 1 image layers. */
export function createMotionPlanner() {
  const history = [];
  const decisions = [];
  function plan(photo = {}, scene = {}, { isHero = false, isBackground = false } = {}) {
    const people = photo.subjectCount ?? photo.faces?.length ?? (photo.faceBoxEstimate ? 1 : 0);
    // null subjectCount + no face box = the analyzer never looked, not "no faces".
    // Those photos used to fall into the people===0 branch and receive the STRONGEST
    // push — the one motion that decapitates an unanalysed portrait. Abstain instead.
    const faceBlind = photo.subjectCount == null && !photo.faces && !photo.faceBoxEstimate;
    const target = { x: clamp(photo.focusX ?? 0.5, 0.12, 0.88), y: clamp(photo.focusY ?? 0.45, 0.12, 0.88) };
    let motion = "none", strength = 0, reason = "supporting image stays still";
    if (scene.arcBeat === "closing") reason = "closing holds still";
    else if (faceBlind && (isHero || isBackground)) { motion = "zoom_in"; strength = 0.025; reason = "no face data — near-still motion, never a hard push"; }
    else if (people >= 3) { motion = isHero || isBackground ? "zoom_in" : "none"; strength = motion === "none" ? 0 : 0.025; reason = "group photo uses near-still motion"; }
    else if (people === 0 && (isHero || isBackground)) { motion = "zoom_in"; strength = 0.06; reason = "detail/context image gets a slow push"; }
    else if (isHero || isBackground) {
      const dx = target.x - 0.5, dy = target.y - 0.5;
      if (Math.abs(dx) > 0.18) motion = dx > 0 ? "pan_right" : "pan_left";
      else if (photo.orient === "portrait" && Math.abs(dy) > 0.14) motion = dy > 0 ? "pan_down" : "pan_up";
      else motion = "zoom_in";
      strength = people >= 2 ? 0.04 : 0.055;
      reason = `${people || 1}-subject motion toward focal point`;
    }
    if (history.slice(-3).length === 3 && history.slice(-3).every((m) => m === motion) && motion !== "none") {
      motion = "zoom_in"; strength = Math.min(strength, 0.04); reason += "; repeated direction reset";
    }
    const easing = scene.arcBeat === "peak" ? "snap" : "gentle";
    history.push(motion);
    const row = { sceneId: scene.id, file: photo.file, motion, strength, target, easing, reason };
    decisions.push(row);
    return row;
  }
  return { plan, decisions };
}
