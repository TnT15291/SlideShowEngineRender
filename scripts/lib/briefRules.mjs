// Deterministic extraction of directives from a customer's prompt.
//
// Two jobs, and it matters that they are the same code:
//
//   1. THE STUB. With no DEEPSEEK_API_KEY, parseBrief still has to compile the
//      prompt into something, or the whole directive layer silently degrades to
//      "we ignored you" on every key-less run.
//
//   2. THE SAFETY NET. Even WITH a key, these rules run and are merged in. A model
//      asked to extract instructions will occasionally skip one — and a missed
//      instruction is invisible, which is the exact failure this whole layer exists
//      to kill. A regex that fires on "lật trang phim" cannot get bored.
//
// These rules are recall-oriented on purpose: over-extracting is cheap (the
// compliance report shows the customer what we thought they asked for, and a wrong
// row is a visible, fixable wrong row), while under-extracting is the invisible
// failure. Every hit quotes the clause that produced it — see rule 1 in directives.mjs.
//
// Job 2 is `recallNet()` at the bottom of this file. It used to be inlined in
// parseBrief only, and reviseProject — the node where most of the customer's direction
// actually arrives — computed its rule hits and then dropped them on the floor whenever
// a key was present. Caught live: "Dùng hiệu ứng lật trang phim" compiled to
// transition=smooth_left, and the rule that says lật trang -> film_roll_up was sitting
// right there, already evaluated, unused. One copy now, so a net that exists is a net
// that is actually under both nodes.
import { validateDirective } from "./directives.mjs";

/** A Unicode-safe word boundary. JavaScript's \b is ASCII-only, so /\bấm\b/ does not
 *  match "ấm" AT ALL — the rule looks right, fires never, and the customer's request
 *  disappears in exactly the silence this module exists to prevent. Lookarounds on
 *  \p{L} are the boundary that works in the language the customers actually write in. */
const word = (alts) => new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts})(?![\\p{L}\\p{N}])`, "iu");

/** Split a prompt into clauses. The clause is what gets QUOTED BACK to the customer,
 *  so it has to survive being read aloud: a hard-wrapped paragraph must be unwrapped
 *  first, or the receipt ends up citing them as having said "Đời sống ở". */
export function clauses(text) {
  return String(text || "")
    .replace(/\r/g, "")
    .split(/\n\s*\n+/)                       // blank line = a real paragraph break
    .flatMap((para) => para
      .replace(/\n+/g, " ")                  // ...any other newline is just wrapping
      .split(/(?<=[.;!?])\s+|\s+—\s+/))      // sentences, and em-dashed asides
    .map((c) => c.replace(/^[\s.,;:—-]+|[\s.,;:—-]+$/g, "").trim())
    .filter((c) => c.length > 2);
}

const ACT_RULES = [
  { re: /bạn bè|friends|gia đình|family|tiệc|party/i, act: "family_friends" },
  { re: word("nghi lễ|buổi lễ|lễ|ceremony|vows|trao nhẫn|nhà thờ"), act: "ceremony" },
  { re: /mở đầu|mở màn|opening|intro|đầu phim/i, act: "opening" },
  { re: /đoạn kết|kết thúc|kết phim|cuối phim|đoạn cuối|ending|outro/i, act: "ending" },
  { re: /chuyện tình|love story|hẹn hò|yêu nhau|quen nhau/i, act: "love_story" },
];

/** Which act (if any) a fragment is talking about. No match = the whole film. */
export function actOf(fragment) {
  return ACT_RULES.find((r) => r.re.test(fragment))?.act ?? null;
}

// A rule fires on a clause and yields a partial directive. `negate` marks the rules
// whose meaning inverts under "đừng/không/no" (a caption rule, mostly).
const RULES = [
  // --- effects -------------------------------------------------------------
  { re: /lật trang|cuộn phim|film ?roll|flip/i, kind: "effect", target: "film_roll_up" },
  { re: /zoom chậm|slow zoom|phóng chậm/i, kind: "effect", target: "slow_zoom_in" },
  { re: /lưới ảnh|ghép ảnh|collage|grid/i, kind: "effect", target: "collage_grid" },
  { re: /polaroid|ảnh lấy liền/i, kind: "effect", target: "polaroid" },
  { re: /chồng ảnh|double exposure|lồng ghép/i, kind: "effect", target: "double_exposure" },
  { re: /tường ảnh|memory wall|bức tường/i, kind: "effect", target: "memory_wall" },
  { re: /xo?á phông|blur background|làm mờ nền|bokeh/i, kind: "effect", target: "portrait_blur_background" },
  { re: /tiêu điểm tròn|circle focus|khoanh tròn/i, kind: "effect", target: "circle_focus" },

  // --- transitions ---------------------------------------------------------
  { re: /cắt thẳng|hard cut|không chuyển cảnh|cắt phăng/i, kind: "transition", target: "none" },
  { re: /chuyển mờ|mờ dần|crossfade|hoà tan|hòa tan/i, kind: "transition", target: "crossfade" },
  { re: /tối dần|fade (to )?black|đen dần/i, kind: "transition", target: "fade_to_black" },
  { re: /sáng dần|fade (to )?white|trắng dần/i, kind: "transition", target: "fade_to_white" },
  { re: /trượt|slide|đẩy ngang/i, kind: "transition", target: "slide_left" },

  // --- colour --------------------------------------------------------------
  { re: /super ?8|8 ?mm|phim cũ|hoài niệm|vintage|retro/i, kind: "color", target: "vintage" },
  { re: word("mộc|mộc mạc|giản dị|rustic"), kind: "color", target: "vintage" },
  { re: /tương phản cao|high contrast|đậm nét|gắt/i, kind: "color", target: "strong_contrast" },
  { re: /nhạt màu|bạc màu|faded|nhẹ màu/i, kind: "color", target: "lighter" },

  // --- overlays ------------------------------------------------------------
  { re: /hoàng hôn|sunset|nắng chiều/i, kind: "overlay", target: "sunset" },
  { re: word("mềm|mềm mại|soft|dịu|dịu dàng|êm"), kind: "overlay", target: "soft" },
  { re: word("ấm|ấm áp|warm|golden|vàng nắng"), kind: "overlay", target: "warm" },
  { re: /không overlay|no overlay|sạch sẽ|clean|tối giản|minimal/i, kind: "overlay", target: "none" },

  // --- pacing --------------------------------------------------------------
  { re: word("nhanh|fast|sôi động|dồn dập|dynamic|nhộn"), kind: "pacing", target: "fast" },
  { re: word("chậm|chậm rãi|slow|nhẹ nhàng|thư thả|khoan thai|tĩnh"), kind: "pacing", target: "slow" },
];

// A RE-TELLING, not a revision. These are the only phrases that may re-run the story
// nodes and hand back a different film, so they are matched narrowly and on purpose:
// the cost of missing one is that we ask the customer to rephrase, and the cost of a
// false positive is that we throw away the cut they already approved.
const RESTORY = /kể lại|kể theo|đổi (?:hẳn )?câu chuyện|đổi trình tự|đổi thứ tự|đảo ngược|sắp xếp lại|dựng lại|làm lại từ đầu|retell|re-?tell|reorder|restructure|different story|start over/i;

// Captions are op-shaped, not target-shaped: the customer forbids or demands words.
const CAPTION_FORBID = /(?:đừng|không|no|bỏ|xo?á|remove|drop)[^.]{0,24}(?:chữ|text|caption|lời|phụ đề|title)/i;
const CAPTION_REQUIRE = /(?:thêm|có|muốn|add|want)[^.]{0,24}(?:chữ|text|caption|lời|phụ đề)/i;

// A moment is matched by CONTENT TAG, not a filename the customer cannot know yet.
// Also op-shaped: a bare mention of "nhẫn cưới" is usually just narrating the day
// ("chúng tôi trao nhẫn dưới hoàng hôn"), so a tag hit alone does not fire — it needs
// MOMENT_MUST_HAVE's explicit ask, or a negator, to become an instruction rather than
// a fact about the wedding. Every target here is a real photo-content tag (vocab.mjs).
const MOMENT_MUST_HAVE = /phải có|cần có|nhất định (?:phải )?có|đừng (?:bỏ (?:lỡ|qua)|quên)|không (?:được )?(?:thiếu|bỏ (?:lỡ|qua))|nhớ (?:có|đưa|thêm)|make sure|must have|must include|need(?:s)? to (?:have|include)|don.?t (?:miss|forget)/i;
const MOMENT_TAGS = [
  { re: /trao nhẫn|nhẫn cưới|exchange rings?|wedding rings?/i, tag: "rings" },
  { re: /nụ hôn|cảnh hôn|hôn nhau|\bthe kiss\b|\bkissing\b/i, tag: "kiss" },
  { re: /lời thề|thề nguyện|exchanging vows|\bvows\b/i, tag: "vows" },
  { re: /khiêu vũ|điệu nhảy đầu|first dance/i, tag: "first_dance" },
  { re: /trang điểm|chuẩn bị (?:cô dâu|chú rể)|getting ready/i, tag: "getting_ready" },
  { re: /tiệc chiêu đãi|tiệc cưới|reception/i, tag: "reception" },
];

const DURATION_MIN = /(\d+(?:[.,]\d+)?)\s*(?:phút|phut|min\b|minutes?\b)/i;
const DURATION_SEC = /(\d+(?:[.,]\d+)?)\s*(?:giây|giay|sec\b|seconds?\b|s\b)/i;
const MUSIC_HIGHLIGHT = /(?:video\s*)?highlights?|phim ngắn|bản ngắn|đoạn cao trào/i;
const MUSIC_FULL = /dùng (?:toàn bộ|hết|trọn)(?:\s+cả)? bài|toàn bộ bài hát|không cắt nhạc|không cúp nhạc|full song|use the whole song/i;
const MUSIC_AUTO = /tự (?:chọn|quyết định).{0,24}(?:thời lượng|độ dài)|thời lượng phù hợp|auto(?:matic)? duration/i;
// Extending a track that is too short for the album — the mirror of a highlight trim.
// "nối" = splice another track in; "lặp/lặp lại/phát lại" = repeat the same one.
const MUSIC_PLAYLIST = /nối (?:thêm |sang )?(?:bài|nhạc)|ghép (?:thêm )?(?:bài|nhạc)|thêm (?:một )?bài (?:nhạc|hát)( khác)?|dùng (?:2|hai|nhiều) bài|another (?:song|track)|add a (?:second|another) (?:song|track)/i;
const MUSIC_LOOP = /lặp lại bài|lặp bài|phát lại (?:bài|nhạc)|loop (?:the )?(?:song|music|track)/i;

// "khoảng 3 phút" is a preference; "đúng 3 phút" is a requirement. Same for looks:
// a customer who writes "nếu được" is not issuing an order.
const SOFT = /khoảng|tầm|cỡ|nếu được|nếu có thể|ưu tiên|prefer|around|about|roughly|ideally/i;
const NEGATED = word("đừng|không|chớ|chẳng|no|not|don't|dont|avoid|tránh|khỏi");

// Sentences that are giving an ORDER, as opposed to telling the story. Used only to
// notice, in STUB mode, that the customer asked for something no rule understood —
// so it can be reported as unmapped instead of evaporating. Deliberately narrow:
// "làm" alone appears in "trở về Việt Nam làm đám cưới", which is not an instruction.
const IMPERATIVE = /(?:làm giống|kiểu như|giống như|giống video|y hệt)|(?<![\p{L}])(?:dùng|đừng|hãy|nhớ|muốn|yêu cầu|please)(?![\p{L}])/iu;

/** NEGATION IS SCOPED TO THE CLAUSE, NOT THE SENTENCE.
 *
 * "Nhịp chậm rãi thôi, đừng dồn dập" is ONE sentence carrying TWO opposite polarities.
 * Testing the whole sentence for a negator emitted pacing=slow AND pacing=fast — two
 * contradictory orders from one wish. And "Giọng ấm, mộc, gần gũi, không lên gân" had
 * every colour rule suppressed by a "không" that was negating something else entirely.
 *
 * So rules are evaluated per comma-separated clause (the unit of MEANING), while the
 * quote shown to the customer stays the whole sentence (the unit of READING). Act
 * scope is resolved per clause too — which is what makes "đừng để chữ trên mấy tấm
 * ảnh nghi lễ" land on `ceremony` even though the sentence opens with "Đoạn bạn bè".
 */
const fragments = (sentence) => sentence.split(/[,:]/).map((f) => f.trim()).filter(Boolean);

/** Compile a prompt into raw directives (unvalidated — directives.mjs clamps them).
 *  Each carries the sentence it came from, so the customer sees their own words. */
export function extractDirectives(prompt) {
  const out = [];
  const seen = new Set();
  let n = 0;

  for (const sentence of clauses(prompt)) {
    const sentenceAct = actOf(sentence); // "Đoạn bạn bè thì..." scopes the clauses after it
    let hits = 0;

    const push = (d, quote) => {
      // One directive per (kind, scope, op, target): a sentence that says "ấm" twice
      // is still one request.
      const key = `${d.kind}:${JSON.stringify(d.scope)}:${d.op}:${d.target}`;
      if (seen.has(key)) return;
      seen.add(key);
      hits++;
      out.push({ id: `r${++n}`, quote, confidence: 0.6, source: "prompt", ...d });
    };

    for (const frag of fragments(sentence)) {
      const act = actOf(frag) ?? sentenceAct;
      const scope = act ? { act } : { global: true };
      const strength = SOFT.test(frag) ? "prefer" : "must";
      const negated = NEGATED.test(frag);

      if (MUSIC_FULL.test(frag)) push({ kind: "music_mode", op: "set", scope: { global: true }, target: "full_song", strength }, sentence);
      else if (MUSIC_HIGHLIGHT.test(frag)) push({ kind: "music_mode", op: "set", scope: { global: true }, target: "highlight", strength }, sentence);
      else if (MUSIC_PLAYLIST.test(frag)) push({ kind: "music_mode", op: "set", scope: { global: true }, target: "playlist", strength }, sentence);
      else if (MUSIC_LOOP.test(frag)) push({ kind: "music_mode", op: "set", scope: { global: true }, target: "loop", strength }, sentence);
      else if (MUSIC_AUTO.test(frag)) push({ kind: "music_mode", op: "set", scope: { global: true }, target: "auto", strength }, sentence);

      for (const rule of RULES) {
        if (!rule.re.test(frag)) continue;
        if (negated) {
          // "đừng dùng zoom chậm" is a forbid. But colour/overlay/pacing have no
          // meaningful negative form — "not warm" names no curve — so a negated
          // clause simply does not fire them. Silent beats wrong.
          if (rule.kind === "effect" || rule.kind === "transition") {
            push({ kind: rule.kind, op: "forbid", scope, target: rule.target, strength }, sentence);
          }
          continue;
        }
        push({ kind: rule.kind, op: "set", scope, target: rule.target, strength }, sentence);
      }

      if (RESTORY.test(frag)) push({ kind: "structure", op: "set", scope: { global: true }, target: sentence.slice(0, 300), strength }, sentence);

      if (CAPTION_FORBID.test(frag)) push({ kind: "caption", op: "forbid", scope, target: null, strength }, sentence);
      else if (CAPTION_REQUIRE.test(frag)) push({ kind: "caption", op: "require", scope, target: null, strength }, sentence);

      for (const rule of MOMENT_TAGS) {
        if (!rule.re.test(frag)) continue;
        if (negated) push({ kind: "moment", op: "forbid", scope, target: rule.tag, strength }, sentence);
        else if (MOMENT_MUST_HAVE.test(frag)) push({ kind: "moment", op: "require", scope, target: rule.tag, strength }, sentence);
      }

      const min = frag.match(DURATION_MIN);
      const sec = !min && frag.match(DURATION_SEC);
      if (min || sec) {
        const raw = Number((min || sec)[1].replace(",", "."));
        push({
          kind: "duration", op: "set", scope: { global: true },
          target: min ? Math.round(raw * 60) : Math.round(raw), strength,
        }, sentence);
      }
    }

    // An order we could not read. Reporting it is the whole point: the customer finds
    // out we did not understand, instead of finding out we ignored them.
    if (!hits && IMPERATIVE.test(sentence)) {
      out.push({ __unmapped: true, quote: sentence, reason: "no rule understood this instruction" });
    }
  }
  return out;
}

/** Split rule hits into the directives they became and the orders none of them understood. */
export function ruleHits(text) {
  const hits = extractDirectives(text);
  return {
    directives: hits.filter((d) => !d.__unmapped),
    unmapped: hits.filter((d) => d.__unmapped).map(({ quote, reason }) => ({ quote, reason })),
  };
}

/** THE RECALL NET: rule hits the model walked past, validated and ready to merge.
 *
 *  Merged on (kind, scope) — NOT on the exact target — because the failure being caught
 *  is "the model never noticed the customer mentioned transitions at all". If it DID
 *  notice and picked a different target, that is a judgement call, and the model read
 *  more context than a regex can, so its answer stands.
 *
 *  @param {string} text      what the customer wrote
 *  @param {Array}  already   the validated directives the model produced
 *  @param {string} source    provenance stamp for anything this adds
 *  @returns {Array} validated directives to append (possibly empty)
 */
export function recallNet(text, already, source) {
  const covered = new Set(already.map((d) => `${d.kind}:${JSON.stringify(d.scope)}`));
  const missed = [];
  ruleHits(text).directives.forEach((d, i) => {
    const key = `${d.kind}:${JSON.stringify(d.scope)}`;
    if (covered.has(key)) return;
    const r = validateDirective({ ...d, source }, already.length + i);
    if (!r.ok) return;
    covered.add(key); // a rule firing twice on one clause is still one instruction
    missed.push(r.directive);
  });
  return missed;
}
