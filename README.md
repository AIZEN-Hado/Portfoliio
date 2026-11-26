# Yashsingh Chauhan, portfolio

AI engineer. LLM agents, retrieval, fine-tuning and the backends that carry them. Live at [portfoliio-jet.vercel.app](https://portfoliio-jet.vercel.app).

## What the site is

One long page with a single figure behind it. The figure is about 8,000 points drawn on a 2D canvas with its own perspective projection, so it reads as 3D without WebGL. Each project is drawn as a defined object, outlined by evenly spaced points and joined by hairlines: a policy document, a commit graph, chained blocks, chat bubbles, a graduation cap, phones in a mesh, headphones, a fish and hook, a form, a load balancer. The four skills are a network, a database, a browser and a cloud. Scrolling is free and never snaps. The camera flies between the shapes as you scroll; a shape is whole only while the camera is parked on it, and between two sections the points stay loose and keep moving, drawing in toward the next outline as you arrive. Opening a project flies the camera in on its shape.

## How it is built

Plain HTML, CSS and JavaScript. No framework, no bundler, no build step.

| File | Role |
| --- | --- |
| `index.html` | The page and all copy |
| `css/site.css` | Tokens, fonts, nav, shared components |
| `css/home.css` | Home page layout and type |
| `css/docs.css` | Layout for the per-project docs in `docs/` |
| `js/scene.js` | The figure: projection, camera, depth of field, batching |
| `js/main.js` | Boot, scroll and pointer wiring, project scenes and rail, line-mask reveals, captions |
| `fonts/` | Bricolage Grotesque and Newsreader, self-hosted variable fonts |

### Rendering notes

- The scene runs in a Web Worker on an `OffscreenCanvas`, so scrolling and text never wait on the canvas. Browsers without it fall back to the same code on the main thread.
- Motion is time-based and uses critically damped springs, so it looks the same at 60, 120 or 240 Hz. The refresh rate is measured at startup.
- Points are sorted into depth buckets and drawn in batched paths. The canvas renders at no more than 1.5x pixel ratio and about 2.2 million pixels, since the figure is soft dots.
- A governor only ever steps down: first resolution, then point count. On a 100 Hz or faster screen that can't keep up it renders every second refresh, so frames stay even instead of alternating long and short.
- The camera and the text share one set of measurements. Each project is a pinned scene, and the camera is parked on its cluster for exactly the scroll range where the scene is held, then flies to the next one while the old title leaves and the new one rises. `main.js` writes three variables on each scene (`--e` entering, `--h` held, `--x` leaving) and sends the same ranges to the figure as camera marks, so the two cannot drift apart.
- Between sections, each shape's looseness follows how far the camera is from its station (zero when parked, highest half-way), and the points keep surging and swirling about their outlines on a clock, so a stop mid-way still shows motion. Scene text swaps on a clock too (pinned scenes overlap and swap in place), so any resting place shows exactly one readable scene and the page is never moved for you.
- The skills section is a two-way map. Each skill button carries `data-used` (project numbers, in page order) and shows how many projects it shipped in; a project's stack line is read from its case text. Hover or focus previews, click or tap keeps a selection, Escape clears it. Edit `data-used` in `index.html` when a project's stack changes.
- The scroll should feel tied to the page, not elastic: the camera springs are stiff (about 0.2 s to catch up with the scroll position), points are never stretched into streaks while the camera moves, scene text swaps in about half a second, and `overscroll-behavior-y: none` removes the browser's rubber-band at the page ends.
- Scatter is driven by scroll speed. Every point has a direction and distance to fly to; a spring rises quickly with scroll speed and settles more slowly, so a shape the camera is parked on is exact. Shapes also turn about their own vertical axis to face the camera, so none is seen edge-on.
- Shapes are authored in `js/scene.js` (`SHAPES`) with a small drawing kit: outlines are sampled at an even spacing and carry edges, interior dots are loose. Outline points are never thinned by the governor.
- While parked the camera keeps moving a little (a slow orbit and a small push-in) so a held scene is never dead still. Opening a case moves the camera in closer on that cluster.
- Hover focus on skill groups waits until scrolling stops, so the camera isn't sent to a different cluster mid-scroll.
- With reduced motion on, the scene draws on demand, does not scatter, scenes are not pinned, titles do not move.
- The canvas can only run as fast as the display refreshes. On a 120 Hz screen it targets 120 fps.

## The portrait

The introduction shows a plain photograph, `assets/portrait.webp` (4:5, head and shoulders), which stays in view beside the text on wide screens. To change it, replace the file with another 4:5 image (about 1000 x 1250).

## Run it locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Docs

Longer write-ups for each project live in `docs/`.
