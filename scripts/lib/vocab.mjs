// The controlled vocabularies, loaded LIVE from the schema that defines them.
//
// They used to be hand-copied into four places (analyzePhotoContent, generateStoryPlan,
// photo-content.schema.json, story-plan.schema.json). Nothing kept them in step, so
// adding a tag in three of the four gave you a whitelist that ACCEPTS a tag at one
// node and silently DROPS it at the next — the value disappears with no error, which
// is the hardest kind of bug to see. Same reason generateDirectorNotes loads the
// effect/transition whitelist from timeline.schema.json instead of restating it.
//
// schema/photo-content.schema.json is the definition. Everything else reads it here.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const schema = JSON.parse(
  fs.readFileSync(path.resolve(root, "schema/photo-content.schema.json"), "utf8")
);

const tagEnum = schema.$defs?.tag?.enum;
const emotionEnum = schema.$defs?.emotion?.enum;

if (!Array.isArray(tagEnum) || !tagEnum.length) {
  throw new Error("schema/photo-content.schema.json: $defs.tag.enum is missing — the tag vocabulary has no definition");
}
if (!Array.isArray(emotionEnum) || !emotionEnum.length) {
  throw new Error("schema/photo-content.schema.json: $defs.emotion.enum is missing");
}

export const TAG_LIST = [...tagEnum];
export const TAG_VOCAB = new Set(TAG_LIST);
export const EMOTION_LIST = [...emotionEnum];
export const EMOTION_VOCAB = new Set(EMOTION_LIST);
