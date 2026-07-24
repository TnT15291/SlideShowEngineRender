// The directive layer: compiling a customer's words into orders, enforcing them, and
// then proving — from the finished timeline — whether they were actually obeyed.
//
// Most of these tests are here because the bug they describe HAPPENED. They are not
// hypotheses about what could go wrong; they are the receipts.
import { test } from "node:test";
import assert from "node:assert/strict";

import { extractDirectives, clauses, actOf } from "../scripts/lib/briefRules.mjs";
import {
  validateDirective, blastRadius, widestRadius, appendRound, active, stampIds,
  applyToDirectorNotes, applyToStoryboard, applyToTimeline, audit,
  MAX_SLIDE_SEC,
} from "../scripts/lib/directives.mjs";

const compile = (text) => extractDirectives(text).filter((d) => !d.__unmapped)
  .map((d, i) => validateDirective(d, i))
  .filter((r) => r.ok)
  .map((r) => r.directive);

// ---------------------------------------------------------------------------
// Reading what the customer wrote
// ---------------------------------------------------------------------------

test("a Vietnamese word is matched at all (JS \\b is ASCII-only)", () => {
  // /\bấm\b/ does not match "ấm". The rule looked right and fired never, so every
  // customer who asked for a warm film got whatever the recipe felt like.
  const d = compile("Giọng ấm, mộc, gần gũi");
  assert.ok(d.some((x) => x.kind === "overlay" && x.target === "warm"), "warm overlay not extracted");
  assert.ok(d.some((x) => x.kind === "color" && x.target === "vintage"), "vintage curve not extracted");
});

test("negation is scoped to the clause, not the sentence", () => {
  // "Nhịp chậm rãi thôi, đừng dồn dập" is one sentence with two polarities. Testing the
  // whole sentence for a negator emitted pacing=slow AND pacing=fast — two contradictory
  // orders from one wish.
  const d = compile("Nhịp chậm rãi thôi, đừng dồn dập");
  const pacing = d.filter((x) => x.kind === "pacing");
  assert.equal(pacing.length, 1, `expected one pacing order, got ${JSON.stringify(pacing.map((p) => p.target))}`);
  assert.equal(pacing[0].target, "slow");
});

test("a trailing 'không' does not suppress the rest of the sentence", () => {
  const d = compile("Giọng ấm, mộc, gần gũi, không lên gân");
  assert.ok(d.some((x) => x.kind === "overlay" && x.target === "warm"));
});

test("act scope is resolved per clause, so the right act gets the order", () => {
  // "Đoạn bạn bè ... đừng để chữ trên mấy tấm ảnh nghi lễ" — the caption ban belongs to
  // ceremony, not to family_friends just because the sentence opened with it.
  const d = compile("Đoạn bạn bè thì dùng hiệu ứng lật trang phim, đừng để chữ trên mấy tấm ảnh nghi lễ");
  const effect = d.find((x) => x.kind === "effect");
  const caption = d.find((x) => x.kind === "caption");
  assert.equal(effect.scope.act, "family_friends");
  assert.equal(effect.target, "film_roll_up");
  assert.equal(caption.op, "forbid");
  assert.equal(caption.scope.act, "ceremony");
});

test("a hard-wrapped paragraph is quoted back as a readable sentence", () => {
  const cs = clauses("Đời sống ở\nNhật là những điều rất đời thường.\n\nHai năm sau, cả hai về nước.");
  assert.ok(cs[0].startsWith("Đời sống ở Nhật"), `got ${JSON.stringify(cs[0])}`);
});

test("an instruction no rule understands is REPORTED, not dropped", () => {
  const hits = extractDirectives("À, làm giống video của chị Hà bên kia nhé");
  assert.ok(hits.some((h) => h.__unmapped), "an unmappable order vanished silently");
});

test("story prose is not mistaken for an instruction", () => {
  const hits = extractDirectives("Hai năm sau, cả hai trở về Việt Nam làm đám cưới");
  assert.equal(hits.length, 0, `story prose produced ${JSON.stringify(hits)}`);
});

test("'khoảng 3 phút' is a preference; a bare duration is an order", () => {
  assert.equal(compile("Làm khoảng 3 phút")[0].strength, "prefer");
  assert.equal(compile("Làm 3 phút")[0].strength, "must");
  assert.equal(compile("Làm 3 phút")[0].target, 180);
});

test("actOf reads the ending act from 'đoạn kết'", () => {
  assert.equal(actOf("Đoạn kết cho tối dần"), "ending");
});

test("the customer can explicitly choose highlight, full song, or automatic length", () => {
  assert.equal(compile("Làm video highlight khoảng 90 giây").find((d) => d.kind === "music_mode")?.target, "highlight");
  assert.equal(compile("Dùng toàn bộ bài hát, không cắt nhạc").find((d) => d.kind === "music_mode")?.target, "full_song");
  assert.equal(compile("Hãy tự chọn thời lượng phù hợp").find((d) => d.kind === "music_mode")?.target, "auto");
});

test("a moment is matched by CONTENT TAG, not a filename the customer cannot know yet", () => {
  const d = compile("Phải có cảnh trao nhẫn trong phim.");
  const moment = d.find((x) => x.kind === "moment");
  assert.equal(moment?.op, "require");
  assert.equal(moment?.target, "rings");
});

test("forbidding a moment reads the negation the same way effects do", () => {
  const d = compile("Không muốn cảnh tiệc chiêu đãi.");
  const moment = d.find((x) => x.kind === "moment");
  assert.equal(moment?.op, "forbid");
  assert.equal(moment?.target, "reception");
});

test("a moment tag mentioned while telling the story is not an order", () => {
  // "Chúng tôi trao nhẫn dưới ánh hoàng hôn" is narrating the wedding, not commanding
  // the render — MOMENT_MUST_HAVE gates on an explicit ask, exactly like caption's
  // require/forbid gates. Mentioning "nhẫn" alone must not fire the rule.
  const d = compile("Chúng tôi trao nhẫn dưới ánh hoàng hôn.");
  assert.equal(d.some((x) => x.kind === "moment"), false);
});

// ---------------------------------------------------------------------------
// Clamping: what cannot be done is said, not substituted
// ---------------------------------------------------------------------------

test("a directive with no quote is refused", () => {
  const r = validateDirective({ kind: "effect", target: "polaroid" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /quote/);
});

test("an off-vocabulary target is rejected, never rounded to a default", () => {
  const r = validateDirective({ quote: "x", kind: "effect", target: "sparkle_explosion" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not an engine effect/);
});

test("layer_scene cannot be ordered — it needs a layout nobody supplied", () => {
  const r = validateDirective({ quote: "x", kind: "effect", op: "set", target: "layer_scene" });
  assert.equal(r.ok, false);
});

test("a moment can only be required or forbidden — 'set' names no single photo", () => {
  const r = validateDirective({ quote: "x", kind: "moment", op: "set", target: "rings" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /required or forbidden/);
});

test("a moment target must be a real photo-content tag, not an invented one", () => {
  const r = validateDirective({ quote: "x", kind: "moment", op: "require", target: "proposal" });
  assert.equal(r.ok, false);
  assert.match(r.reason, /not a known photo-content tag/);
});

// ---------------------------------------------------------------------------
// Blast radius — the safety property
// ---------------------------------------------------------------------------

test("a caption tweak never re-runs the story", () => {
  assert.equal(blastRadius({ kind: "caption", op: "forbid" }), "timeline");
  assert.equal(blastRadius({ kind: "effect", op: "set" }), "build");
  assert.equal(blastRadius({ kind: "structure", op: "set" }), "plan");
  assert.equal(widestRadius([{ kind: "caption" }, { kind: "effect" }]), "build");
  assert.equal(widestRadius([{ kind: "caption" }, { kind: "story" }]), "plan");
});

test("ids are unique across rounds, not just within one", () => {
  // The extractor numbers from r1 on every call, so round 0 emitted r1,r2,r3 and round 1
  // emitted r1,r2 — the ledger then held two DIFFERENT orders under the id "r1", and
  // everything that dedupes by id merged two unrelated instructions into one.
  let ledger = { version: 1, story: "", directives: stampIds(compile("Phim đi tông ấm. Nhịp chậm rãi thôi"), 0), unmapped: [] };
  ledger = appendRound(ledger, compile("Bỏ hết chữ đi. Cho tối dần rồi hết"), 1);

  const ids = active(ledger).map((d) => d.id);
  assert.equal(new Set(ids).size, ids.length, `duplicate ids in the ledger: ${ids.join(", ")}`);
});

test("round 2 does not silently undo round 1", () => {
  const r1 = compile("Đoạn bạn bè dùng lật trang phim");
  let ledger = { version: 1, story: "", directives: r1.map((d) => ({ ...d, round: 0 })), unmapped: [] };

  // an unrelated later order must leave the first one standing
  ledger = appendRound(ledger, compile("Cả phim đi tông ấm"), 1);
  assert.equal(active(ledger).length, r1.length + 1);
  assert.ok(active(ledger).some((d) => d.target === "film_roll_up"), "round 1's order was lost");

  // a CONTRADICTING order supersedes rather than duplicates
  ledger = appendRound(ledger, compile("Đoạn bạn bè dùng lưới ảnh"), 2);
  const effects = active(ledger).filter((d) => d.kind === "effect" && d.scope.act === "family_friends");
  assert.equal(effects.length, 1, "two contradictory effect orders are both live");
  assert.equal(effects[0].target, "collage_grid");
  assert.ok(ledger.directives.some((d) => d.supersededBy === 2), "the replaced order was deleted, not marked");
});

// ---------------------------------------------------------------------------
// Enforcement
// ---------------------------------------------------------------------------

test("director notes are OVERRIDDEN, not merely asked", () => {
  const doc = { creative_brief: { pacing: "fast" }, director_notes: { colorCurves: null, defaultTransition: "crossfade" } };
  const orders = compile("Cả phim đi tông hoài niệm. Nhịp chậm rãi thôi");
  applyToDirectorNotes(doc, orders);
  assert.equal(doc.director_notes.colorCurves, "vintage");
  assert.equal(doc.creative_brief.pacing, "slow");
});

test("a montage ABSORBS its neighbours — it never inflates the photo budget", () => {
  // composeStoryboard solves total photo demand to exactly what the pool can fill.
  // Turning a 1-photo scene into an 8-photo film roll added 7 slots nobody could fill
  // and killed the build.
  const scenes = [
    { id: "s01", act: "opening", effect: "layer_scene", layout: "a", durationSec: 8 },
    { id: "s02", act: "family_friends", effect: "layer_scene", layout: "a", durationSec: 8 },
    { id: "s03", act: "family_friends", effect: "layer_scene", layout: "a", durationSec: 8 },
    { id: "s04", act: "family_friends", effect: "layer_scene", layout: "a", durationSec: 8 },
    { id: "s05", act: "ending", effect: "layer_scene", layout: "a", durationSec: 8 },
  ];
  const doc = { scenes };
  const demand = () => 1; // every scene consumes exactly one photo
  const before = scenes.reduce((n, s) => n + demand(s), 0);

  applyToStoryboard(doc, compile("Đoạn bạn bè dùng lật trang phim"), { availablePhotos: 5, photoDemand: demand });

  const montage = doc.scenes.find((s) => s.effect === "film_roll_up");
  assert.ok(montage, "no montage was placed");
  const after = doc.scenes.reduce((n, s) => n + (s.photoSlots?.[0]?.count ?? demand(s)), 0);
  assert.equal(after, before, `photo demand changed ${before} -> ${after}`);
  assert.ok(doc.scenes.length < scenes.length + 1, "the absorbed scenes are still there");
});

test("a montage never exceeds the engine's max slide length", () => {
  // Five 8.7s beats make a 43s slide. The engine rejects it, and renderWithRetry
  // responds by dropping the ENTIRE director layer and shipping Lite — so one
  // unchecked instruction silently cost the customer their whole film.
  const scenes = Array.from({ length: 6 }, (_, i) => ({
    id: `s${i + 1}`, act: "family_friends", effect: "layer_scene", layout: "a", durationSec: 8.7,
  }));
  const doc = { scenes: [{ id: "s00", act: "opening", effect: "layer_scene", durationSec: 5 }, ...scenes] };
  applyToStoryboard(doc, compile("Đoạn bạn bè dùng lật trang phim"), { availablePhotos: 20, photoDemand: () => 1 });

  const montage = doc.scenes.find((s) => s.effect === "film_roll_up");
  assert.ok(montage, "no montage was placed");
  assert.ok(montage.durationSec <= MAX_SLIDE_SEC, `montage is ${montage.durationSec}s, over the ${MAX_SLIDE_SEC}s cap`);
});

test("an act-scoped transition lands on every slide of the act, not just the last", () => {
  const timeline = {
    slides: [
      { id: "s1", act: "opening", transition: { type: "crossfade", duration: 0.8 }, captions: [] },
      { id: "s2", act: "ending", transition: { type: "crossfade", duration: 0.8 }, captions: [] },
      { id: "s3", act: "ending", transition: { type: "crossfade", duration: 0.8 }, captions: [] },
    ],
  };
  applyToTimeline(timeline, compile("Đoạn kết cho tối dần rồi hết"));
  assert.equal(timeline.slides[1].transition.type, "fade_to_black");
  assert.equal(timeline.slides[2].transition.type, "fade_to_black");
  assert.equal(timeline.slides[0].transition.type, "crossfade", "the opening was collateral damage");
});

test("forbidding captions strips text layers too, not just the captions array", () => {
  const timeline = {
    slides: [
      { id: "s1", act: "ceremony", captions: [{ text: "hi" }], layers: [{ type: "text", text: "vows" }, { type: "image", path: "a.jpg" }] },
      { id: "s2", act: "opening", captions: [{ text: "keep me" }], layers: [] },
    ],
  };
  applyToTimeline(timeline, compile("Đừng để chữ trên mấy tấm ảnh nghi lễ"));
  assert.equal(timeline.slides[0].captions.length, 0);
  assert.equal(timeline.slides[0].layers.filter((l) => l.type === "text").length, 0);
  assert.equal(timeline.slides[0].layers.length, 1, "the photo layer was thrown out with the text");
  assert.equal(timeline.slides[1].captions.length, 1, "another act lost its words");
});

// ---------------------------------------------------------------------------
// The audit — a green tick we cannot evidence is worse than no report
// ---------------------------------------------------------------------------

test("audit reports an unhonoured order as broken, and fails the gate", () => {
  const timeline = { slides: [{ id: "s1", act: "family_friends", effect: "layer_scene", transition: { type: "crossfade" }, captions: [] }] };
  const report = audit(compile("Đoạn bạn bè dùng lật trang phim"), timeline);
  assert.equal(report.pass, false);
  assert.equal(report.broken, 1);
  assert.equal(report.results[0].honored, false);
});

test("audit confirms an order the timeline actually carries", () => {
  const timeline = { slides: [{ id: "s1", act: "family_friends", effect: "film_roll_up", transition: { type: "crossfade" }, captions: [] }] };
  const report = audit(compile("Đoạn bạn bè dùng lật trang phim"), timeline);
  assert.equal(report.pass, true);
  assert.equal(report.results[0].honored, true);
  assert.match(report.results[0].evidence, /film_roll_up/);
});

test("what cannot be verified is never counted as honoured", () => {
  const timeline = { slides: [{ id: "s1", effect: "still", transition: { type: "crossfade" }, captions: [] }] };
  // pacing's evidence lives in director_notes; with none supplied it is unverifiable.
  const report = audit(compile("Nhịp chậm rãi thôi"), timeline);
  assert.equal(report.results[0].honored, null);
  assert.equal(report.honored, 0);
  assert.equal(report.unverifiable, 1);
  assert.equal(report.pass, true, "unverifiable must not FAIL the gate either — only false does");
});

test("a moment is audited against CONTENT TAGS, keyed by the same filenames the timeline carries", () => {
  const d = validateDirective({ quote: "x", kind: "moment", op: "require", target: "rings", scope: { global: true } }).directive;
  const timeline = { slides: [
    { id: "s1", layers: [{ type: "image", path: "a.jpg" }] },
    { id: "s2", layers: [{ type: "image", path: "b.jpg" }] },
  ] };
  const present = audit([d], timeline, { photoTags: { "a.jpg": ["rings", "ceremony"], "b.jpg": ["couple"] } });
  assert.equal(present.results[0].honored, true);
  const absent = audit([d], timeline, { photoTags: { "a.jpg": ["couple"], "b.jpg": ["couple"] } });
  assert.equal(absent.results[0].honored, false);
});

test("a forbidden moment is honoured only when NO slide carries the tag", () => {
  const d = validateDirective({ quote: "x", kind: "moment", op: "forbid", target: "party", scope: { global: true } }).directive;
  const timeline = { slides: [{ id: "s1", layers: [{ type: "image", path: "a.jpg" }] }] };
  const clean = audit([d], timeline, { photoTags: { "a.jpg": ["ceremony"] } });
  assert.equal(clean.results[0].honored, true);
  const broken = audit([d], timeline, { photoTags: { "a.jpg": ["party"] } });
  assert.equal(broken.results[0].honored, false);
});

test("without photo_content data a moment is unverifiable, not silently passed", () => {
  const d = validateDirective({ quote: "x", kind: "moment", op: "require", target: "rings", scope: { global: true } }).directive;
  const timeline = { slides: [{ id: "s1", layers: [{ type: "image", path: "a.jpg" }] }] };
  const report = audit([d], timeline, {});
  assert.equal(report.results[0].honored, null);
});

test("a `prefer` order that is missed does not fail the gate; a `must` does", () => {
  const timeline = { slides: [{ id: "s1", act: "family_friends", effect: "still", transition: { type: "crossfade" }, captions: [] }] };
  const soft = compile("Đoạn bạn bè nếu được thì dùng lật trang phim");
  assert.equal(soft[0].strength, "prefer");
  assert.equal(audit(soft, timeline).pass, true);

  const hard = compile("Đoạn bạn bè dùng lật trang phim");
  assert.equal(audit(hard, timeline).pass, false);
});
