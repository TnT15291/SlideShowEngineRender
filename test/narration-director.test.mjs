// The director's guardrail.
//
// JSON mode nudges a model toward JSON and enforces nothing else, so every field
// of the answer is brought back onto the contract by validateProposal(). These
// tests are that contract. Each case below is a way a real model fails, and each
// failure either stops the build outright or is visible in the finished film —
// so a repair that happened silently would be a lie told to whoever signs the
// review file, which is why every one of them lands in `repairs`.
import { test } from "node:test";
import assert from "node:assert/strict";

import { ALLOWED_EFFECTS, buildDirectorPrompt, stubProposal, validateProposal } from "../scripts/lib/narrationDirector.mjs";
import { LANDSCAPE_EFFECTS, PORTRAIT_EFFECT } from "../scripts/lib/visualAssigner.mjs";

const beat = (id, needs = 1, seconds = 6) => ({ id, beatIds: [id], section: "s1", narration: "Một câu.", needs, seconds });
const photo = (file, orient = "landscape", pool = "p") => ({ file, orient, pool });
const pick = (index, effect = "pan_right", kind = "photo") => ({ kind, index, effect, why: "vì nó hợp" });

test("a photo index the album does not have is dropped, and said so", () => {
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(99)] }] },
    { beats: [beat("b1")], photos: [photo("p/a.jpg")] },
  );
  assert.deepEqual(beats[0].picks, []);
  assert.match(repairs.join("\n"), /photo index 99 does not exist/);
  assert.match(repairs.join("\n"), /0\/1 visual\(s\) chosen/);
});

test("the same photograph twice becomes once, because the audience would see it twice", () => {
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(0)] }, { id: "b2", picks: [pick(0, "pan_up")] }] },
    { beats: [beat("b1"), beat("b2")], photos: [photo("p/a.jpg"), photo("p/b.jpg")] },
  );
  assert.equal(beats[0].picks.length, 1);
  assert.deepEqual(beats[1].picks, []);
  assert.match(repairs.join("\n"), /was already used earlier in the film/);
});

test("a beat the director forgot is reported rather than passed over", () => {
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(0)] }] },
    { beats: [beat("b1"), beat("b2")], photos: [photo("p/a.jpg"), photo("p/b.jpg")] },
  );
  assert.equal(beats.length, 2, "every beat comes back, in order");
  assert.deepEqual(beats[1].picks, []);
  assert.match(repairs.join("\n"), /b2: the director returned nothing/);
});

test("a tall photograph is forced onto the frame-filling treatment whatever the model said", () => {
  // Not taste: a portrait frame under a panning motion sits between two black
  // bars for the whole slide.
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(0, "pan_left")] }] },
    { beats: [beat("b1")], photos: [photo("p/tall.jpg", "portrait")] },
  );
  assert.equal(beats[0].picks[0].effect, PORTRAIT_EFFECT);
  assert.match(repairs.join("\n"), /is portrait; forced/);
});

test("a motion the engine does not have is replaced", () => {
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(0, "cinematic_dolly_zoom")] }] },
    { beats: [beat("b1")], photos: [photo("p/a.jpg")] },
  );
  assert.ok(ALLOWED_EFFECTS.includes(beats[0].picks[0].effect));
  assert.match(repairs.join("\n"), /is not a motion this engine has/);
});

test("the same motion twice in a row is varied", () => {
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(0, "pan_right")] }, { id: "b2", picks: [pick(1, "pan_right")] }] },
    { beats: [beat("b1"), beat("b2")], photos: [photo("p/a.jpg"), photo("p/b.jpg")] },
  );
  assert.notEqual(beats[1].picks[0].effect, beats[0].picks[0].effect);
  assert.ok(LANDSCAPE_EFFECTS.includes(beats[1].picks[0].effect));
  assert.match(repairs.join("\n"), /same motion twice in a row/);
});

test("a clip shorter than its slide is refused here, not hours into the render", () => {
  const shared = { beats: [beat("b1", 1, 8)], photos: [photo("p/a.jpg")] };
  const short = validateProposal(
    { beats: [{ id: "b1", picks: [{ kind: "clip", index: 0, why: "x" }] }] },
    { ...shared, clips: [{ file: "f/s.mp4", duration: 3, label: "ngắn" }] },
  );
  assert.deepEqual(short.beats[0].picks, []);
  assert.match(short.repairs.join("\n"), /is 3\.0s but the slide runs 8\.0s/);

  const long = validateProposal(
    { beats: [{ id: "b1", picks: [{ kind: "clip", index: 0, why: "x" }] }] },
    { ...shared, clips: [{ file: "f/l.mp4", duration: 12, label: "đủ" }] },
  );
  assert.equal(long.beats[0].picks[0].kind, "clip");
  assert.deepEqual(long.repairs, []);
});

test("more visuals than the window holds are trimmed to what will actually be seen", () => {
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(0), pick(1, "pan_up"), pick(2, "slow_zoom_in")] }] },
    { beats: [beat("b1", 2)], photos: [photo("p/a.jpg"), photo("p/b.jpg"), photo("p/c.jpg")] },
  );
  assert.equal(beats[0].picks.length, 2);
  assert.match(repairs.join("\n"), /more visuals proposed than the/);
});

test("the reason the director gave is carried through for the reviewer to weigh", () => {
  const { beats } = validateProposal(
    { beats: [{ id: "b1", picks: [{ kind: "photo", index: 0, effect: "pan_right", why: "có xe chữa cháy đúng nội dung câu" }] }] },
    { beats: [beat("b1")], photos: [photo("p/a.jpg")] },
  );
  assert.equal(beats[0].picks[0].why, "có xe chữa cháy đúng nội dung câu");
  assert.equal(beats[0].picks[0].verdict, "pending", "every pick starts unapproved");
  assert.equal(beats[0].picks[0].chosenBy, "director");
});

test("indices are the album's, not positions in the filtered offer list", () => {
  // Only photographs a pool vouches for are offered to the director — 213 of the
  // ANTT album's 339 — but the indices in the prompt stay the album's own. Looking
  // the answer up by POSITION in the filtered list returns a different photograph,
  // and it is the one failure here nothing downstream can catch: the film builds
  // perfectly and shows the wrong picture under the wrong sentence.
  const photos = [
    { index: 12, file: "p/twelve.jpg", orient: "landscape", pool: "a" },
    { index: 300, file: "p/threehundred.jpg", orient: "landscape", pool: "b" },
  ];
  const { beats, repairs } = validateProposal(
    { beats: [{ id: "b1", picks: [pick(300)] }, { id: "b2", picks: [pick(12, "pan_up")] }] },
    { beats: [beat("b1"), beat("b2")], photos },
  );
  assert.equal(beats[0].picks[0].src, "p/threehundred.jpg", "album index 300 is not out of range");
  assert.equal(beats[0].picks[0].photoIndex, 300);
  assert.equal(beats[1].picks[0].src, "p/twelve.jpg", "album index 12 is not the array's second entry");
  assert.deepEqual(repairs, []);
});

test("the stub proposes nothing rather than pretending to have directed", () => {
  // A stub that invented picks would produce a review file that looks reviewed
  // on a machine with no key at all.
  const stub = stubProposal([beat("b1"), beat("b2")]);
  assert.deepEqual(stub.beats.map((entry) => entry.picks), [[], []]);
});

test("the prompt shows the director the clock, the inventory and the words", () => {
  const { system, user } = buildDirectorPrompt({
    beats: [{ ...beat("b1", 3, 11.4), narration: "Phòng cháy chữa cháy tại cơ sở." }],
    photos: [{ index: 0, pool: "pccc", orient: "landscape", caption: "diễn tập chữa cháy" }],
    clips: [{ index: 0, duration: 12, label: "toàn cảnh" }],
    filmName: "Phim thử",
  });
  assert.match(system, new RegExp(PORTRAIT_EFFECT));
  // "3 visuals, 11.4s" would read as three pictures inside eleven seconds;
  // it means three of eleven seconds each.
  assert.match(user, /needs 3 visual\(s\), 11\.4s each \(34\.2s total\)/);
  assert.match(user, /Phòng cháy chữa cháy tại cơ sở\./);
  assert.match(user, /pccc\tlandscape\tdiễn tập chữa cháy/);
  assert.match(user, /Phim thử/);
});
