# Portfolio

An interactive constellation portfolio built with HTML, CSS, JavaScript, and WebGL.

Site: https://armon-jpg.github.io/portfolio/

## GitHub Pages

This site needs no package installation, build command, or server-side code.
`index.html` is the entry point. `.nojekyll` tells GitHub Pages to publish the static files directly.

In this repository's **Settings → Pages**, use:

- **Source:** Deploy from a branch
- **Branch:** `main`
- **Folder:** `/ (root)`

Pushing changes to `main` updates the site automatically.

## Local preview

Open `index.html` in a modern browser with WebGL support, or run:

```sh
python -m http.server 5173
```

Then open http://localhost:5173.

## Content

Edit the `NODES` array near the beginning of the script in `index.html` to update
the Jobs, Projects, Expertise, Timeline, and Education sections. The original
placeholder descriptions are retained until portfolio content is ready.

The constellation is generated randomly on each visit, as in the original design.
Drag to rotate, select a title to open its detail panel, and press Escape or the
close button to dismiss it. Releasing a drag carries its momentum into a smooth
landing on a title, with no separate snap after the ball stops.

The sphere and titles scale together to fit the available viewport. Layout
calculations reserve room for perspective, the longest title, device safe areas,
and an open detail panel. Portrait screens use a bottom sheet; wide or landscape
screens use a side panel. Dynamic viewport height follows mobile browser chrome.
The browser's reduced-motion preference is respected. Fonts are loaded from Google Fonts.

## Regression checks

With Node.js installed, run:

```sh
node --test tests/portfolio.test.cjs
```

These checks exercise the actual page script: release and arrival velocity,
forward-only rotation, input delays, interrupted gestures, 30/60/120 Hz animation,
reduced motion, and 15 viewport dimensions with the detail panel open and closed.
Visual checks in a browser complement the simulated geometry checks.

Local design experiments in `versions/` are excluded from this repository.
