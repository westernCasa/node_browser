# noderesearch.app

The website for NODE Research Browser, served by Vercel from this folder (project `node-research`, root directory `site`). Plain HTML, no build step.

- `index.html`: the page. Download links point to the release named in it; update the version (`0.9.8`) and file sizes on each release.
- `og.png`: the share image (1200 × 630). `docs/media/social-preview.png` is the GitHub version (1280 × 640).
- `fonts/`: Barlow and JetBrains Mono from `renderer/fonts`, under the SIL Open Font License.
- `sitemap.xml`, `robots.txt`, `vercel.json`: search and hosting settings.

This folder is not part of the app: `package.json` → `build.files` lists what ships.
