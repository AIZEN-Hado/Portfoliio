/* ============================================================================
   scene.js — "the figure"

   More than 10,000 points in a 3D latent space, drawn on a plain 2D canvas with our
   own perspective projection (no WebGL). Each cluster is one body of work; its
   shape hints at what the project does. Scrolling flies the camera from cluster
   to cluster, the cursor acts as a retrieval query (its nearest points light up),
   and the contact section flips the figure from ink-on-paper to paper-on-cobalt.

   Runs in a Worker on an OffscreenCanvas when the browser allows it, so page
   work never steals frames from the canvas. Otherwise the same code runs on the
   main thread (see main.js). Frame timing is delta-time based, so motion looks
   identical at 60, 120 or 240 Hz. A small governor trims point count and pixel
   ratio if frames start to miss the detected refresh rate.
   ========================================================================== */
(function (root) {
  'use strict';

  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function easeOut(t) { t = clamp(t, 0, 1); return 1 - Math.pow(1 - t, 3); }

  /* ---- palette (kept in step with css/site.css) ---- */
  var INK = [16, 19, 38];
  var COBALT = [44, 62, 245];
  var PAPER = [233, 235, 240];
  var WHITE = [255, 255, 255];
  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }
  function rgb(c) { return 'rgb(' + (c[0] | 0) + ',' + (c[1] | 0) + ',' + (c[2] | 0) + ')'; }

  /* ---- deterministic randomness, so the figure is the same on every visit ---- */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(R) {
    var u = 0;
    while (u === 0) u = R();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * R());
  }

  /* ==========================================================================
     World
     ========================================================================== */
  var CLUSTERS = [
    { name: 'PolicyPilot AI', shape: 'graph', n: 760 },
    { name: 'SemiGit', shape: 'tree', n: 700 },
    { name: 'ProvChain', shape: 'drift', n: 700 },
    { name: 'InterviewIQ', shape: 'stacks', n: 640 },
    { name: 'ClasslyAI', shape: 'trio', n: 720 },
    { name: 'Offline UPI Mesh', shape: 'chain', n: 640 },
    { name: 'All-Ears', shape: 'ring', n: 700 },
    { name: 'Fisherman', shape: 'pairs', n: 640 },
    { name: 'LazyForm', shape: 'grid', n: 620 },
    { name: 'Dispatch Load Balancer', shape: 'routes', n: 640 },
    { name: 'AI and ML systems', shape: 'shell', n: 520, sx: 1.0, sy: 1.0, sz: 1.0 },
    { name: 'Backend and APIs', shape: 'shell', n: 460, sx: 1.5, sy: 0.7, sz: 1.0 },
    { name: 'Frontend', shape: 'shell', n: 380, sx: 0.8, sy: 1.3, sz: 0.8 },
    { name: 'Cloud and tools', shape: 'shell', n: 420, sx: 1.3, sy: 0.9, sz: 1.2 }
  ];
  var HAZE = 2200;
  var NPROJ = 10;

  // Cluster centres: projects wind down a helix, skills sit in a ring below it.
  var SKY = -63.5;   // height of the skills ring
  (function placeClusters() {
    for (var i = 0; i < NPROJ; i++) {
      var a = i * 0.92 + 0.4;
      CLUSTERS[i].c = [17 * Math.cos(a), 20 - i * 6.5, 17 * Math.sin(a)];
      CLUSTERS[i].out = [Math.cos(a), 0, Math.sin(a)];
    }
    for (var k = 0; k < 4; k++) {
      var b = k * TAU / 4 + 0.6;
      CLUSTERS[NPROJ + k].c = [12 * Math.cos(b), SKY + Math.sin(k * 2.1) * 2.5, 12 * Math.sin(b)];
      CLUSTERS[NPROJ + k].out = [Math.cos(b), 0, Math.sin(b)];
    }
  })();

  // Camera stations: hero, ten projects, about, skills (two), contact.
  var STATIONS = (function () {
    var s = [{ p: [8, 44, 62], t: [0, -3, 0] }];
    for (var i = 0; i < NPROJ; i++) {
      var c = CLUSTERS[i];
      s.push({
        p: [c.c[0] + c.out[0] * 30, c.c[1] + 3, c.c[2] + c.out[2] * 30],
        t: [c.c[0], c.c[1], c.c[2]]
      });
    }
    s.push({ p: [-52, -3, 46], t: [0, -9, 0] });       // about: the whole helix from the side
    s.push({ p: [6, SKY + 6, 52], t: [0, SKY, 0] });   // skills, approaching the ring
    s.push({ p: [-7, SKY + 2, 40], t: [0, SKY, 0] });  // skills, at the ring
    s.push({ p: [38, 16, 84], t: [0, -14, 0] });       // contact: pull back
    return s;
  })();

  function buildWorld() {
    var R = rng(20260611);
    var P = [];        // [x, y, z, cluster]
    var E = [];        // structural edges as [a, b] in generation order
    var meta = [];

    function rotator() {
      var ay = R() * TAU, ax = (R() - 0.5) * 1.2;
      var cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
      return function (p) {
        var x = p[0] * cy + p[2] * sy, z = -p[0] * sy + p[2] * cy, y = p[1];
        var y2 = y * cx - z * sx, z2 = y * sx + z * cx;
        return [x, y2, z2];
      };
    }

    function shape(kind, n, def, out, edges) {
      var i;
      if (kind === 'graph') {
        var hubs = [];
        for (i = 0; i < 16; i++) hubs.push([gauss(R) * 3.4, gauss(R) * 2.8, gauss(R) * 3.4]);
        for (i = 0; i < n; i++) {
          if (R() < 0.62) {
            var h = hubs[(R() * 16) | 0];
            out.push([h[0] + gauss(R) * 0.9, h[1] + gauss(R) * 0.9, h[2] + gauss(R) * 0.9]);
          } else out.push([gauss(R) * 3.6, gauss(R) * 3.0, gauss(R) * 3.6]);
        }
      } else if (kind === 'tree') {
        var queue = [{ p: [0, -4.5, 0], d: [0, 1, 0], len: 3.4, depth: 0 }];
        var made = 0;
        while (queue.length && made < n) {
          var s = queue.shift();
          var m = Math.max(6, Math.round(s.len * 9)), prev = -1;
          for (var k = 0; k < m && made < n; k++) {
            var t = k / m;
            var idx = out.length;
            out.push([
              s.p[0] + s.d[0] * s.len * t + gauss(R) * 0.09,
              s.p[1] + s.d[1] * s.len * t + gauss(R) * 0.09,
              s.p[2] + s.d[2] * s.len * t + gauss(R) * 0.09
            ]);
            if (prev >= 0) edges.push([prev, idx]);
            prev = idx; made++;
          }
          if (s.depth < 5) {
            var end = [s.p[0] + s.d[0] * s.len, s.p[1] + s.d[1] * s.len, s.p[2] + s.d[2] * s.len];
            var kids = s.depth < 2 ? 3 : 2;
            for (var q = 0; q < kids; q++) {
              var d = [s.d[0] + gauss(R) * 0.75, s.d[1] + 0.25 + Math.abs(gauss(R)) * 0.3, s.d[2] + gauss(R) * 0.75];
              var L = Math.hypot(d[0], d[1], d[2]) || 1;
              queue.push({ p: end, d: [d[0] / L, d[1] / L, d[2] / L], len: s.len * 0.72, depth: s.depth + 1 });
            }
          }
        }
        while (made < n) { out.push([gauss(R) * 3, gauss(R) * 3 + 1, gauss(R) * 3]); made++; }
      } else if (kind === 'drift') {
        for (i = 0; i < n; i++) {
          var tt = Math.pow(R(), 1.2), sg = lerp(0.35, 2.4, tt);
          out.push([-6 + 12 * tt + gauss(R) * 0.3, gauss(R) * sg, gauss(R) * sg]);
        }
      } else if (kind === 'stacks') {
        var lens = [11, 8, 9.5], ys = [-2.6, 0, 2.6];
        for (i = 0; i < n; i++) {
          var b = (R() * 3) | 0;
          out.push([-lens[b] / 2 + lens[b] * R(), ys[b] + gauss(R) * 0.28, gauss(R) * 0.7]);
        }
      } else if (kind === 'trio') {
        for (i = 0; i < n; i++) {
          var v = (R() * 3) | 0, an = v * TAU / 3 + 0.5;
          out.push([Math.cos(an) * 3.2 + gauss(R) * 1.7, Math.sin(an) * 3.2 + gauss(R) * 1.7, gauss(R) * 1.7]);
        }
      } else if (kind === 'chain') {
        var nodes = [], nodeIdx = [];
        for (i = 0; i < 5; i++) nodes.push([-8 + 4 * i, Math.sin(i * 1.3) * 3, Math.cos(i * 0.9) * 2]);
        for (i = 0; i < n; i++) {
          var r0 = R();
          if (r0 < 0.7) {
            var nd = nodes[(R() * 5) | 0];
            out.push([nd[0] + gauss(R) * 0.9, nd[1] + gauss(R) * 0.9, nd[2] + gauss(R) * 0.9]);
          } else {
            var sgm = (R() * 4) | 0, tq = R();
            var A = nodes[sgm], B = nodes[sgm + 1];
            out.push([lerp(A[0], B[0], tq) + gauss(R) * 0.15, lerp(A[1], B[1], tq) + gauss(R) * 0.15, lerp(A[2], B[2], tq) + gauss(R) * 0.15]);
          }
        }
        for (i = 0; i < 5; i++) {
          nodeIdx.push(out.length);
          out.push([nodes[i][0], nodes[i][1], nodes[i][2]]);
        }
        for (i = 0; i < 4; i++) edges.push([nodeIdx[i], nodeIdx[i + 1]]);
      } else if (kind === 'ring') {
        for (i = 0; i < n; i++) {
          var th = R() * TAU;
          var rr = 5 + 1.6 * Math.sin(7 * th) * (0.6 + 0.4 * Math.sin(3 * th + 1)) + gauss(R) * 0.18;
          out.push([rr * Math.cos(th), rr * Math.sin(th), gauss(R) * 0.35]);
        }
      } else if (kind === 'pairs') {
        // Two strands, baseline and candidate, sampled at the same places. A paired test compares them point by point.
        var A0 = [], B0 = [], np = (n / 2) | 0;
        for (i = 0; i < np; i++) {
          var tp = R(), xp = lerp(-6, 6, tp), yp = 2.4 * Math.sin(tp * 5.2 + 0.4) + gauss(R) * 0.22;
          A0.push([xp, yp, -1.7 + gauss(R) * 0.25]);
          var flip = R() < 0.14 ? 1.1 : 0.12;           // a few points have regressed
          B0.push([xp + gauss(R) * 0.08, yp + gauss(R) * flip, 1.7 + gauss(R) * 0.25]);
        }
        for (i = 0; i < np; i++) { out.push(A0[i]); out.push(B0[i]); }
        for (i = 0; i < 18; i++) {                       // anchor pairs joined by an edge
          var u = i / 17, xa = lerp(-6, 6, u), ya = 2.4 * Math.sin(u * 5.2 + 0.4);
          var ia = out.length;
          out.push([xa, ya, -1.7]); out.push([xa, ya, 1.7]);
          edges.push([ia, ia + 1]);
        }
      } else if (kind === 'grid') {
        // A multi-step form: three pages of fields, filled in a serpentine order, step after step.
        var slots = [], gl, gj, gi;
        for (gl = 0; gl < 3; gl++) for (gj = 0; gj < 3; gj++) for (gi = 0; gi < 4; gi++) {
          var colg = ((gj + gl * 3) % 2) ? 3 - gi : gi;
          slots.push([-4.2 + colg * 2.8, 2.8 - gj * 2.8, (gl - 1) * 3.6]);
        }
        for (i = 0; i < n - slots.length; i++) {
          var sl = slots[(R() * slots.length) | 0];
          out.push([sl[0] + gauss(R) * 0.6, sl[1] + gauss(R) * 0.32, sl[2] + gauss(R) * 0.32]);
        }
        var gBase = out.length;
        for (i = 0; i < slots.length; i++) out.push(slots[i]);
        for (i = 0; i < slots.length - 1; i++) edges.push([gBase + i, gBase + i + 1]);
      } else if (kind === 'routes') {
        // A depot with five vehicles, each driving its own route.
        var depot = out.length;
        out.push([0, 0, 0]);
        var stopsAll = [];
        for (var rt = 0; rt < 5; rt++) {
          var dir = [gauss(R), gauss(R) * 0.5, gauss(R)], dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
          var cur = [0, 0, 0], path = [];
          for (var sp = 0; sp < 6; sp++) {
            var jd = [dir[0] / dl + gauss(R) * 0.45, dir[1] / dl + gauss(R) * 0.35, dir[2] / dl + gauss(R) * 0.45];
            var jl = Math.hypot(jd[0], jd[1], jd[2]) || 1, st = 1.6 + R() * 1.1;
            cur = [cur[0] + jd[0] / jl * st, cur[1] + jd[1] / jl * st, cur[2] + jd[2] / jl * st];
            path.push(cur);
          }
          stopsAll.push(path);
        }
        var perLeg = ((n - 31) / 30) | 0;
        for (var r2 = 0; r2 < 5; r2++) {
          var prevP = [0, 0, 0];
          for (var s3 = 0; s3 < 6; s3++) {
            var nxt = stopsAll[r2][s3];
            for (var q2 = 0; q2 < perLeg; q2++) {
              var tq2 = R();
              out.push([lerp(prevP[0], nxt[0], tq2) + gauss(R) * 0.14, lerp(prevP[1], nxt[1], tq2) + gauss(R) * 0.14, lerp(prevP[2], nxt[2], tq2) + gauss(R) * 0.14]);
            }
            prevP = nxt;
          }
        }
        for (var r3 = 0; r3 < 5; r3++) {
          var last = depot;
          for (var s4 = 0; s4 < 6; s4++) {
            var idxS = out.length; out.push(stopsAll[r3][s4]);
            edges.push([last, idxS]); last = idxS;
          }
        }
      } else { // shell
        for (i = 0; i < n; i++) {
          var dx = gauss(R), dy = gauss(R), dz = gauss(R);
          var Ln = Math.hypot(dx, dy, dz) || 1;
          var rad = 4.2 * (0.55 + 0.45 * Math.cbrt(R()));
          out.push([dx / Ln * rad * def.sx, dy / Ln * rad * def.sy, dz / Ln * rad * def.sz]);
        }
      }
    }

    // Clusters
    CLUSTERS.forEach(function (def, ci) {
      var local = [], ledges = [];
      shape(def.shape, def.n, def, local, ledges);
      var rot = rotator();
      var base = P.length;
      var maxR = 0;
      for (var i = 0; i < local.length; i++) {
        var q = rot(local[i]);
        P.push([q[0] + def.c[0], q[1] + def.c[1], q[2] + def.c[2], ci]);
        maxR = Math.max(maxR, Math.hypot(q[0], q[1], q[2]));
      }
      for (var e = 0; e < ledges.length; e++) E.push([base + ledges[e][0], base + ledges[e][1], ci]);
      meta.push({ base: base, count: local.length, radius: maxR });
    });

    // Haze: sparse points that give the space depth.
    for (var h = 0; h < HAZE; h++) {
      var x, y, z, tries = 0;
      do {
        x = (R() * 2 - 1); y = (R() * 2 - 1); z = (R() * 2 - 1); tries++;
      } while (x * x + y * y + z * z > 1 && tries < 20);
      P.push([x * 48, y * 54 - 12, z * 48, -1]);
    }

    var M = P.length;
    // Shuffle so any prefix of the arrays is a uniform sample (for quality scaling).
    var slot = new Uint32Array(M), i2;
    for (i2 = 0; i2 < M; i2++) slot[i2] = i2;
    for (i2 = M - 1; i2 > 0; i2--) {
      var j = (R() * (i2 + 1)) | 0, tmp = slot[i2]; slot[i2] = slot[j]; slot[j] = tmp;
    }
    var w = {
      M: M,
      hx: new Float32Array(M), hy: new Float32Array(M), hz: new Float32Array(M),
      cl: new Int8Array(M), ph: new Float32Array(M), jit: new Float32Array(M),
      ox: new Float32Array(M), oy: new Float32Array(M), oz: new Float32Array(M),
      delay: new Float32Array(M),
      members: [], edges: [], meta: meta
    };
    for (i2 = 0; i2 < M; i2++) {
      var s2 = slot[i2], p = P[i2];
      w.hx[s2] = p[0]; w.hy[s2] = p[1]; w.hz[s2] = p[2]; w.cl[s2] = p[3];
      w.ph[s2] = R(); w.jit[s2] = 0.75 + R() * 0.7;
      var od = [gauss(R), gauss(R), gauss(R)], oL = Math.hypot(od[0], od[1], od[2]) || 1, oR = 30 + R() * 70;
      w.ox[s2] = od[0] / oL * oR; w.oy[s2] = od[1] / oL * oR; w.oz[s2] = od[2] / oL * oR;
      w.delay[s2] = R() * 0.6;
    }
    for (var c = 0; c < CLUSTERS.length; c++) w.members.push([]);
    for (i2 = 0; i2 < M; i2++) if (w.cl[i2] >= 0) w.members[w.cl[i2]].push(i2);

    // Edges per cluster: structural ones plus each point's two nearest neighbours.
    for (var cc = 0; cc < CLUSTERS.length; cc++) {
      var seen = new Set(), list = [];
      function add(a, b) {
        if (a === b) return;
        var lo = a < b ? a : b, hi = a < b ? b : a, key = lo * M + hi;
        if (seen.has(key)) return;
        seen.add(key); list.push(lo, hi);
      }
      for (var e2 = 0; e2 < E.length; e2++) if (E[e2][2] === cc) add(slot[E[e2][0]], slot[E[e2][1]]);
      var mem = w.members[cc];
      var cap = 520;
      for (var a = 0; a < mem.length && list.length < cap * 2; a++) {
        var ia = mem[a], b1 = -1, b2 = -1, d1 = 1e9, d2 = 1e9;
        for (var b = 0; b < mem.length; b++) {
          if (b === a) continue;
          var ib = mem[b];
          var ddx = w.hx[ia] - w.hx[ib], ddy = w.hy[ia] - w.hy[ib], ddz = w.hz[ia] - w.hz[ib];
          var dd = ddx * ddx + ddy * ddy + ddz * ddz;
          if (dd < d1) { d2 = d1; b2 = b1; d1 = dd; b1 = ib; }
          else if (dd < d2) { d2 = dd; b2 = ib; }
        }
        if (b1 >= 0) add(ia, b1);
        if (b2 >= 0 && (a & 1) === 0) add(ia, b2);
      }
      w.edges.push(new Uint32Array(list));
    }
    return w;
  }

  /* ==========================================================================
     Engine
     ========================================================================== */
  var BUCKETS = 6;
  var B_ALPHA = [0.20, 0.32, 0.52, 0.88, 0.60, 0.30];
  var B_SIZE = [0.85, 0.95, 1.0, 1.0, 1.05, 1.15];
  var STD_HZ = [60, 72, 75, 90, 100, 120, 144, 165, 240];
  var NEIGHBOURS = 14;
  var QUERY_RADIUS = 150;

  function Scene(canvas, opts, post) {
    var self = this;
    var W = opts.w, H = opts.h, dpr = opts.dpr || 1;
    var ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    var world = buildWorld();
    var M = world.M;
    var NC = CLUSTERS.length;

    var reduced = !!opts.reduced;
    var coarse = !!opts.coarse;
    var cores = opts.cores || 4;

    // quality: fraction of points drawn, and pixel ratio multiplier
    var quality = coarse ? 0.55 : (cores >= 8 ? 1 : 0.8);
    var pixelScale = 1;

    // inputs (latest values posted by the page)
    var scrollY = 0, marks = null, edgeDocY = 1e9;
    var pointer = { x: -1, y: -1, on: false, last: 0 };
    var focus = -1;
    var labels = [];

    // springs
    var uS = 0, uV = 0;                 // station parameter
    var yawS = 0, yawV = 0, pitS = 0, pitV = 0;
    var focusW = 0, focusWV = 0, focusIdx = -1;
    var act = new Float32Array(NC), actV = new Float32Array(NC);
    var camSpeed = 0;
    var px = -1, py = -1, pxV = 0, pyV = 0;   // smoothed query position

    // per-frame buffers
    var sx = new Float32Array(M), sy = new Float32Array(M);
    var psx = new Float32Array(M), psy = new Float32Array(M);
    var sr = new Float32Array(M);
    var skey = new Int32Array(M);
    var sorted = new Uint32Array(M);
    var K = (NC + 1) * BUCKETS * 2;
    var counts = new Int32Array(K + 1);
    var streaks = new Uint32Array(M), nStreaks = 0;
    var nearI = new Int32Array(NEIGHBOURS), nearD = new Float32Array(NEIGHBOURS), nNear = 0;

    var maskGrad = null, maskW = 0;
    var started = false, startT = 0, introDur = 2.7;
    var lastT = 0, frames = 0, dtEMA = 1 / 60, periodGuess = 1 / 60, samples = [], slowRun = 0, fastRun = 0;
    var raf = null, queued = false, hasWorkerRaf = typeof root.requestAnimationFrame === 'function';
    var dirty = true;

    // sprites for out-of-focus discs
    var sprites = makeSprites();
    function makeSprites() {
      var out = {};
      [['ink', INK], ['cobalt', COBALT], ['paper', PAPER]].forEach(function (pair) {
        var c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(64, 64) : root.document.createElement('canvas');
        c.width = 64; c.height = 64;
        var g = c.getContext('2d');
        var grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        var col = pair[1];
        grad.addColorStop(0, 'rgba(' + col.join(',') + ',1)');
        grad.addColorStop(0.55, 'rgba(' + col.join(',') + ',0.55)');
        grad.addColorStop(1, 'rgba(' + col.join(',') + ',0)');
        g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
        out[pair[0]] = c;
      });
      return out;
    }

    function applySize() {
      var pr = Math.max(0.5, Math.min(dpr, 2) * pixelScale);
      // keep total pixels sane on very large displays
      var area = W * H * pr * pr, cap = 4.6e6;
      if (area > cap) pr *= Math.sqrt(cap / area);
      canvas.width = Math.max(1, Math.round(W * pr));
      canvas.height = Math.max(1, Math.round(H * pr));
      ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
      dirty = true;
    }
    applySize();

    /* ---- springs: critically damped, independent of frame rate ---- */
    function damp(cur, target, vel, omega, dt) {
      var x = omega * dt;
      var e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      var ch = cur - target;
      var tmp = (vel + omega * ch) * dt;
      return [target + (ch + tmp) * e, (vel - omega * tmp) * e];
    }

    function crom(p0, p1, p2, p3, t) {
      var t2 = t * t, t3 = t2 * t;
      return 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
    }
    function stationAt(u, key) {
      var n = STATIONS.length;
      var i = clamp(Math.floor(u), 0, n - 2), t = clamp(u - i, 0, 1);
      var a = STATIONS[Math.max(0, i - 1)][key], b = STATIONS[i][key], c = STATIONS[i + 1][key], d = STATIONS[Math.min(n - 1, i + 2)][key];
      return [crom(a[0], b[0], c[0], d[0], t), crom(a[1], b[1], c[1], d[1], t), crom(a[2], b[2], c[2], d[2], t)];
    }

    function scrollToU(y) {
      if (!marks || marks.length !== STATIONS.length) return 0;
      var n = marks.length;
      if (y <= marks[0]) return 0;
      if (y >= marks[n - 1]) return n - 1;
      var k = 0;
      while (k < n - 2 && y >= marks[k + 1]) k++;
      var span = marks[k + 1] - marks[k] || 1;
      return k + smooth((y - marks[k]) / span);
    }

    /* ---- the frame ---- */
    var cpuEMA = 0;
    function frame(now) {
      queued = false;
      if (!started) { schedule(); return; }
      var cpu0 = performance.now();
      var t = now / 1000;
      var dt = lastT ? clamp(t - lastT, 0.0005, 0.05) : 1 / 60;
      lastT = t;
      frames++;
      governor(dt);

      var tin = t - startT;
      var intro = reduced ? 1 : clamp(tin / introDur, 0, 1);
      var introE = easeOut(intro);

      // --- camera state ---
      var uTarget = scrollToU(scrollY);
      var s;
      if (reduced) {
        uS = uTarget; uV = 0; yawS = pitS = 0; yawV = pitV = 0;
        focusW = focus >= 0 ? 1 : 0; focusIdx = focus >= 0 ? focus : focusIdx;
      } else {
        s = damp(uS, uTarget, uV, 6.2, dt); uS = s[0]; uV = s[1];
        var yawT = pointer.on ? (pointer.x / W - 0.5) * 0.30 : 0;
        var pitT = pointer.on ? (pointer.y / H - 0.5) * -0.16 : 0;
        s = damp(yawS, yawT, yawV, 3.2, dt); yawS = s[0]; yawV = s[1];
        s = damp(pitS, pitT, pitV, 3.2, dt); pitS = s[0]; pitV = s[1];
        if (focus >= 0) focusIdx = focus;
        s = damp(focusW, focus >= 0 ? 1 : 0, focusWV, 5.0, dt); focusW = s[0]; focusWV = s[1];
      }

      var P = stationAt(uS, 'p'), T = stationAt(uS, 't');
      if (focusIdx >= 0 && focusW > 0.001) {
        var cdef = CLUSTERS[focusIdx];
        var fp = [cdef.c[0] + cdef.out[0] * 26, cdef.c[1] + 2.5, cdef.c[2] + cdef.out[2] * 26];
        var w8 = smooth(focusW);
        P = [lerp(P[0], fp[0], w8), lerp(P[1], fp[1], w8), lerp(P[2], fp[2], w8)];
        T = [lerp(T[0], cdef.c[0], w8), lerp(T[1], cdef.c[1], w8), lerp(T[2], cdef.c[2], w8)];
      }

      // orbit around the target: pointer parallax, slow idle sway, intro swing
      var vx = P[0] - T[0], vy = P[1] - T[1], vz = P[2] - T[2];
      var dist = Math.hypot(vx, vy, vz);
      var horiz = Math.hypot(vx, vz);
      var az = Math.atan2(vz, vx), el = Math.atan2(vy, horiz);
      var idle = reduced ? 0 : Math.sin(t * 0.11) * 0.06 + t * 0.0;
      az += yawS + idle + (1 - introE) * 0.9;
      el = clamp(el + pitS + (1 - introE) * 0.18, -1.2, 1.2);
      dist *= 1 - (1 - introE) * 0.45;
      var ce = Math.cos(el);
      P = [T[0] + dist * ce * Math.cos(az), T[1] + dist * Math.sin(el), T[2] + dist * ce * Math.sin(az)];

      // basis
      var fx = T[0] - P[0], fy = T[1] - P[1], fz = T[2] - P[2];
      var fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      var rx = fz, ry = 0, rz = -fx;                      // forward × up(0,1,0)
      var rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
      var ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

      var wide = W >= 1100;
      var focal = (H * 0.5) / Math.tan(19 * Math.PI / 180) * (W >= 1320 ? 1 : wide ? 0.82 : W > 700 ? 0.9 : 0.8);
      var cx = W * (wide ? 0.79 : W > 700 ? 0.66 : 0.5), cy = H * (W > 700 ? 0.5 : 0.31);
      // points grow a little when the camera is far, so the overview keeps its presence
      var rw = (wide ? 0.055 : 0.05) * (1 + 0.95 * smooth((dist - 32) / 36));
      var edgeY = edgeDocY - scrollY;
      var edgeOn = edgeY < H + 40;

      // camera speed (for streaks)
      var spd = Math.abs(uV) * 0.8 + Math.abs(yawV) * 4;
      camSpeed += (spd - camSpeed) * Math.min(1, dt * 8);
      var streakOn = !reduced && camSpeed > 0.25;
      var streakLen = clamp(camSpeed * 0.035, 0, 0.09);

      // activity per cluster follows where the camera is looking
      var maxAct = 0, nearest = -1, nearestD = 8;
      for (var c = 0; c < NC; c++) {
        var cd0 = CLUSTERS[c];
        var d0 = Math.hypot(T[0] - cd0.c[0], T[1] - cd0.c[1], T[2] - cd0.c[2]);
        if (d0 < nearestD) { nearestD = d0; nearest = c; }
      }
      for (c = 0; c < NC; c++) {
        var near = c === nearest ? 1 : 0;
        if (focus >= 0 && focusW > 0.5) near = (c === focus) ? 1 : 0;
        if (reduced) { act[c] = near; }
        else { s = damp(act[c], near, actV[c], 7, dt); act[c] = clamp(s[0], 0, 1); actV[c] = s[1]; }
        if (act[c] > maxAct) maxAct = act[c];
      }

      // query position, smoothed
      var qOn = pointer.on || (coarse && !reduced);
      var qx = pointer.x, qy = pointer.y;
      if (coarse && !pointer.on && !reduced) {      // touch: a slow autonomous probe
        qx = W * 0.5 + Math.sin(t * 0.7) * W * 0.28;
        qy = H * 0.34 + Math.cos(t * 0.5) * H * 0.12;
      }
      if (qOn) {
        if (px < 0) { px = qx; py = qy; }
        else if (reduced) { px = qx; py = qy; }
        else { s = damp(px, qx, pxV, 22, dt); px = s[0]; pxV = s[1]; s = damp(py, qy, pyV, 22, dt); py = s[0]; pyV = s[1]; }
      }

      // --- project ---
      var Nq = Math.max(400, (M * quality) | 0);
      Nq = Math.min(Nq, M);
      counts.fill(0);
      nStreaks = 0; nNear = 0;
      var worst = QUERY_RADIUS * QUERY_RADIUS;
      var hx = world.hx, hy = world.hy, hz = world.hz, cl = world.cl, ph = world.ph, jit = world.jit;
      var ox = world.ox, oy = world.oy, oz = world.oz, dl = world.delay;
      var dF = dist;
      var driftOn = !reduced;
      var ts = t * 0.4;
      var NEAR = 0.8;
      var introOn = intro < 1;
      var i, p0, p1, p2, zz, k2, bk, sc, rad, key, side, kk;

      for (i = 0; i < Nq; i++) {
        p0 = hx[i]; p1 = hy[i]; p2 = hz[i];
        if (driftOn) {
          var a = ts + ph[i] * TAU;
          var sa = Math.sin(a), ca = Math.cos(a);
          p0 += sa * 0.22; p1 += ca * 0.22; p2 += sa * ca * 0.18;
        }
        if (introOn) {
          var k = easeOut((tin - dl[i] * introDur * 0.6) / (introDur * 0.55));
          var inv = 1 - k;
          p0 += ox[i] * inv; p1 += oy[i] * inv; p2 += oz[i] * inv;
        }
        var ddx = p0 - P[0], ddy = p1 - P[1], ddz = p2 - P[2];
        zz = ddx * fx + ddy * fy + ddz * fz;
        if (zz < NEAR) { sx[i] = -9999; skey[i] = -1; continue; }
        sc = focal / zz;
        var X = cx + (ddx * rx + ddy * ry + ddz * rz) * sc;
        var Y = cy - (ddx * ux + ddy * uy + ddz * uz) * sc;
        sx[i] = X; sy[i] = Y;
        if (X < -40 || X > W + 40 || Y < -40 || Y > H + 40) { skey[i] = -1; continue; }

        var ratio = zz / dF;
        bk = ratio < 0.55 ? 5 : ratio < 0.8 ? 4 : ratio < 1.1 ? 3 : ratio < 1.6 ? 2 : ratio < 2.6 ? 1 : 0;
        rad = rw * sc * jit[i] * B_SIZE[bk];
        sr[i] = rad < 0.4 ? 0.4 : rad > 7 ? 7 : rad;
        side = edgeOn && Y > edgeY ? 1 : 0;
        key = ((cl[i] + 1) * BUCKETS + bk) * 2 + side;
        skey[i] = key; counts[key + 1]++;

        if (streakOn && bk >= 3 && (i & 3) === 0) streaks[nStreaks++] = i;

        if (qOn && bk >= 1) {
          var qdx = X - px, qdy = Y - py, qd = qdx * qdx + qdy * qdy;
          if (qd < worst) {
            // insert into the small sorted list of nearest points
            var pos = nNear < NEIGHBOURS ? nNear++ : NEIGHBOURS - 1;
            while (pos > 0 && nearD[pos - 1] > qd) { nearD[pos] = nearD[pos - 1]; nearI[pos] = nearI[pos - 1]; pos--; }
            nearD[pos] = qd; nearI[pos] = i;
            if (nNear === NEIGHBOURS) worst = nearD[NEIGHBOURS - 1];
          }
        }
      }

      // counting sort by (cluster, bucket, side)
      for (kk = 0; kk < K; kk++) counts[kk + 1] += counts[kk];
      // `counts` now holds starting offsets; scatter using a moving cursor
      var cursor = counts.slice(0, K);
      for (i = 0; i < Nq; i++) {
        key = skey[i];
        if (key >= 0) sorted[cursor[key]++] = i;
      }

      // --- draw ---
      ctx.clearRect(0, 0, W, H);

      // streaks while flying
      if (nStreaks > 0 && streakLen > 0.004) {
        var dtInv = 1 / dt;
        ctx.lineWidth = 1;
        for (side = 0; side < 2; side++) {
          ctx.strokeStyle = side ? 'rgba(233,235,240,0.30)' : 'rgba(16,19,38,0.20)';
          ctx.beginPath();
          var any = false;
          for (kk = 0; kk < nStreaks; kk++) {
            i = streaks[kk];
            var sideI = edgeOn && sy[i] > edgeY ? 1 : 0;
            if (sideI !== side) continue;
            var vxs = (sx[i] - psx[i]) * dtInv, vys = (sy[i] - psy[i]) * dtInv;
            if (psx[i] < -9000) continue;
            var mx = vxs * streakLen, my = vys * streakLen;
            var ml = Math.hypot(mx, my);
            if (ml < 1.5) continue;
            if (ml > 46) { mx *= 46 / ml; my *= 46 / ml; }
            ctx.moveTo(sx[i], sy[i]); ctx.lineTo(sx[i] - mx, sy[i] - my); any = true;
          }
          if (any) ctx.stroke();
        }
      }

      // edges of active clusters
      ctx.lineWidth = 0.8;
      for (c = 0; c < NC; c++) {
        if (act[c] < 0.03) continue;
        var edgesC = world.edges[c], eN = edgesC.length;
        ctx.strokeStyle = 'rgba(' + COBALT.join(',') + ',' + (0.42 * act[c]).toFixed(3) + ')';
        ctx.beginPath();
        for (kk = 0; kk < eN; kk += 2) {
          var ea = edgesC[kk], eb = edgesC[kk + 1];
          if (ea >= Nq || eb >= Nq) continue;
          if (sx[ea] < -9000 || sx[eb] < -9000) continue;
          ctx.moveTo(sx[ea], sy[ea]); ctx.lineTo(sx[eb], sy[eb]);
        }
        ctx.stroke();
      }

      // points, one batched path per (cluster, depth bucket, side)
      var dim = 1 - 0.38 * maxAct;
      var aScale = wide ? 1 : 0.7;
      var cursorBase = 0;
      var bokeh = 0;
      for (var cc = -1; cc < NC; cc++) {
        var a2 = cc >= 0 ? act[cc] : 0;
        var colInk = mix(INK, COBALT, a2);
        var colPaper = mix(PAPER, WHITE, a2);
        var cdim = cc >= 0 ? lerp(dim, 1, a2) : dim * 0.62;
        for (bk = 0; bk < BUCKETS; bk++) {
          for (side = 0; side < 2; side++) {
            key = ((cc + 1) * BUCKETS + bk) * 2 + side;
            var from = counts[key], to = key + 1 <= K - 1 ? counts[key + 1] : counts[K];
            if (to <= from) continue;
            // `counts[key]` was turned into start offsets; end is the next key's start
            ctx.globalAlpha = B_ALPHA[bk] * cdim * aScale;
            var col = side ? colPaper : colInk;
            ctx.fillStyle = rgb(col);
            ctx.beginPath();
            for (var q2 = from; q2 < to; q2++) {
              i = sorted[q2];
              var r = sr[i], X2 = sx[i], Y2 = sy[i];
              if (r < 1.0) ctx.rect(X2 - r, Y2 - r, r * 2, r * 2);
              else { ctx.moveTo(X2 + r, Y2); ctx.arc(X2, Y2, r, 0, TAU); }
            }
            ctx.fill();
            if (bk === 5 && bokeh < 240) {
              var sp = side ? sprites.paper : (a2 > 0.5 ? sprites.cobalt : sprites.ink);
              ctx.globalAlpha = 0.07 * cdim;
              for (var q3 = from; q3 < to && bokeh < 240; q3 += 2) {
                i = sorted[q3];
                var br = sr[i] * 4.2;
                if (br < 7) continue;
                ctx.drawImage(sp, sx[i] - br, sy[i] - br, br * 2, br * 2); bokeh++;
              }
            }
          }
        }
      }
      ctx.globalAlpha = 1;
      if (wide) {
        if (!maskGrad || maskW !== W) {
          maskGrad = ctx.createLinearGradient(0, 0, W * 0.72, 0);
          maskGrad.addColorStop(0, 'rgba(0,0,0,0.74)'); maskGrad.addColorStop(0.55, 'rgba(0,0,0,0.5)'); maskGrad.addColorStop(1, 'rgba(0,0,0,0)'); maskW = W;
        }
        ctx.globalCompositeOperation = 'destination-out';
        ctx.fillStyle = maskGrad; ctx.fillRect(0, 0, W * 0.72, H);
        ctx.globalCompositeOperation = 'source-over';
      }

      // retrieval query: ring at the cursor and lines to its nearest points
      if (qOn && px >= 0) {
        var below = edgeOn && py > edgeY;
        var qcol = below ? WHITE : COBALT;
        var qs = qcol.join(',');
        if (nNear > 0) {
          ctx.lineWidth = 1;
          for (kk = 0; kk < nNear; kk++) {
            i = nearI[kk];
            var fall = 1 - Math.sqrt(nearD[kk]) / QUERY_RADIUS;
            ctx.strokeStyle = 'rgba(' + qs + ',' + (0.12 + 0.5 * fall).toFixed(3) + ')';
            ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(sx[i], sy[i]); ctx.stroke();
          }
          ctx.fillStyle = 'rgb(' + qs + ')';
          ctx.beginPath();
          for (kk = 0; kk < nNear; kk++) {
            i = nearI[kk];
            var rr2 = Math.max(sr[i] * 1.5, 2.2);
            ctx.moveTo(sx[i] + rr2, sy[i]); ctx.arc(sx[i], sy[i], rr2, 0, TAU);
          }
          ctx.fill();
        }
        ctx.strokeStyle = 'rgba(' + qs + ',0.75)'; ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(px, py, 15, 0, TAU); ctx.stroke();
        ctx.fillStyle = 'rgb(' + qs + ')';
        ctx.beginPath(); ctx.arc(px, py, 2.2, 0, TAU); ctx.fill();
      }

      // labels for the cluster the camera is looking at
      for (c = 0; c < NC; c++) {
        var lb = labels[c];
        if (!lb || act[c] < 0.04) continue;
        var cd2 = CLUSTERS[c];
        var lx = cd2.c[0] - P[0], ly = cd2.c[1] - P[1], lz = cd2.c[2] - P[2];
        var lzz = lx * fx + ly * fy + lz * fz;
        if (lzz < NEAR) continue;
        var lsc = focal / lzz;
        var LX = cx + (lx * rx + ly * ry + lz * rz) * lsc;
        var LY = cy - (lx * ux + ly * uy + lz * uz) * lsc;
        var rr3 = world.meta[c].radius * lsc * 0.55;
        var ax = LX + rr3 * 0.7, ay = LY - rr3 * 0.7;
        ax = Math.min(ax, W - lb.w - 16); ay = Math.max(ay, lb.h + 76);
        ctx.globalAlpha = act[c];
        ctx.strokeStyle = 'rgba(' + COBALT.join(',') + ',0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(LX, LY); ctx.lineTo(ax, ay); ctx.stroke();
        ctx.fillStyle = 'rgb(' + COBALT.join(',') + ')';
        ctx.beginPath(); ctx.arc(LX, LY, 2.6, 0, TAU); ctx.fill();
        ctx.drawImage(lb.bitmap, ax, ay - lb.h, lb.w, lb.h);
        ctx.globalAlpha = 1;
      }

      // remember positions for next frame's streaks
      var tmpx = psx; psx = sx; sx = tmpx;
      var tmpy = psy; psy = sy; sy = tmpy;
      // keep both buffers marked invalid where unused
      for (i = Nq; i < M; i++) { sx[i] = -9999; psx[i] = -9999; }

      dirty = false;
      cpuEMA += ((performance.now() - cpu0) - cpuEMA) * 0.05;
      if (!reduced) schedule();
      else if (dirty) schedule();
    }

    /* ---- frame pacing and quality governor ---- */
    function governor(dt) {
      if (frames <= 12) return;                  // ignore start-up hitches
      if (samples.length < 48) {
        samples.push(dt);
        if (samples.length === 48) {
          var sorted2 = samples.slice().sort(function (a, b) { return a - b; });
          var med = sorted2[24];
          var hz = 1 / med, best = 60, bd = 1e9;
          for (var j = 0; j < STD_HZ.length; j++) {
            var d = Math.abs(Math.log(hz / STD_HZ[j]));
            if (d < bd) { bd = d; best = STD_HZ[j]; }
          }
          periodGuess = 1 / best;
          if (post) post({ type: 'stats', hz: best });
        }
        return;
      }
      dtEMA += (dt - dtEMA) * 0.08;
      if (dtEMA > periodGuess * 1.35) { slowRun++; fastRun = 0; }
      else if (dtEMA < periodGuess * 1.1) { fastRun++; slowRun = 0; }
      else { slowRun = 0; fastRun = 0; }

      if (slowRun > 30) {
        slowRun = 0;
        if (quality > 0.34) quality = Math.max(0.3, quality * 0.84);
        else if (pixelScale > 0.6) { pixelScale = Math.max(0.55, pixelScale * 0.85); applySize(); }
        dtEMA = periodGuess;
        if (post) post({ type: 'stats', q: quality, px: pixelScale });
      } else if (fastRun > 240) {
        fastRun = 0;
        if (pixelScale < 1) { pixelScale = Math.min(1, pixelScale * 1.1); applySize(); }
        else if (quality < 1) quality = Math.min(1, quality * 1.06);
        if (post) post({ type: 'stats', q: quality, px: pixelScale });
      }
    }

    function schedule() {
      if (queued) return;
      queued = true;
      if (hasWorkerRaf) raf = root.requestAnimationFrame(frame);
      else setTimeout(function () { frame(performance.now()); }, 1000 / 120);
    }

    /* ---- messages from the page ---- */
    this.handle = function (m) {
      switch (m.type) {
        case 'size':
          W = m.w; H = m.h; dpr = m.dpr || dpr; applySize(); if (reduced) { dirty = true; schedule(); } break;
        case 'scroll':
          scrollY = m.y; if (reduced) { dirty = true; schedule(); } break;
        case 'layout':
          marks = m.marks; edgeDocY = m.edge; if (reduced) { dirty = true; schedule(); } break;
        case 'pointer':
          pointer.x = m.x; pointer.y = m.y;
          if (m.on !== undefined) pointer.on = m.on;
          if (!pointer.on) { px = -1; }
          if (reduced) { dirty = true; schedule(); }
          break;
        case 'focus':
          focus = m.i; if (reduced) { dirty = true; schedule(); } break;
        case 'labels':
          labels = m.items; break;
        case 'reduced':
          reduced = !!m.v; if (!reduced) schedule(); else { dirty = true; schedule(); } break;
        case 'start':
          if (!started) {
            started = true; startT = (performance.now() / 1000);
            uS = scrollToU(scrollY); uV = 0;
            if (reduced) startT -= 10;
            schedule();
          }
          break;
      }
    };

    this.stats = function () { return { quality: quality, pixelScale: pixelScale, hz: Math.round(1 / periodGuess), points: M, cpuMs: +cpuEMA.toFixed(2) }; };
    // for testing: render time without raster, a rough guide to JS cost
    this.debug = { get dtEMA() { return dtEMA; } };
  }

  /* ---- worker entry ---- */
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    var scene = null;
    root.onmessage = function (e) {
      var m = e.data;
      if (m.type === 'init') {
        try {
          scene = new Scene(m.canvas, m, function (o) { root.postMessage(o); });
          root.postMessage({ type: 'ready', raf: typeof root.requestAnimationFrame === 'function' });
        } catch (err) {
          root.postMessage({ type: 'error', message: String(err && err.message || err) });
        }
      } else if (scene) {
        if (m.type === 'labels') {
          scene.handle({ type: 'labels', items: m.items });
        } else scene.handle(m);
      }
    };
  } else {
    root.FigureScene = Scene;
  }
})(typeof self !== 'undefined' ? self : this);
