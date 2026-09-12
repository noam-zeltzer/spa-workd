# spa workd

A quiet to-do list for a phone. Add something, tap the circle when it's done,
swipe it away when it isn't worth keeping.

**Live: https://noam-zeltzer.github.io/spa-workd/**

No framework, no build step, no dependencies — `index.html`, `styles.css`,
`app.js` and a service worker. It installs to a home screen and runs offline.

## What it does

- **Today / Upcoming / All / Done**, with live counts on each.
- **Due dates.** Type `tomorrow`, `today`, `next week` or a weekday name while
  adding a task and the date is set for you — the word is taken out of the title.
  There are quick-pick chips and a date picker above the input as well.
- **Lists.** Tap `+` to add one. Press and hold a list to rename or delete it.
- **Buckets.** Open tasks group themselves into Overdue, Today, Tomorrow,
  This week, Later and Someday.
- **Swipe left to delete**, with an Undo that lasts five seconds.
- Tasks are kept on the device. In the hosted Artifact version they also sync to
  your Claude account, so they follow you between devices.

## Install it on your phone

**iPhone / iPad** — open the page in Safari, tap Share, then
*Add to Home Screen*. It launches full-screen with no browser chrome.

**Android** — open it in Chrome, tap the ⋮ menu, then *Install app* or
*Add to Home screen*.

## Run it locally

Any static file server will do — a service worker needs `https://` or
`localhost`, not `file://`:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

`.github/workflows/pages.yml` publishes the repository root on every push to
the development branch. It needs Pages switched on once, by hand:

**Settings → Pages → Build and deployment → Source: GitHub Actions.**

After that the app is served at `https://<owner>.github.io/spa-workd/`.

## Layout

```
index.html                 the shell
artifact.html              the same app, as a claude.ai Artifact page
styles.css                 design tokens, layout, animation
app.js                     state, storage, rendering, gestures
sw.js                      offline cache
manifest.webmanifest       name, icons, standalone launch
icons/logo-source.png      the supplied logo, untouched
icons/logo.png             the full lockup, paper keyed out
icons/sofa.png             the sofa alone — the mark and the icon source
icons/wordmark.png         the lettering alone — the masthead wordmark
icons/icon-*.png           app icons, rendered from sofa.png
```

## Branding

Everything visible comes from the supplied logo rather than an approximation.
`icons/logo-source.png` is the original; the sofa and the lettering are cut out
of it with the paper keyed off on luminance and the antialiased edges
un-premultiplied, so both sit cleanly on any background. The app icons are the
sofa centred on a paper tile.

The palette is sampled from the same file: teal `#4B918F` (the sofa outline and
"spa"), slate `#566E78` (“workd”, deepened to `#2F3E46` for body text), wood
`#A78562` (the legs) and paper `#FBFBF9`. Overdue and delete use a terracotta
drawn from the wood family.

To ship a change to an installed copy, bump `CACHE` in `sw.js` so the old
shell is thrown away.
