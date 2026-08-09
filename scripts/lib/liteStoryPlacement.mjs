/**
 * Where each chapter of the customer's story is allowed to appear on screen.
 *
 * A Lite film is composed first and worded second: `composeStoryboard` picks
 * layouts and effects for the whole album, and only then does each act's copy
 * have to find somewhere to live inside the scenes it was given. Which scenes
 * carry text slots is therefore an accident of the layout mix, not something
 * the story can rely on.
 *
 * The rule that broke because of that: copy used to be written into the act's
 * FIRST scene and nowhere else, into whatever slots that one scene happened to
 * have. Effect scenes (`photo_strip_up`, `pan_left`, …) carry an empty but
 * truthy `text: {}`, so an act opening on one wrote zero words and never
 * reached the caption fallback. On the Tuân & Tiên album that silently deleted
 * four of eight chapters — the film stopped telling the story a third of the
 * way in and every gate still said the build was fine.
 */

export const HEADING_SLOTS = /heading|eyebrow|names/;
export const BODY_SLOTS = /body|caption|quote|tile_text|invite/;

// `layer_scene` builds its text from the layout's own slots and never reads
// captionPattern — applyStoryTemplate hands it straight to
// buildLayerSceneFromLayout — so a caption is only a real fallback on the
// effect-driven scenes. Writing one anywhere else is the same silent loss again.
export const takesCaption = (scene) => scene.effect !== "layer_scene";

/**
 * First unclaimed slot matching `pattern`, in scene order, so copy still lands
 * as early in the chapter as the layouts allow. Slots this does not claim keep
 * whatever the composer wrote — that is where the {{groom}} & {{bride}} and
 * {{date}} fact tokens live, and blanking them is how a title card once
 * rendered with no title.
 */
function claimSlot(scenes, pattern, taken) {
  for (const scene of scenes) {
    for (const slot of Object.keys(scene.text || {})) {
      if (pattern.test(slot) && !taken.has(`${scene.id}:${slot}`)) return { scene, slot };
    }
  }
  return null;
}

/**
 * Places every act's heading and prose into `groups`, mutating the scenes.
 *
 * `groups` is `[{ act, scenes, firstIndex }]` in film order, where `scenes` are
 * that act's scenes, also in order. Returns one row per act saying where its
 * words ended up, so the caller can report coverage instead of losing chapters
 * quietly.
 */
export function placeStoryCopy(groups, { title = "" } = {}) {
  const placements = [];
  for (const { act, scenes, firstIndex } of groups) {
    const taken = new Set();
    const write = (target, value) => {
      if (!target || !value) return null;
      target.scene.text[target.slot] = value;
      taken.add(`${target.scene.id}:${target.slot}`);
      return `${target.scene.id}.${target.slot}`;
    };
    // The opening act wears the film's title rather than its own chapter name.
    const heading = firstIndex === 0 ? title || act.heading : act.heading;
    const headingAt = write(claimSlot(scenes, HEADING_SLOTS, taken), heading);
    let bodyAt = write(claimSlot(scenes, BODY_SLOTS, taken), act.screenCopy);
    // An act whose layouts offer no slot for its prose still has to say its
    // piece, over one of its own photos.
    if (!bodyAt && act.screenCopy) {
      const host = scenes.find(takesCaption);
      if (host) {
        host.captionPattern = headingAt ? act.screenCopy : `${act.heading} — ${act.screenCopy}`;
        bodyAt = `${host.id}.caption`;
      }
    }
    placements.push({ act: act.id, headingAt, bodyAt, hasBody: Boolean(act.screenCopy) });
  }
  return placements;
}
