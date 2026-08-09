import test from "node:test";
import assert from "node:assert/strict";

import { placeStoryCopy } from "../scripts/lib/liteStoryPlacement.mjs";
import { adaptLiteStory } from "../scripts/lib/liteStoryAdapter.mjs";

const act = (id, heading, screenCopy) => ({ id, heading, screenCopy, photoHints: [] });
const layoutScene = (id, slots) => ({ id, effect: "layer_scene", text: Object.fromEntries(slots.map((s) => [s, ""])) });
const effectScene = (id, effect = "pan_left") => ({ id, effect, text: {} });

// The exact shape of the Tuân & Tiên album: an act that opens on effect scenes
// carrying an empty-but-truthy `text: {}`, with its only text slot several
// scenes later. Four chapters were lost to this and nothing reported it.
test("an act opening on slot-less effect scenes still gets its story told", () => {
  const scenes = [effectScene("s21", "photo_strip_up"), effectScene("s22", "slow_zoom_out"),
    layoutScene("s23", []), layoutScene("s24", []), layoutScene("s25", ["heading"])];
  const placements = placeStoryCopy([{ act: act("beat_05", "4 Năm Yêu Thương", "Bốn năm bên nhau."), scenes, firstIndex: 20 }]);

  assert.equal(scenes[4].text.heading, "4 Năm Yêu Thương", "the heading takes the act's only heading slot");
  // No body slot anywhere in the act, so the prose falls back to a caption —
  // and onto a scene that actually renders captions, never a layer_scene.
  assert.equal(scenes[0].captionPattern, "Bốn năm bên nhau.");
  assert.deepEqual(placements, [{ act: "beat_05", headingAt: "s25.heading", bodyAt: "s21.caption", hasBody: true }]);
});

test("a caption fallback never lands on a layer_scene, which cannot show one", () => {
  const scenes = [layoutScene("s29", []), effectScene("s30", "pan_right")];
  placeStoryCopy([{ act: act("beat_06", "Lời Hứa", "Và rồi, quyết định đã đến."), scenes, firstIndex: 25 }]);

  assert.equal(scenes[0].captionPattern, undefined);
  // With no heading slot either, the chapter name rides along with the prose.
  assert.equal(scenes[1].captionPattern, "Lời Hứa — Và rồi, quyết định đã đến.");
});

test("copy lands on the earliest capable scene and claims each slot once", () => {
  const scenes = [layoutScene("s01", ["heading", "body"]), layoutScene("s03", ["quote"]), layoutScene("s05", ["names", "date"])];
  scenes[2].text.names = "{{groom}} & {{bride}}";
  scenes[2].text.date = "{{date}}";
  const placements = placeStoryCopy([{ act: act("beat_01", "Khởi Đầu", "Từ Cửa Việt và Trung Hải."), scenes, firstIndex: 0 }],
    { title: "Hành Trình Của Chúng Ta" });

  assert.equal(scenes[0].text.heading, "Hành Trình Của Chúng Ta", "the opening act wears the film's title");
  assert.equal(scenes[0].text.body, "Từ Cửa Việt và Trung Hải.");
  assert.equal(scenes[1].text.quote, "", "a second body-ish slot is not filled with the same prose twice");
  // The fact tokens the composer wrote must survive: blanking them is how a
  // title card once rendered with no title.
  assert.equal(scenes[2].text.names, "{{groom}} & {{bride}}");
  assert.equal(scenes[2].text.date, "{{date}}");
  assert.deepEqual(placements[0], { act: "beat_01", headingAt: "s01.heading", bodyAt: "s01.body", hasBody: true });
});

test("an act with nowhere at all to speak is reported, not swallowed", () => {
  const scenes = [layoutScene("s41", []), layoutScene("s42", [])];
  const placements = placeStoryCopy([{ act: act("beat_09", "Kết", "Câu cuối."), scenes, firstIndex: 40 }]);
  assert.deepEqual(placements, [{ act: "beat_09", headingAt: null, bodyAt: null, hasBody: true }]);
});

// The other half of the loss: the prose that did reach the screen arrived
// amputated, cut to a flat 96 characters guessed before any layout, box or font
// size was known. Real wedding story bodies run past that.
test("story prose reaches the timeline whole, for the fitter to measure", () => {
  const body = "Từ bàn tay trắng, chúng ta cùng nhau gây dựng thương hiệu bánh bạch tuộc. Những ngày vất vả, những đêm thức trắng, tất cả đều đáng giá.";
  assert.ok(body.length > 96, "fixture must exceed the old cap to be a regression");
  const { acts } = adaptLiteStory({ story: { title: "T", beats: [{ heading: "Ước Mơ", body }] } });

  assert.equal(acts[0].screenCopy, body);
  assert.ok(!acts[0].screenCopy.includes("…"), "no ellipsis before anything has measured the text box");
});

test("a runaway paragraph is bounded, but only between sentences", () => {
  const long = `${"Câu chuyện dài của hai người bắt đầu từ một buổi chiều. ".repeat(6)}Kết thúc.`;
  const { acts } = adaptLiteStory({ story: { beats: [{ heading: "H", body: long }] } });

  assert.ok(acts[0].screenCopy.length <= 241);
  assert.ok(acts[0].screenCopy.endsWith("."), "the bound falls on a sentence end, never mid-clause");
  assert.ok(!acts[0].screenCopy.includes("…"));
});
