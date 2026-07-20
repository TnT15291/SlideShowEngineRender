// ONE predicate for whether a photo set and a song fit each other — BOTH directions.
//
// The repo already had half of this. `musicHighlight.mjs` decides "too few photos for the
// song" (needsExcerpt, the 7.2s/photo line) and cuts a highlight, and `pacing.describeFit`
// names a `too_many_photos` verdict — but nothing ever acted on the "too many" side, so a
// 130-photo album against a 90-second highlight silently dropped 50 of the couple's photos
// with no word to anyone. This module completes the predicate: it reads photo count + music
// duration, classifies the job into a regime, and returns the concrete options a person
// could pick between — WITHOUT deciding anything itself. The decision, and who made it, is
// recorded elsewhere (fit_decision.json); this only describes the situation.
//
// It reuses, never re-derives: FULL_SONG_MAX_SEC_PER_PHOTO / needsExcerpt / chooseMusicEdit
// from musicHighlight, MIN_SCENE from pacing. The one new number is the crowding floor.

import { FULL_SONG_MAX_SEC_PER_PHOTO, needsExcerpt, chooseMusicEdit } from "./musicHighlight.mjs";
import { MIN_SCENE } from "./pacing.mjs";
import { HIGHLIGHT_MIN_SEC } from "./rules/thresholds.mjs";

// A natural wedding cut sits near 4s/photo; the full-song line tolerates 1.8x that (7.2s)
// before the film crawls. The crowding floor is the mirror: below it there are more photos
// than the song has comfortable room for. Two floors, because a montage legitimately runs
// photos faster than a single scene — the surplus between them is what montages ABSORB
// (situation "many, mild"); past the montage floor the surplus has nowhere to go but the
// cutting-room floor (situation "many, severe").
export const NATURAL_SEC_PER_PHOTO = 4;
export const SINGLE_FLOOR_SEC_PER_PHOTO = 2.5;   // a comfortable single scene, a touch above MIN_SCENE
export const MONTAGE_FLOOR_SEC_PER_PHOTO = 1.5;  // photos flying by inside a montage beat
// A film needs enough scenes to open, tell a little, and close. Below this an album cannot
// carry a bookended story no matter how the music is cut.
export const MIN_COHERENT_PHOTOS = 5;

const round = (n) => +Number(n).toFixed(2);

/**
 * @param {object}   music        analyzeMusic output (needs `duration`; `phrases` help the highlight)
 * @param {object[]} photos       the USABLE pool — callers filter unreadable/missing files first
 * @param {object}   [orders]     directive ledger entries (a music_mode/duration order pre-answers this)
 * @param {object}   [brief]      parsed brief (mustUsePhotos etc.)
 * @param {number}   [extraTracks] how many OTHER tracks the customer supplied (enables "play next song")
 * @returns {{regime, secondsPerPhoto, targetPhotos, feasibleBand, evidence, options}}
 */
export function assessFit({ music, photos, orders = [], brief = {}, extraTracks = 0 } = {}) {
  const D = Number(music?.duration) || 0;
  const N = Array.isArray(photos) ? photos.length : Number(photos) || 0;
  if (D <= 0) throw new Error("assessFit needs a positive music duration");

  const secondsPerPhoto = N > 0 ? D / N : Infinity;
  // The photo counts that fill THIS song comfortably. More photos than the montage floor
  // allows is crowded; fewer than the full-song line allows makes the film crawl.
  const feasibleBand = {
    min: Math.ceil(D / FULL_SONG_MAX_SEC_PER_PHOTO),
    max: Math.floor(D / MONTAGE_FLOOR_SEC_PER_PHOTO),
  };
  const targetPhotos = Math.max(1, Math.round(D / NATURAL_SEC_PER_PHOTO));

  // Has the customer already answered this in their own words? Then there is no question —
  // the same rule selectMusicEdit follows. A music_mode/duration order settles it silently.
  const preAnswered = orders.find((d) => (d.kind === "music_mode" || d.kind === "duration") && d.op === "set") || null;

  const evidence = {
    photoCount: N,
    musicDuration: round(D),
    secondsPerPhoto: Number.isFinite(secondsPerPhoto) ? round(secondsPerPhoto) : null,
    targetPhotos,
    feasibleBand,
    fullSongCarriable: !needsExcerpt(music, N),
    ...(preAnswered ? { preAnswered: { kind: preAnswered.kind, target: preAnswered.target, quote: preAnswered.quote } } : {}),
  };

  // Boundaries expressed as photo counts, all derived from the same per-photo floors that
  // define feasibleBand — so the regime and the band it reports can never disagree.
  const comfortMax = Math.floor(D / SINGLE_FLOOR_SEC_PER_PHOTO); // past here, montages start carrying the surplus
  let regime;
  if (N < MIN_COHERENT_PHOTOS) regime = "too_few_for_a_film";
  else if (N < feasibleBand.min) {
    // Fewer photos than the song wants. A highlight is the answer while the shortest window
    // (HIGHLIGHT_MIN_SEC) can still be carried; below that even the trim cannot save it.
    regime = N >= Math.ceil(HIGHLIGHT_MIN_SEC / FULL_SONG_MAX_SEC_PER_PHOTO) ? "few_photos" : "far_too_few_photos";
  } else if (N > 2 * feasibleBand.max) regime = "far_too_many_photos"; // past even twice the montage capacity
  else if (N > comfortMax) regime = "many_photos";                     // montages absorb the surplus
  else regime = "balanced";

  return { regime, secondsPerPhoto: evidence.secondsPerPhoto, targetPhotos, feasibleBand, preAnswered: Boolean(preAnswered), evidence, options: optionsFor(regime, { music, N, D, targetPhotos, feasibleBand, extraTracks }) };
}

/** The concrete choices to put in front of a person. Each is described by its CONSEQUENCE
 *  (what the film becomes), and marked `recommended` when it is the safe default. `executable`
 *  says a downstream node can carry it out unattended; a false one needs the customer to act
 *  (add photos, pick another song). */
function optionsFor(regime, { music, N, D, targetPhotos, feasibleBand, extraTracks }) {
  const highlight = () => {
    const edit = chooseMusicEdit(music, N, { mode: "highlight" });
    return { id: "highlight", label: `Cắt highlight ${Math.round(edit.duration)}s`,
      consequence: `Phim ngắn lại còn ~${Math.round(edit.duration)}s, mỗi ảnh giữ nhịp tự nhiên; dùng ${N} ảnh, cắt phần nhạc yếu.`,
      musicMode: "highlight", executable: true };
  };
  const stretch = () => ({ id: "full_song_stretch", label: "Giữ trọn bài, kéo dài cảnh",
    consequence: `Giữ nguyên ${Math.round(D)}s nhạc; ${N} ảnh phải giãn ra, phim chậm hơn (mỗi ảnh > ${FULL_SONG_MAX_SEC_PER_PHOTO}s).`,
    musicMode: "full_song", executable: true });
  const addPhotos = (need) => ({ id: "add_photos", label: `Thêm ~${need} ảnh`,
    consequence: `Đủ ${targetPhotos} ảnh để gánh trọn bài ở nhịp tự nhiên (${NATURAL_SEC_PER_PHOTO}s/ảnh).`,
    executable: false });
  const cull = (keep) => ({ id: "cull", label: `Bớt xuống ~${keep} ảnh`,
    consequence: `Giữ ${keep} ảnh mạnh nhất để khớp trọn bài; đề xuất bỏ ảnh trùng/kém trước, kèm lý do từng tấm. Bạn duyệt trước khi bỏ.`,
    targetPhotos: keep, executable: true });
  const extendMusic = () => (extraTracks > 0
    ? { id: "playlist", label: "Nối sang bài kế tiếp",
        consequence: `Ghép bài nhạc thứ hai để đủ dài cho ${N} ảnh, chuyển bài bằng crossfade.`,
        musicMode: "playlist", executable: true }
    : { id: "loop", label: "Lặp lại bài hiện tại",
        consequence: `Phát lại bài để đủ dài cho ${N} ảnh (có thể nghe lặp — cân nhắc thêm bài khác).`,
        musicMode: "loop", executable: true });
  const shorterTrack = () => ({ id: "shorter_track", label: "Chọn bài ngắn hơn",
    consequence: `Bài dài ${Math.round(D)}s cần ${feasibleBand.min}+ ảnh; chọn bài ~${Math.round(N * NATURAL_SEC_PER_PHOTO)}s vừa với ${N} ảnh.`,
    executable: false });

  switch (regime) {
    case "balanced":
      return []; // no question — the song and the album already agree
    case "few_photos":
      return [{ ...highlight(), recommended: true }, stretch(), addPhotos(Math.max(0, targetPhotos - N))];
    case "far_too_few_photos":
      return [{ ...highlight(), recommended: true }, addPhotos(Math.max(0, feasibleBand.min - N)), shorterTrack()];
    case "many_photos":
      // Montages absorb this range; keeping every photo is the safe default. Culling is offered,
      // never taken — the album's own policy defaults to keep_all.
      return [{ id: "keep_all", label: "Giữ hết ảnh", recommended: true,
        consequence: `Dồn ảnh dư vào các beat montage; có thể còn ${Math.max(0, N - feasibleBand.max)} ảnh không lên hình, sẽ báo rõ.`,
        executable: true }, cull(targetPhotos), extendMusic()];
    case "far_too_many_photos":
      return [{ ...cull(targetPhotos), recommended: true }, extendMusic(),
        { id: "keep_all", label: "Vẫn giữ hết (cắt rất nhanh)",
          consequence: `Ảnh bay rất nhanh và nhiều tấm sẽ không lên hình — không khuyến khích cho ${N} ảnh trên ${Math.round(D)}s.`,
          executable: true }];
    case "too_few_for_a_film":
      return [addPhotos(Math.max(1, MIN_COHERENT_PHOTOS - N)),
        { id: "shorter_film", label: "Làm đoạn rất ngắn",
          consequence: `${N} ảnh chỉ đủ một đoạn rất ngắn, không có mở/kết đầy đủ.`, executable: false }];
    default:
      return [];
  }
}
