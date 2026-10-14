// Writes the demo pages used for the README screenshots (docs/media/src/site).
// Fictional publication "Abyssal Notes"; all names are invented.
const fs = require("fs");
const path = require("path");
const out = path.join(__dirname, "site");

const css = `
:root{--ink:#0f172a;--muted:#475569;--line:#e2e8f0;--accent:#0e7490}
*{box-sizing:border-box}body{margin:0;font:17px/1.65 Georgia,"Iowan Old Style",serif;color:var(--ink);background:#fbfaf7}
header{border-bottom:1px solid var(--line);background:#fff}
.bar{max-width:1000px;margin:0 auto;padding:14px 24px;display:flex;align-items:center;gap:24px;font:600 14px/1 -apple-system,"Segoe UI",sans-serif}
.brand{font:700 18px/1 Georgia,serif;letter-spacing:.02em}.brand b{color:var(--accent)}
.bar nav{display:flex;gap:18px;color:var(--muted)}
main{max-width:760px;margin:0 auto;padding:36px 24px 80px}
.kicker{font:600 12px/1 -apple-system,sans-serif;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
h1{font-size:40px;line-height:1.15;margin:10px 0 12px}
.dek{font-size:20px;color:var(--muted);margin:0 0 18px}
.by{font:14px/1.4 -apple-system,sans-serif;color:var(--muted);margin-bottom:22px}
figure{margin:0 0 26px}figure img,figure video{width:100%;border-radius:6px;display:block;background:#000}
figcaption{font:13px/1.4 -apple-system,sans-serif;color:var(--muted);margin-top:6px}
h2{font-size:24px;margin:34px 0 8px}
p{margin:0 0 16px}
.related a{color:var(--accent)}
footer{border-top:1px solid var(--line);font:13px -apple-system,sans-serif;color:var(--muted);padding:20px;text-align:center}
`;

function page({ file, title, kicker, dek, by, img, video, body, caption }) {
  const media = video
    ? `<figure><video src="video/${video}.webm" muted loop playsinline controls></video><figcaption>${dek}</figcaption></figure>`
    : `<figure><img src="img/${img}.jpg" alt=""><figcaption>${caption || "Bioluminescent animals in the twilight zone, about 600 metres down."}</figcaption></figure>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title} | Abyssal Notes</title>
<meta name="description" content="${dek}"><meta property="og:title" content="${title}"><meta property="og:image" content="/img/${img || video}.jpg">
<meta name="viewport" content="width=device-width"><style>${css}</style></head><body>
<header><div class="bar"><span class="brand">Abyssal <b>Notes</b></span><nav><span>Ocean</span><span>Life</span><span>Expeditions</span><span>Video</span></nav></div></header>
<main><article>${video ? media : ""}<div class="kicker">${kicker}</div><h1>${title}</h1><p class="dek">${dek}</p><div class="by">${by}</div>${video ? "" : media}${body}</article></main>
<footer>Abyssal Notes is a fictional publication.</footer></body></html>`;
  fs.writeFileSync(path.join(out, file), html);
}

const P = (...ps) => ps.map((p) => `<p>${p}</p>`).join("");

page({
  file: "article.html",
  title: "How deep-sea animals make their own light",
  kicker: "Ocean life · Long read",
  dek: "Three out of four animals in the open ocean can produce light. Bioluminescence is the most common form of communication on the planet, and most of it happens where no sunlight reaches.",
  by: "By Mara Velde · 14 min read",
  img: "deep",
  body:
    `<h2>Luciferin and luciferase</h2>` +
    P(
      "Bioluminescence is a chemical reaction. A light-emitting molecule called luciferin is oxidised with the help of an enzyme, luciferase, and the energy is released as a photon. Most deep-sea light is blue-green, around 470 nanometres, because those wavelengths travel furthest through seawater.",
      "Coelenterazine, the most widespread luciferin in the ocean, is shared by jellyfish, copepods, shrimp and squid. Many animals cannot make it themselves and get it from their diet."
    ) +
    `<h2>Photophores and counterillumination</h2>` +
    P(
      "Photophores are light organs, sometimes with lenses, reflectors and colour filters. In the twilight zone, between 200 and 1,000 metres, many fish and squid line their bellies with photophores and match the faint light from above. This counterillumination erases their silhouette for predators looking up.",
      "The firefly squid and the hatchetfish adjust the brightness of their photophores within seconds as clouds pass overhead, hundreds of metres above them."
    ) +
    `<h2>Lures, alarms and decoys</h2>` +
    P(
      "The anglerfish lure glows because it hosts symbiotic bacteria. Some shrimp spit clouds of glowing fluid to blind a predator, and the deep-sea jellyfish Atolla flashes in rings, a burglar alarm that may call larger predators to attack whatever is attacking it."
    ) +
    `<h2>Studying light in the dark</h2>` +
    P(
      "Most of what is known comes from remotely operated vehicles and crewed submersibles. White lights scare animals away, so researchers now film with red light and low-light cameras, and use electronic lures that mimic the Atolla alarm.",
      "Milky seas, where plankton light up thousands of square kilometres of surface water, were confirmed by satellites before any research ship could reach one."
    ) +
    `<p class="related">Related: <a href="/squid.html">How squid hide in the twilight zone</a> · <a href="/lure.html">Inside the anglerfish lure</a> · <a href="/plankton.html">Milky seas</a></p>`,
});

const related = [
  ["squid.html", "Counterillumination: how squid hide in the twilight zone", "Bioluminescent squid in the twilight zone tune their belly lights to the moonlight above them.", "squid"],
  ["lure.html", "Bioluminescent lures: inside the anglerfish", "The glowing lure is a farm for symbiotic bacteria that the anglerfish cannot live without.", "lure"],
  ["plankton.html", "Milky seas: bioluminescent plankton seen from space", "Satellites have tracked glowing patches of sea larger than a small country.", "plankton"],
  ["jelly.html", "Why so many jellyfish glow", "Alarm flashes, lures and decoys: the many uses of light in gelatinous animals.", "jelly"],
  ["sub.html", "Diving the twilight zone with red light", "How low-light cameras changed what submersible crews see at 800 metres.", "sub"],
  ["vent.html", "Light at hydrothermal vents", "Vents glow faintly with thermal radiation. Some shrimp may see it.", "vent"],
  ["map.html", "Mapping the deep scattering layer", "A layer of animals so dense that sonar once mistook it for the sea floor.", "map"],
];
for (const [file, title, dek, img] of related) {
  page({
    file,
    title,
    kicker: "Ocean life",
    dek,
    by: "Abyssal Notes staff",
    img,
    caption: dek,
    body: P(
      `${dek} Bioluminescence in the twilight zone is driven by luciferin and luciferase, and researchers have described photophores in more than 1,500 species of fish alone.`,
      "Counterillumination, lures and alarm flashes are the three uses of bioluminescence seen most often in the twilight zone. Each evolved independently many times, which is why bioluminescence is described as one of the most repeated inventions in evolution.",
      "Studying bioluminescence means working in the dark: crews in the twilight zone film with red light, because most deep-sea animals cannot see it."
    ),
  });
}

const videos = [
  ["v-jelly.html", "Jellyfish cam: Atolla alarm display", "jelly"],
  ["v-plankton.html", "Milky sea, filmed from the surface", "plankton"],
  ["v-vent.html", "Hydrothermal vent field, live", "vent"],
  ["v-squid.html", "Firefly squid counterillumination", "squid"],
];
for (const [file, title, video] of videos) {
  page({ file, title, kicker: "Video", dek: title, by: "Abyssal Notes video", video, img: video, body: P("Bioluminescence filmed in the twilight zone with a low-light camera. Each flash is luciferin reacting with luciferase inside a photophore.") });
}

module.exports = { related, videos };
if (require.main === module) console.log("demo site written to", out);

// Short looping videos for the Mosaic screenshot, made from the illustrations
// (needs ffmpeg). They are not kept in git.
if (require.main === module) {
  const { execFileSync } = require("child_process");
  fs.mkdirSync(path.join(out, "video"), { recursive: true });
  for (const [, , name] of videos) {
    const dest = path.join(out, "video", name + ".webm");
    if (fs.existsSync(dest)) continue;
    execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-loop", "1", "-i", path.join(out, "img", name + ".jpg"),
      "-vf", "scale=1920:1080,zoompan=z='min(zoom+0.0012,1.25)':x='iw/2-(iw/zoom/2)+sin(on/25)*20':y='ih/2-(ih/zoom/2)':d=180:s=640x360:fps=30",
      "-t", "6", "-c:v", "libvpx", "-b:v", "700k", "-an", dest]);
  }
}
