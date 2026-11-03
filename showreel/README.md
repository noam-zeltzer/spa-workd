# INBETWEEN — Motion Reel 2026

A 15-second, 16:9, 60 fps motion design showreel. The concept is a glossary: every
chapter is a term from the motion designer's vocabulary, and each one *performs* the
thing it names. The studio name is the last term — the in-between frames are where
motion lives.

| # | Time | Term | What happens |
|---|------|------|--------------|
| 01 | 0.00 | KEYFRAME | A timeline draws out of a single dot, a 3D gem lands on frame 30, the playhead hits it and the camera dives through its silhouette. |
| 02 | 1.00 | EASE | The real value graph of `cubic-bezier(.83, 0, .17, 1)` draws itself while EASE slides in on that exact curve, onion skins showing the spacing. |
| 03 | 2.00 | STAGGER | A whip pan into full-bleed type: five rows of card-flips cascading in a diagonal wave, flipping again to their coloured backs. |
| 04 | 3.00 | SQUASH & STRETCH | The rows collapse into a floor line; a glossy ball drops, and the type squashes on every impact and stretches on every climb. |
| 05 | 4.00 | EXTRUDE | The ball hits the lens. Flat type gains depth on screen while the camera dolly-zooms around it under a moving light. |
| 06 | 5.75 | CLONER | The camera cranes overhead, the floor turns into 1,664 instanced cubes, a sine effector ripples out and the word rises from the field. |
| 07 | 8.00 | PARALLAX | Six depth planes of type and geometry, labelled by Z, until the camera flies into a foreground disc. |
| 08 | 9.00 | MORPH | A Bauhaus tile grid rotating and morphing on the beat; the word swaps typefaces letter by letter. Tiles flip to black. |
| 09 | 10.00 | LOOP | An endless, accelerating tunnel of frames, strobing on the off-beats. |
| 10 | 11.50 | TIMING | Eight cuts that accelerate into the drop: timing, spacing, weight, rhythm, tension, contrast, intent, craft. |
| 11 | 12.50 | INBETWEEN | Two keyframe gems slam in, the word tweens out of one of them, a playhead sweeps it, and everything resolves to a dot. |

## Files

- `index.html` — the whole piece: one deterministic `renderFrame(t)` drawn with Canvas 2D and three.js, plus a small player. Opens in any browser and plays in real time.
- `soundtrack.mp3` — the score, synthesised in `tools/soundtrack.py` (NumPy only), every cue placed on the picture's timeline.
- `tools/render.cjs` — offline renderer: headless Chromium (Playwright) → PNG frames → ffmpeg.
- `tools/build-font.mjs` — turns the Archivo Expanded Black TTF into the subset typeface JSON embedded in the page for the extruded 3D type.

## Render a video file (optional)

The page plays live, so no video file is kept in the repository. To export one:

```sh
npm i --prefix /tmp/deps three@0.170.0
node tools/render.cjs --three /tmp/deps/node_modules/three --out video.mp4     # ~20 min on 4 CPU cores
python3 tools/soundtrack.py soundtrack.wav
ffmpeg -i video.mp4 -i soundtrack.wav -c:v copy -c:a aac -b:a 256k -shortest showreel.mp4
```

Design system: ink `#100E1F`, ultramarine `#3D35FF`, lilac `#B9B3FF`, apricot `#FF9A62`, bone `#F3EEE6`.
Type: Archivo (variable width and weight), Instrument Serif Italic, Martian Mono.
