const photos = Array.from({ length: 84 }, (_, index) => ({
  file: `photo-${String(index + 1).padStart(3, "0")}.jpg`,
  orient: index % 3 === 0 ? "portrait" : "landscape",
  subjectCount: index % 4 === 0 ? 1 : 2,
  heroScore: +(1 - index / 100).toFixed(2),
}));

const slides = Array.from({ length: 43 }, (_, index) => {
  const montage = index > 0 && index < 26;
  const preferredPair = [photos[(index * 2) % 10].file, photos[(index * 2 + 1) % 10].file];
  return {
    id: `scene_${String(index + 1).padStart(3, "0")}`,
    duration: index < 8 ? 7.05 : 5,
    effect: montage ? (index % 2 ? "film_roll_up" : "collage_grid") : "portrait_blur_background",
    ...(montage ? { images: [preferredPair[0], preferredPair[1], preferredPair[0], preferredPair[1], preferredPair[0], preferredPair[1]] }
      : { image: photos[index % 26].file }),
    transition: { type: index === 42 ? "none" : "crossfade", duration: index === 42 ? 0 : 0.7 },
    ...(index < 10 ? { captions: [{ text: `Một câu chuyện tình yêu rất dài cần được hiển thị trọn vẹn trên màn hình số ${index + 1}`, duration: 3.5 }] } : {}),
  };
});

export const tuanTienLiteRegression = {
  photos,
  story: {
    title: "Tuân & Tiên",
    beats: Array.from({ length: 8 }, (_, index) => ({
      heading: `Chương ${index + 1}`,
      body: `Kỷ niệm ${index + 1}`,
      emotion: index % 3 === 0 ? "build" : "warm",
      sceneKind: index % 2 ? "montage" : "single",
      preferredPhotos: [photos[index * 2].file, photos[index * 2 + 1].file],
    })),
    closing: "Mãi mãi bên nhau",
  },
  music: { duration: 235.27, beatGrid: { beatSeconds: 0.5 }, phrases: [] },
  timeline: { metadata: { targetDuration: 235.27 }, slides },
  proxy: {
    verdict: "review",
    problems: Array.from({ length: 22 }, (_, index) => ({
      id: `scene_${String(index + 2).padStart(3, "0")}`,
      check: "duplicate_photo",
      flags: ["adjacent_duplicate"],
    })),
  },
  qaLoop: { status: "clean" },
};
