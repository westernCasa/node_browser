# README screenshots

The images in `docs/media` are real NODE captures of a fictional site, "Abyssal Notes", served locally. Search results are pointed at that site, so nothing comes from the web. To rebuild them (Linux, with Xvfb, ImageMagick, ffmpeg and Playwright):

```bash
node docs/media/src/make-art.js     # illustrations: art.html -> site/img/*.jpg
node docs/media/src/make-site.js    # demo pages and short videos
node docs/media/src/make-shots.js   # runs NODE and captures raw/*.png
node docs/media/src/make-frames.js  # frames them with frame.html -> docs/media/*.png
node docs/media/src/make-case-study.js ~/node-case-study  # case-study stills (2x), GIFs and MP4s of each interaction
```
