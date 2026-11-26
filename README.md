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
| `js/portrait.js` | The halftone portrait in the introduction |
| `fonts/` | Bricolage Grotesque and Newsreader, self-hosted variable fonts |

### Rendering notes

- The scene runs in a Web Worker on an `OffscreenCanvas`, so scrolling and text never wait on the canvas. Browsers without it fall back to the same code on the main thread.
- Motion is time-based and uses critically damped springs, so it looks the same at 60, 120 or 240 Hz. The refresh rate is measured at startup.
- Points are sorted into depth buckets and drawn in batched paths. The canvas renders at no more than 1.5x pixel ratio and about 2.2 million pixels, since the figure is soft dots.
- A governor only ever steps down: first resolution, then point count. On a 100 Hz or faster screen that can't keep up it renders every second refresh, so frames stay even instead of alternating long and short.
- The projects are one continuous flow: nothing is pinned, nothing swaps, and there are no cards. Each project's text is ordinary page content, and `main.js` writes two variables on it as the page scrolls: `--p` (how far its text is from a resting line at 60% of the screen height, in screen heights) and `--h` (fills the rule). Everything that moves in a project is a function of `--p`: each title arrives and leaves in its own way (`data-fx`) and drifts sideways with the scroll, and the rest of the text fades only near the screen edges, so stopping anywhere leaves readable text. The camera marks sent to the figure come from the same geometry (a short rest centred on each project's resting line), so the camera and the text are always on the same beat.
- Between projects, each shape's looseness follows how far the camera is from its station (whole for a moment either side of the resting line, loosest half-way), and the points keep surging and swirling about their outlines on a clock, so stopping mid-way still shows motion. A case that is open stays open while its project is on screen and closes once it has left.
- The portrait is a halftone of `assets/portrait.jpg`, a cut-out on a paper-white background so there is no frame. The dots drift, lean toward the cursor by depth and part around it, and 150 free particles orbit the figure. With reduced motion it is drawn once and stays still. To change the photo, replace the file; for a dark photo with no cut-out, set `data-tone="light"` on the figure only if the picture is better as light dots.
- The skills section is a two-way map. Each skill button carries `data-used` (project numbers, in page order) and shows how many projects it shipped in; a project's stack line is read from its case text. Hover or focus previews, click or tap keeps a selection, Escape clears it. Edit `data-used` in `index.html` when a project's stack changes.
- Scatter is driven by scroll speed. Every point has a direction and distance to fly to; a spring rises quickly with scroll speed and settles more slowly, so a shape the camera is parked on is exact. Shapes also turn about their own vertical axis to face the camera, so none is seen edge-on.
- Shapes are authored in `js/scene.js` (`SHAPES`) with a small drawing kit: outlines are sampled at an even spacing and carry edges, interior dots are loose. Outline points are never thinned by the governor.
- Around each station the camera swings a little (a slow orbit and a small push-in). Opening a case scrolls it into view and moves the camera in closer on that cluster.
- Hover focus on skill groups waits until scrolling stops, so the camera isn't sent to a different cluster mid-scroll.
- With reduced motion on, the scene draws on demand, does not scatter, titles and text do not move and the portrait is drawn once.
- The canvas can only run as fast as the display refreshes. On a 120 Hz screen it targets 120 fps.

## The portrait

The introduction draws a halftone portrait: a hex lattice of dots whose size follows the tone of a picture. It shows a monogram until a photo is supplied. To use a photo, add it as `assets/portrait.jpg` (a head and shoulders shot with a plain background works best, about 800 x 1000) and set `data-src="assets/portrait.jpg"` on `<figure id="portrait">` in `index.html`. If the file is missing or fails to load, the monogram is drawn instead.

## Run it locally

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Docs

Longer write-ups for each project live in `docs/`.
