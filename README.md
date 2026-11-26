# Yashsingh Chauhan, portfolio

AI engineer. LLM agents, retrieval, fine-tuning and the backends that carry them. Live at [portfoliio-jet.vercel.app](https://portfoliio-jet.vercel.app).

## What the site is

One long page with a single figure behind it. The figure is a field of more than 10,000 points drawn on a 2D canvas with its own perspective projection, so it reads as 3D without WebGL. Each project is a cluster whose shape follows what the project does: a graph, a tree, a drift from tight to diffuse, a chain, a waveform ring. Scrolling flies the camera between clusters. Pointing at a project row, or opening it, flies the camera to that project's cluster.

## How it is built

Plain HTML, CSS and JavaScript. No framework, no bundler, no build step.

| File | Role |
| --- | --- |
| `index.html` | The page and all copy |
| `css/site.css` | Tokens, fonts, nav, shared components |
| `css/home.css` | Home page layout and type |
| `css/docs.css` | Layout for the per-project docs in `docs/` |
| `js/scene.js` | The figure: projection, camera, depth of field, batching |
| `js/main.js` | Boot, scroll and pointer wiring, project rows, captions |
| `fonts/` | Bricolage Grotesque and Newsreader, self-hosted variable fonts |

### Rendering notes

- The scene runs in a Web Worker on an `OffscreenCanvas`, so scrolling and text never wait on the canvas. Browsers without it fall back to the same code on the main thread.
- Motion is time-based and uses critically damped springs, so it looks the same at 60, 120 or 240 Hz. The refresh rate is measured at startup.
- Points are sorted into depth buckets and drawn in batched paths. The canvas renders at no more than 1.5x pixel ratio and about 2.2 million pixels, since the figure is soft dots.
- A governor only ever steps down: first resolution, then point count. On a 100 Hz or faster screen that can't keep up it renders every second refresh, so frames stay even instead of alternating long and short.
- Hover focus on project rows waits until scrolling stops, so the camera isn't sent to a different cluster mid-scroll.
- With reduced motion on, the scene draws on demand and does not drift.
- The canvas can only run as fast as the display refreshes. On a 120 Hz screen it targets 120 fps.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Docs

Longer write-ups for each project live in `docs/`.
