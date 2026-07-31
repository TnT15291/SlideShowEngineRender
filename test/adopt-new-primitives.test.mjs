import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  adoptionContentAudit,
  adoptionStatus,
  applyRecipePlan,
  compositionUniquenessAudit,
  constrainedCohortAudit,
  formatWidespreadGeometryReport,
  galleryTailAudit,
  orientationAudit,
  primitiveHostAudit,
  reauditedPrimitiveErrors,
  simulatedTargetAudit,
} from "../scripts/adoptNewPrimitives.mjs";
import { geometryStats } from "../scripts/lib/geometrySignature.mjs";
import { resolveTemplate } from "../scripts/lib/lookResolver.mjs";

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, "layouts/library.json"), "utf8"));
const map = JSON.parse(fs.readFileSync(path.join(root, "scripts/newPrimitiveAdoptionMap.json"), "utf8"));
const recipe = (id) => JSON.parse(fs.readFileSync(path.join(root, "story-templates", `${id}.json`), "utf8"));
const recipes = () => fs.readdirSync(path.join(root, "story-templates"))
  .filter((file) => file.endsWith(".json"))
  .sort()
  .map((file) => recipe(path.basename(file, ".json")));

test("adoption plan creates isolated looks and remaps photo request slot ids", () => {
  const source = recipe("cinematic-film-01");
  const result = applyRecipePlan(source, map.recipes[source.id], library);
  const adopted = result.scenes.find((scene) => scene.id === "s84_photo_duo");

  assert.equal(adopted.look, "p2_overlap_duo");
  assert.deepEqual(adopted.photoSlots.map((slot) => slot.slot), ["back", "front"]);
  assert.equal(result.looks.p2_overlap_duo.layout, "overlap_stack_duo");
  assert.equal("frame" in result.looks.p2_overlap_duo, false);
  assert.equal(library.layouts.find((layout) => layout.id === "overlap_stack_duo")
    .photoSlots.find((slot) => slot.id === "front").frame.border, 14);
  assert.deepEqual(result.looks.p2_overlap_duo.layoutOverrides,
    map.recipes[source.id].adoptions[1].target.layoutOverrides);
  assert.deepEqual(source.scenes.find((scene) => scene.id === "s84_photo_duo").photoSlots
    .map((slot) => slot.slot), ["left", "right"], "input recipe was mutated");
});

test("circle adoption does not preserve a global frame that would override the medallion", () => {
  const source = recipe("jmii-silk-botanical-01");
  const result = applyRecipePlan(source, map.recipes[source.id], library);

  assert.equal(source.looks.arch_gallery.frame, "arch");
  assert.equal(result.looks.p2_circle_trio.layout, "circle_trio_stagger");
  assert.equal("frame" in result.looks.p2_circle_trio, false);
});

test("adoption plan fails before applying a drifted source look", () => {
  const source = recipe("cinematic-film-01");
  source.scenes.find((scene) => scene.id === "s84_photo_duo").look = "film_gallery";

  assert.throws(
    () => applyRecipePlan(source, map.recipes[source.id], library),
    /expected source look 'photo_duo_reel'/,
  );
});

test("CLI help is read-only and documents the guarded write mode", () => {
  const result = spawnSync(process.execPath, ["scripts/adoptNewPrimitives.mjs", "--help"], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--check-plan/);
  assert.match(result.stdout, /--write --batch/);
});

test("--check-plan applies the complete map in memory without changing recipe source", () => {
  const templateDir = path.join(root, "story-templates");
  const files = fs.readdirSync(templateDir).filter((file) => file.endsWith(".json")).sort();
  const before = new Map(files.map((file) => [
    file,
    fs.readFileSync(path.join(templateDir, file), "utf8"),
  ]));

  const result = spawnSync(process.execPath, ["scripts/adoptNewPrimitives.mjs", "--check-plan"], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout,
    /Content contract: 72 execution path\(s\), 1 union text key\(s\); photo demand and copy preserved\./);
  assert.match(result.stdout,
    /Gallery-tail contract: 24\/24 unique s83 > s84 > s85 signature\(s\)\./);
  assert.match(result.stdout,
    /Primitive host contract: 7 active; .*stacked_horizon_trio=2.*; 0 Phase 1b adoption\(s\)\./);
  assert.match(result.stdout,
    /Constrained cohort contract: 6\/6 unique gallery-tail signature\(s\); each adopts s83 > s84 > s85\./);
  assert.match(result.stdout,
    /Orientation contract: 0 request\(s\) land on the wrong shape; 11 declared shape change\(s\)\./);
  assert.match(result.stdout,
    /Composition contract: \d+ composition\(s\), 0 shared between recipes\./);
  assert.match(result.stdout,
    /Phase 2 targets on the simulated tree: reachable\.maxShare=12, over12=0, lint 24\/24 clean\./);
  assert.match(result.stdout,
    /Checked 70 adoption\(s\) across 23 recipe\(s\) \(70 pending, 0 already applied\); no files written\./);
  for (const file of files) {
    assert.equal(fs.readFileSync(path.join(templateDir, file), "utf8"), before.get(file),
      `${file} changed during --check-plan`);
  }
});

test("content audit preserves photo demand and copy on every reachable adoption path", () => {
  const allErrors = [];
  let pathCount = 0;
  let textKeyCount = 0;

  for (const [recipeId, plan] of Object.entries(map.recipes)) {
    const source = recipe(recipeId);
    const applied = applyRecipePlan(source, plan, library);
    const audit = adoptionContentAudit(source, applied, plan, library);
    allErrors.push(...audit.errors);
    pathCount += audit.pathCount;
    textKeyCount += audit.textKeyCount;
  }

  assert.deepEqual(allErrors, []);
  assert.equal(pathCount, 72);
  assert.equal(textKeyCount, 1);
});

test("content audit catches changed photo demand, missing text slots, and changed text unions", () => {
  const filmSource = recipe("cinematic-film-01");
  const filmPlan = map.recipes[filmSource.id];
  const filmApplied = applyRecipePlan(filmSource, filmPlan, library);
  const portrait = filmPlan.adoptions
    .find((adoption) => adoption.target.primitive === "offset_portrait_hero");
  filmApplied.looks[portrait.target.look].layout = "golden_column_pair";
  assert.ok(adoptionContentAudit(filmSource, filmApplied, filmPlan, library).errors
    .some((error) => /photo demand changed 1 -> 2/.test(error)));

  const seasonsSource = recipe("four-seasons-love-01");
  const seasonsPlan = map.recipes[seasonsSource.id];
  const seasonsApplied = applyRecipePlan(seasonsSource, seasonsPlan, library);
  const autumn = seasonsPlan.adoptions
    .find((adoption) => adoption.sceneId === "s03_autumn");
  seasonsApplied.looks[autumn.target.look].layout = "stacked_horizon_trio";
  const autumnScene = seasonsApplied.scenes
    .find((scene) => scene.id === autumn.sceneId);
  autumnScene.repeatable.variants[0].text = { body: "changed contract" };
  const errors = adoptionContentAudit(seasonsSource, seasonsApplied, seasonsPlan, library).errors;
  assert.ok(errors.some((error) => /text key 'heading' has no slot/.test(error)));
  assert.ok(errors.some((error) => /union text keys changed/.test(error)));
});

test("content audit checks an adopted scene's mute fallback independently", () => {
  const source = recipe("cinematic-film-01");
  const plan = map.recipes[source.id];
  const gallery = source.scenes.find((scene) => scene.id === "s83_gallery_matte");
  gallery.muteFallback = { layout: "gallery_matte_hero" };
  const applied = applyRecipePlan(source, plan, library);
  applied.scenes.find((scene) => scene.id === gallery.id)
    .muteFallback.layout = "golden_column_pair";

  const audit = adoptionContentAudit(source, applied, plan, library);
  assert.equal(audit.pathCount, 4);
  assert.ok(audit.errors.some(
    (error) => /s83_gallery_matte\/muteFallback: photo demand changed 1 -> 2/.test(error),
  ));
});

test("gallery-tail audit checks all simulated recipes, sequence order, and uniqueness", () => {
  const appliedRecipes = recipes().map((source) => (
    map.recipes[source.id]
      ? applyRecipePlan(source, map.recipes[source.id], library)
      : source
  ));
  const audit = galleryTailAudit(appliedRecipes, library);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.recipeCount, 24);
  assert.equal(audit.distinctCount, 24);

  const duplicate = JSON.parse(JSON.stringify(appliedRecipes[0]));
  duplicate.id = "duplicate-gallery-tail";
  assert.ok(galleryTailAudit([appliedRecipes[0], duplicate], library).errors
    .some((error) => /signature is shared by/.test(error)));

  const outOfOrder = JSON.parse(JSON.stringify(appliedRecipes[0]));
  const tailIndexes = outOfOrder.scenes
    .map((scene, index) => (/^s8[345]_/.test(scene.id) ? index : -1))
    .filter((index) => index >= 0);
  [outOfOrder.scenes[tailIndexes[0]], outOfOrder.scenes[tailIndexes[1]]] = [
    outOfOrder.scenes[tailIndexes[1]],
    outOfOrder.scenes[tailIndexes[0]],
  ];
  assert.ok(galleryTailAudit([outOfOrder], library).errors
    .some((error) => /gallery-tail order is s84 > s83 > s85/.test(error)));
});

test("primitive host audit counts unique recipes and rejects underuse or Phase 1b entries", () => {
  const audit = primitiveHostAudit(map);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.activeCount, 7);
  assert.deepEqual(audit.hosts, {
    overlap_stack_duo: 8,
    inset_card_hero: 7,
    circle_trio_stagger: 11,
    diagonal_staircase_trio: 11,
    golden_column_pair: 8,
    stacked_horizon_trio: 2,
    offset_portrait_hero: 22,
  });
  assert.equal(audit.forbiddenAdoptionCount, 0);

  const underused = JSON.parse(JSON.stringify(map));
  const horizonPlans = Object.values(underused.recipes)
    .filter((plan) => plan.adoptions.some(
      (adoption) => adoption.target.primitive === "stacked_horizon_trio",
    ));
  horizonPlans[0].adoptions = horizonPlans[0].adoptions.filter(
    (adoption) => adoption.target.primitive !== "stacked_horizon_trio",
  );
  assert.ok(primitiveHostAudit(underused).errors
    .some((error) => /stacked_horizon_trio has only 1 recipe host/.test(error)));

  const forbidden = JSON.parse(JSON.stringify(map));
  forbidden.recipes["cinematic-film-01"].adoptions[0]
    .target.primitive = "offset_quad_pinwheel";
  const forbiddenAudit = primitiveHostAudit(forbidden);
  assert.equal(forbiddenAudit.forbiddenAdoptionCount, 1);
  assert.ok(forbiddenAudit.errors
    .some((error) => /Phase 1b primitive 'offset_quad_pinwheel' is forbidden/.test(error)));
});

test("six constrained recipes adopt all tail scenes and remain unique when simulated together", () => {
  const appliedRecipes = recipes().map((source) => (
    map.recipes[source.id]
      ? applyRecipePlan(source, map.recipes[source.id], library)
      : source
  ));
  const audit = constrainedCohortAudit(map, appliedRecipes, library);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.recipeCount, 6);
  assert.equal(audit.distinctCount, 6);

  const incomplete = JSON.parse(JSON.stringify(map));
  incomplete.recipes["family-roots-01"].adoptions.pop();
  assert.ok(constrainedCohortAudit(incomplete, appliedRecipes, library).errors
    .some((error) => /family-roots-01: constrained recipe must adopt exactly/.test(error)));

  const collidedRecipes = JSON.parse(JSON.stringify(appliedRecipes));
  const editorial = collidedRecipes.find((recipe) => recipe.id === "editorial-bold-01");
  const familyIndex = collidedRecipes.findIndex((recipe) => recipe.id === "family-roots-01");
  collidedRecipes[familyIndex] = JSON.parse(JSON.stringify(editorial));
  collidedRecipes[familyIndex].id = "family-roots-01";
  assert.ok(constrainedCohortAudit(map, collidedRecipes, library).errors
    .some((error) => /gallery-tail signature is shared by editorial-bold-01, family-roots-01/.test(error)));
});

test("widespread geometry report retains every main, fallback, and repeat occurrence", () => {
  const stats = geometryStats(recipes(), library);
  const groups = stats.reachable.groups.filter((group) => group.share > 12);
  const report = formatWidespreadGeometryReport(stats);
  const reportedOccurrences = report.match(/^    location=/gm) || [];

  assert.deepEqual(groups.map((group) => group.share), [23, 15, 15, 14, 14, 13, 13]);
  assert.equal((report.match(/^geometry\[\d+\] key=/gm) || []).length, groups.length);
  assert.equal(reportedOccurrences.length,
    groups.reduce((sum, group) => sum + group.occurrences.length, 0));
  assert.match(report, /source=main/);
  assert.match(report, /source=muteFallback/);
  assert.match(report, /source=repeatableVariant/);
  assert.match(report, /\.repeatable\.variants\[\d+\]/);
});

test("P1.7R policy protects intrinsic frames, crop-safe strips, and coverage floors", () => {
  const allErrors = [];
  const horizonHosts = [];
  for (const [recipeId, plan] of Object.entries(map.recipes)) {
    const applied = applyRecipePlan(recipe(recipeId), plan, library);
    allErrors.push(...reauditedPrimitiveErrors(applied, plan, library));
    for (const adoption of plan.adoptions) {
      if (adoption.target.primitive !== "stacked_horizon_trio") continue;
      const scene = applied.scenes.find((candidate) => candidate.id === adoption.sceneId);
      horizonHosts.push(`${recipeId}/${scene.id}`);
      assert.ok(scene.photoSlots.every((slot) => slot.orient === "landscape"));
    }
  }

  assert.deepEqual(allErrors, []);
  assert.deepEqual(horizonHosts, [
    "afterparty-pulse-01/s03_dinner",
    "cinematic-vows-01/s02_anticipation",
  ]);

  const stalePlan = JSON.parse(JSON.stringify(map.recipes["cinematic-film-01"]));
  stalePlan.adoptions.find((adoption) => adoption.target.primitive === "offset_portrait_hero")
    .target.layoutOverrides.photoSlots.hero.width = 1020;
  const staleRecipe = applyRecipePlan(recipe("cinematic-film-01"), stalePlan, library);
  assert.ok(reauditedPrimitiveErrors(staleRecipe, stalePlan, library)
    .some((error) => /regresses the P1\.7R hero size\/coverage/.test(error)));
});

test("rebased adoption map still reaches the Phase 2 geometry and host targets", () => {
  const appliedRecipes = recipes().map((source) => (
    map.recipes[source.id]
      ? applyRecipePlan(source, map.recipes[source.id], library)
      : source
  ));
  const stats = geometryStats(appliedRecipes, library);
  const hosts = {};
  for (const plan of Object.values(map.recipes)) {
    for (const adoption of plan.adoptions) {
      hosts[adoption.target.primitive] = (hosts[adoption.target.primitive] || 0) + 1;
    }
  }

  assert.equal(Object.values(map.recipes)
    .reduce((sum, plan) => sum + plan.adoptions.length, 0), 70);
  assert.ok(stats.reachable.maxShare <= 12);
  assert.equal(stats.reachable.over12Count, 0);
  for (const recipeId of Object.keys(map.recipes)) {
    assert.ok(stats.perRecipe[recipeId].meaningful >= 3,
      `${recipeId} has ${stats.perRecipe[recipeId].meaningful} meaningful scene(s)`);
  }
  assert.ok(stats.perRecipe["white-weddings-full-01"].meaningful >= 1);
  for (const primitive of map.activePrimitives) {
    assert.ok(hosts[primitive] >= 2, `${primitive} has only ${hosts[primitive] || 0} host(s)`);
  }
  for (const primitive of map.forbiddenPrimitives) {
    assert.equal(hosts[primitive], undefined);
  }
});

const simulate = (source, overrideMap = map) => (
  overrideMap.recipes[source.id]
    ? applyRecipePlan(source, overrideMap.recipes[source.id], library)
    : source
);

// A batch rollout writes recipes in place. Every gate after batch one therefore reads a
// half-migrated catalogue, and the plan asks for the whole-map check to run after each
// batch — so re-reading an applied adoption has to be a verification, not a second write.
test("an applied batch verifies instead of re-applying, so the whole-map gate survives a rollout", () => {
  for (const recipeId of ["cinematic-film-01", "jmii-silk-botanical-01", "editorial-bold-01"]) {
    const plan = map.recipes[recipeId];
    const source = recipe(recipeId);
    const applied = applyRecipePlan(source, plan, library);

    for (const adoption of plan.adoptions) {
      assert.equal(adoptionStatus(source, adoption), "pending");
      assert.equal(adoptionStatus(applied, adoption), "applied");
    }
    assert.deepEqual(applyRecipePlan(applied, plan, library), applied,
      `${recipeId} is not idempotent`);
  }
});

test("verification rejects a written recipe that drifted away from the plan", () => {
  const plan = map.recipes["cinematic-film-01"];
  const applied = applyRecipePlan(recipe("cinematic-film-01"), plan, library);

  const wrongLayout = JSON.parse(JSON.stringify(applied));
  wrongLayout.looks.p2_circle_trio.layout = "diagonal_staircase_trio";
  assert.throws(() => applyRecipePlan(wrongLayout, plan, library),
    /applied look wears 'diagonal_staircase_trio'/);

  const wrongOverrides = JSON.parse(JSON.stringify(applied));
  wrongOverrides.looks.p2_circle_trio.layoutOverrides.photoSlots.p2.y = 999;
  assert.throws(() => applyRecipePlan(wrongOverrides, plan, library),
    /applied look overrides drifted from the plan/);

  const smuggled = JSON.parse(JSON.stringify(applied));
  smuggled.looks.p2_circle_trio.frame = "arch";
  assert.throws(() => applyRecipePlan(smuggled, plan, library),
    /applied look carries unplanned field 'frame'/);

  const renamed = JSON.parse(JSON.stringify(applied));
  renamed.scenes.find((scene) => scene.id === "s08c_breather").look = "something_else";
  assert.throws(() => applyRecipePlan(renamed, plan, library),
    /expected source look 'arch_trio_reel' or applied look 'p2_circle_trio'/);
});

// The whitelist that builds a target look copies three fields and drops the rest. This is
// the drop that mattered: cinematic-film-01's gallery paints its own matte, and losing it
// turned the scene cream — a change no photo-count or text-key check could see.
test("content audit refuses to drop a background the recipe painted", () => {
  const source = recipe("cinematic-film-01");
  const applied = applyRecipePlan(source, map.recipes[source.id], library);
  const gallery = resolveTemplate(applied, { library }).scenes
    .find((scene) => scene.id === "s83_gallery_matte");
  assert.deepEqual(gallery.resolvedLayout.background, { type: "tint", color: "#D8CFC0" });

  const strippedPlan = JSON.parse(JSON.stringify(map.recipes[source.id]));
  delete strippedPlan.adoptions
    .find((adoption) => adoption.sceneId === "s83_gallery_matte")
    .target.layoutOverrides.background;
  const stripped = applyRecipePlan(source, strippedPlan, library);
  const errors = adoptionContentAudit(source, stripped, strippedPlan, library).errors;
  assert.ok(errors.some((error) => /painted the background .*; the target drops it/.test(error)),
    errors.join("; "));

  const droppedField = JSON.parse(JSON.stringify(map.recipes["jmii-silk-botanical-01"]));
  const pair = droppedField.adoptions.find((adoption) => adoption.sceneId === "s11_side_by_side");
  pair.target.preserveLookFields = pair.target.preserveLookFields
    .filter((field) => field !== "frame");
  const jmii = recipe("jmii-silk-botanical-01");
  assert.ok(adoptionContentAudit(jmii, applyRecipePlan(jmii, droppedField, library), droppedField, library)
    .errors.some((error) => /look field 'frame' is dropped/.test(error)));
});

// Requests pair with the primitive's slots by index, so a swap can hand a portrait request
// a landscape hole without changing any count.
test("orientation audit rejects a portrait request landing in a landscape slot", () => {
  const source = recipe("jmii-silk-botanical-01");
  const plan = JSON.parse(JSON.stringify(map.recipes[source.id]));
  const pair = plan.adoptions.find((adoption) => adoption.sceneId === "s11_side_by_side");
  assert.equal(pair.target.layoutOverrides.photoSlots.major.width, 940,
    "the adoption must keep golden_column_pair's major slot off landscape");
  delete pair.target.layoutOverrides.photoSlots.major;

  const audit = orientationAudit(source, applyRecipePlan(source, plan, library), plan, library);
  assert.ok(audit.errors.some(
    (error) => /asks for a portrait photo but 'major' is landscape/.test(error),
  ), audit.errors.join("; "));
});

test("orientation audit counts declared shape changes and rejects undeclared ones", () => {
  let declared = 0;
  for (const [recipeId, plan] of Object.entries(map.recipes)) {
    const source = recipe(recipeId);
    const audit = orientationAudit(source, applyRecipePlan(source, plan, library), plan, library);
    assert.deepEqual(audit.errors, [], recipeId);
    declared += audit.declaredDriftCount;
  }
  assert.equal(declared, 11);

  const undeclared = JSON.parse(JSON.stringify(map.recipes["modern-teal-01"]));
  delete undeclared.adoptions
    .find((adoption) => adoption.sceneId === "s85_arch_trio").target.accepts;
  const teal = recipe("modern-teal-01");
  const audit = orientationAudit(teal, applyRecipePlan(teal, undeclared, library), undeclared, library);
  assert.equal(audit.errors.length, 3);
  assert.ok(audit.errors.every(
    (error) => /changes shape portrait -> landscape without declaring/.test(error),
  ));

  const unknown = JSON.parse(JSON.stringify(map.recipes["cinematic-film-01"]));
  unknown.adoptions[0].target.accepts = ["anything"];
  assert.ok(orientationAudit(recipe("cinematic-film-01"),
    applyRecipePlan(recipe("cinematic-film-01"), unknown, library), unknown, library)
    .errors.some((error) => /cannot declare unknown drift 'anything'/.test(error)));
});

// The catalogue shares no composition between any two recipes today. The committed bar is
// a third, which leaves room for a rollout to hand several recipes the same picture — and
// the gallery-tail audit compares the whole s83 > s84 > s85 sequence, so a single shared
// scene inside it stays invisible. Three recipes did exactly that on circle_trio_stagger.
test("composition audit refuses two recipes the same picture", () => {
  const audit = compositionUniquenessAudit(recipes().map((source) => simulate(source)), library);
  assert.deepEqual(audit.errors, []);

  const collidedMap = JSON.parse(JSON.stringify(map));
  collidedMap.recipes["classic-multisong-album-01"].adoptions
    .find((adoption) => adoption.sceneId === "s85_feature_duo")
    .target.layoutOverrides = { photoSlots: { p2: { y: 250 } } };
  const collided = recipes().map((source) => simulate(source, collidedMap));
  assert.ok(compositionUniquenessAudit(collided, library).errors.some(
    (error) => /composition layer:circle_trio_stagger#.+ is shared by cinematic-film-01, classic-multisong-album-01/
      .test(error),
  ));
});

test("simulated target audit measures the tree the rollout will produce", () => {
  const simulated = recipes().map((source) => simulate(source));
  const audit = simulatedTargetAudit(map, simulated, library);
  assert.deepEqual(audit.errors, []);
  assert.equal(audit.maxShare, 12);
  assert.equal(audit.over12Count, 0);
  assert.equal(audit.lintClean, 24);

  const strict = JSON.parse(JSON.stringify(map));
  strict.targets.reachableMaxShare = 11;
  assert.ok(simulatedTargetAudit(strict, simulated, library).errors
    .some((error) => /reachable\.maxShare is 12, target is 11/.test(error)));

  // The gate has to be able to fail: the source tree is exactly what it must reject.
  assert.ok(simulatedTargetAudit(map, recipes(), library).errors.length > 0);
});
