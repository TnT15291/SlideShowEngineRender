import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function renderCaption(caption, frameHeight = 1080) {
  const script = `
    import { buildCaptionFilter } from "./src/captionFilter.ts";
    console.log(buildCaptionFilter(${JSON.stringify(caption)}, ${frameHeight}));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return run.stdout.trim();
}

test("caption filter preserves Windows path quoting and role-based defaults", () => {
  const filter = renderCaption({
    text: "Quốc & Nhi",
    role: "title",
    position: "center",
    start: 1,
    duration: 3,
    color: "#f4e7d3",
    shadow: true,
    animation: "none",
    textFile: "C:/job/temp/title.txt",
    fontFile: "C:/job/fonts/Playfair.ttf",
  });

  assert.equal(
    filter,
    "drawtext=fontfile='C\\:/job/fonts/Playfair.ttf':textfile='C\\:/job/temp/title.txt':" +
      "fontcolor=0xf4e7d3:fontsize=83:x=(w-text_w)/2:y=(h-text_h)/2:" +
      "enable='between(t,1,4)':shadowcolor=black@0.6:shadowx=2:shadowy=2"
  );
});

test("caption filter preserves slide-up alpha, size override, and outline", () => {
  const filter = renderCaption({
    text: "Mãi mãi",
    role: "caption",
    position: "bottom_center",
    start: 0.5,
    duration: 2,
    size: 48,
    color: "white",
    outline: { color: "#000000", width: 3 },
    shadow: false,
    animation: "slide_up",
    textFile: "D:/temp/caption.txt",
    fontFile: "D:/fonts/Arial.ttf",
  });

  assert.equal(
    filter,
    "drawtext=fontfile='D\\:/fonts/Arial.ttf':textfile='D\\:/temp/caption.txt':fontcolor=white:" +
      "fontsize=48:x=(w-text_w)/2:alpha='if(lt(t,0.5),0,if(lt(t,1),(t-0.5)/0.5," +
      "if(lt(t,2),1,if(lt(t,2.5),(2.5-t)/0.5,0))))':" +
      "y='h-text_h-h/12+(h/20)*(1-min((t-0.5)/0.6,1))':bordercolor=0x000000:borderw=3"
  );
});
