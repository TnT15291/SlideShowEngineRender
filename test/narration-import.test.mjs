// The narration importer (N1 of PLAN-NARRATED-PRODUCT.md).
//
// Every editorial decision used to be a constant inside importNarrationScript.mjs:
// exactly 11 paragraphs, six section ids, six section titles, the title card, the
// closing slogan, the output filename. A second film could not be imported without
// editing code — the script threw at the paragraph count. These tests pin the shape
// of the data that replaced those constants.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildBeats,
  buildScript,
  parseFrontMatter,
  parseSections,
  resolveConfig,
  splitNarration,
} from "../scripts/importNarrationScript.mjs";
import { slug } from "../scripts/lib/project.mjs";

test("front-matter is peeled off, and a broken block fails instead of silently defaulting", () => {
  const { config, body } = parseFrontMatter('---\n{ "name": "Phim A", "fps": 25 }\n---\n\n## MỞ ĐẦU\n\nMột đoạn.\n');
  assert.equal(config.name, "Phim A");
  assert.equal(config.fps, 25);
  assert.match(body, /^\s*## MỞ ĐẦU/);

  // No front-matter at all is normal, not an error.
  assert.deepEqual(parseFrontMatter("## A\n\nx\n").config, {});

  // A malformed block must not fall through to defaults: the writer believes
  // they set the fps, and the film would quietly render at a different one.
  assert.throws(() => parseFrontMatter('---\n{ "name": }\n---\n\nx\n'), /Invalid JSON front-matter/);
});

test("sections come from headings, with an id pinned by hand or slugged from the title", () => {
  const { documentTitle, sections } = parseSections(
    "# Mùa vàng\n\n## NHỮNG CÁNH ĐỒNG\n\nĐoạn một.\n\nĐoạn hai.\n\n## HỢP TÁC XÃ {#htx}\n\nĐoạn ba.\n",
  );
  assert.equal(documentTitle, "Mùa vàng");
  assert.equal(sections.length, 2);
  assert.equal(sections[0].id, "nhung-canh-dong");
  assert.equal(sections[0].title, "NHỮNG CÁNH ĐỒNG");
  assert.equal(sections[0].paragraphs.length, 2);
  assert.equal(sections[1].id, "htx", "a pinned {#id} wins over the slug");
  assert.equal(sections[1].title, "HỢP TÁC XÃ", "the {#id} marker is not part of the on-screen title");
});

test("a script that cannot be sectioned is rejected rather than guessed at", () => {
  // Prose with no heading above it belongs to no section, so it would silently
  // attach to whatever came before — or to nothing, on the first paragraph.
  assert.throws(() => parseSections("Một đoạn lạc.\n\n## MỞ ĐẦU\n\nx\n"), /before the first/);
  assert.throws(() => parseSections("# Chỉ có tiêu đề\n"), /at least one/);
  assert.throws(() => parseSections("## MỞ ĐẦU\n\n## KẾT\n\nx\n"), /no paragraphs/);
  // Two sections sharing an id read as ONE section to every rule downstream,
  // which moves a dissolve and the breath that goes with it.
  assert.throws(() => parseSections("## Mở đầu\n\na\n\n## MỞ ĐẦU\n\nb\n"), /share the id/);
});

test("config falls back to workable defaults but refuses values the builder would reject later", () => {
  const settings = resolveConfig({}, "Phim thứ hai");
  assert.equal(settings.name, "Phim thứ hai", "a # heading can name the film");
  assert.equal(settings.width, 1920);
  assert.equal(settings.maxShotDuration, 9);
  assert.equal(settings.beat.target, 280);
  assert.equal(settings.output, "output/phim-thu-hai.mp4");

  // buildNarratedTimeline re-checks these, but only after synthesis has already
  // spent real minutes of TTS. Failing at import is the cheaper place.
  assert.throws(() => resolveConfig({ name: "x", maxShotDuration: 40 }), /maxShotDuration/);
  assert.throws(() => resolveConfig({ name: "x", closingDuration: 0 }), /closingDuration/);
  assert.throws(() => resolveConfig({ name: "x", beat: { target: 300, hardLimit: 100 } }), /hardLimit/);
  assert.throws(() => resolveConfig({}), /needs a name/);
});

test("the section breath lands on the beat that CLOSES a section, not the one that opens the next", () => {
  const sections = [
    { id: "a", title: "A", paragraphs: ["Câu một.", "Câu hai."] },
    { id: "b", title: "B", paragraphs: ["Câu ba."] },
  ];
  const beats = buildBeats(sections, resolveConfig({ name: "x" }));
  assert.deepEqual(beats.map((beat) => beat.section), ["a", "a", "b"]);

  // The pause has to sit in the gap the section dissolve lands in, and 1.2s
  // outlasts the 1.0s fade_slow so the dissolve finishes in silence rather than
  // over the first words of the new section.
  assert.equal(beats[0].pauseAfter, undefined);
  assert.equal(beats[1].pauseAfter, 1.2);
  assert.equal(beats[2].pauseAfter, undefined, "the last beat has nothing to breathe into");

  assert.equal(beats[0].caption, "A", "only the first beat of a section carries its title");
  assert.equal(beats[1].caption, undefined);
  assert.equal(beats[2].caption, "B");
});

test("beat length is configurable, and cutting never loses a word", () => {
  const paragraph = "Câu một dài vừa phải. Câu hai cũng dài vừa phải. Câu ba khép lại đoạn.";
  assert.equal(splitNarration(paragraph, 280).length, 1, "a short paragraph stays whole");

  const tight = splitNarration(paragraph, 40);
  assert.ok(tight.length > 1, "a small target cuts the paragraph up");
  assert.equal(tight.join(" "), paragraph, "cutting never loses or reorders a word");

  // The knob exists, but the TTS cache is keyed on the beat text, so reaching
  // for it after the first synthesis run re-synthesises the entire film.
  const settings = resolveConfig({ name: "x", beat: { target: 40, hardLimit: 60 } });
  assert.equal(buildBeats([{ id: "a", title: "A", paragraphs: [paragraph] }], settings).length, tight.length);
});

test("a whole script round-trips from Markdown into the shape the synthesiser reads", () => {
  const { script } = buildScript(
    '---\n{ "issuer": "Đơn vị X", "title": { "title": "PHIM", "subtitle": "phụ đề" } }\n---\n' +
      "# Phim thứ hai\n\n## MỘT\n\nĐoạn một.\n\n## HAI\n\nĐoạn hai.\n",
  );
  assert.equal(script.reviewStatus, "needs-content-approval", "import never opens the content gate");
  assert.deepEqual(script.sections.map((section) => section.id), ["mot", "hai"]);
  assert.equal(script.project.issuer, "Đơn vị X");
  assert.equal(script.project.name, "Phim thứ hai");
  assert.equal(script.beats.length, 2);
  assert.equal(script.beats[0].visual.kind, "title", "the opening beat carries the title card");
  assert.equal(script.beats[1].visual.kind, "pending", "every other beat waits for real footage");
});

test("a sidecar config overrides front-matter, for a writer who will not embed JSON", () => {
  const source = '---\n{ "name": "Tên trong file", "fps": 25 }\n---\n\n## MỘT\n\nĐoạn.\n';
  assert.equal(buildScript(source).script.project.fps, 25);
  const { script } = buildScript(source, { fps: 30, name: "Tên từ sidecar" });
  assert.equal(script.project.fps, 30);
  assert.equal(script.project.name, "Tên từ sidecar");
});

test("slug keeps Vietnamese đ, which section ids and output filenames are built from", () => {
  // đ/Đ is a letter, not a base letter plus a combining mark, so NFD leaves it
  // whole and the slug's [^a-z0-9] filter deleted it outright: "NHỮNG CÁNH ĐỒNG"
  // became "nhung-canh-ong", and a film called "Mùa vàng trên đất lửa" wrote
  // itself to "mua-vang-tren-at-lua.mp4". The same bug named customer project
  // directories on the server — see server/services/projects.test.ts.
  assert.equal(slug("NHỮNG CÁNH ĐỒNG HỒI SINH"), "nhung-canh-dong-hoi-sinh");
  assert.equal(slug("Mùa vàng trên đất lửa"), "mua-vang-tren-dat-lua");
  assert.equal(slug("Đoàn Thanh niên"), "doan-thanh-nien");
  assert.equal(slug("Đức & Hà"), "duc-ha");
});
