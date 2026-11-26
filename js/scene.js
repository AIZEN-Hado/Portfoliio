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

     Every cluster is drawn as a recognisable object, not a cloud: its outline
     is sampled at an even spacing, joined by hairlines, and a few interior dots
     give it body. Shapes are authored in their own frame (x right, y up, z
     toward the viewer) and placed so that frame faces the camera's parked view.
     ========================================================================== */
  var CLUSTERS = [
    { name: 'PolicyPilot AI', shape: 'doc' },
    { name: 'SemiGit', shape: 'git' },
    { name: 'ProvChain', shape: 'cubes' },
    { name: 'InterviewIQ', shape: 'bubbles' },
    { name: 'ClasslyAI', shape: 'cap' },
    { name: 'Offline UPI Mesh', shape: 'mesh' },
    { name: 'All-Ears', shape: 'phones' },
    { name: 'Fisherman', shape: 'fish' },
    { name: 'LazyForm', shape: 'form' },
    { name: 'Dispatch Load Balancer', shape: 'balancer' },
    { name: 'AI and ML systems', shape: 'net' },
    { name: 'Backend and APIs', shape: 'db' },
    { name: 'Frontend', shape: 'browser' },
    { name: 'Cloud and tools', shape: 'cloud' }
  ];
  var NPROJ = 10;
  var WALL_R = 58, WALL_RINGS = 17, WALL_N = 48;

  // Projects wind down a helix; the four skills are stacked in a column below it, facing the camera.
  var SKY = -63.5;   // height of the skills column
  (function placeClusters() {
    var i, k;
    for (i = 0; i < NPROJ; i++) {
      var a = i * 0.92 + 0.4;
      CLUSTERS[i].c = [17 * Math.cos(a), 20 - i * 6.5, 17 * Math.sin(a)];
      CLUSTERS[i].out = [Math.cos(a), 0, Math.sin(a)];
      CLUSTERS[i].right = [Math.sin(a), 0, -Math.cos(a)];
    }
    var ys = [9.6, 3.2, -3.2, -9.6];
    for (k = 0; k < 4; k++) {
      CLUSTERS[NPROJ + k].c = [0, SKY + ys[k], 0];
      CLUSTERS[NPROJ + k].out = [0, 0, 1];
      CLUSTERS[NPROJ + k].right = [1, 0, 0];
    }
  })();

  // Camera stations, in page order: introduction, ten projects, skills (two), contact.
  // While a station is parked (the page holds its content still) the camera keeps moving a little:
  //   orb   how far it swings around the target over the whole park, in radians
  //   dolly how much closer it ends than it began, as a fraction of the distance
  var STATIONS = (function () {
    var s = [{ p: [-50, 26, 94], t: [0, -9, 0], orb: 0.5, dolly: 0 }];   // introduction: the whole helix, turning slowly
    for (var i = 0; i < NPROJ; i++) {
      var c = CLUSTERS[i];
      s.push({
        p: [c.c[0] + c.out[0] * 30, c.c[1] + 3, c.c[2] + c.out[2] * 30],
        t: [c.c[0], c.c[1], c.c[2]],
        orb: 0.2, dolly: 0.12
      });
    }
    s.push({ p: [0, SKY + 4, 58], t: [0, SKY, 0], orb: 0, dolly: 0 });    // skills, approaching the column
    s.push({ p: [0, SKY + 1, 46], t: [0, SKY, 0], orb: 0, dolly: 0 });    // skills, in front of it
    s.push({ p: [38, 16, 84], t: [0, -14, 0], orb: 0, dolly: 0 });        // contact: pull back
    return s;
  })();

  /* ---- shape-drawing helpers ---- */
  function cr(a, b, c, d, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  function v3(p, z) { return [p[0], p[1], p.length > 2 ? p[2] : (z || 0)]; }
  function len3(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]); }
  function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  // even samples along a dense path
  function resample(path, step, closed) {
    var pts = closed ? path.concat([path[0]]) : path, cum = [0], i;
    for (i = 1; i < pts.length; i++) cum.push(cum[i - 1] + len3(pts[i - 1], pts[i]));
    var L = cum[cum.length - 1], n = Math.max(closed ? 3 : 2, Math.round(L / step)), out = [], seg = 1;
    for (var j = 0; j < n; j++) {
      var s = closed ? L * j / n : L * j / (n - 1);
      while (seg < cum.length - 1 && cum[seg] < s) seg++;
      out.push(lerp3(pts[seg - 1], pts[seg], clamp((s - cum[seg - 1]) / ((cum[seg] - cum[seg - 1]) || 1), 0, 1)));
    }
    return out;
  }
  function spline(ctrl, closed, per) {
    var out = [], n = ctrl.length, segs = closed ? n : n - 1;
    for (var s = 0; s < segs; s++) {
      var p0 = ctrl[closed ? (s - 1 + n) % n : Math.max(0, s - 1)], p1 = ctrl[s], p2 = ctrl[(s + 1) % n], p3 = ctrl[closed ? (s + 2) % n : Math.min(n - 1, s + 2)];
      for (var j = 0; j < per; j++) {
        var t = j / per;
        out.push([cr(p0[0], p1[0], p2[0], p3[0], t), cr(p0[1], p1[1], p2[1], p3[1], t), cr(p0[2], p1[2], p2[2], p3[2], t)]);
      }
    }
    if (!closed) out.push(ctrl[n - 1].slice());
    return out;
  }
  function bezier(p0, p1, p2, p3, n) {
    var out = [];
    for (var i = 0; i <= n; i++) {
      var t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
      out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1], a * p0[2] + b * p1[2] + c * p2[2] + d * p3[2]]);
    }
    return out;
  }
  function circlePath(cx, cy, z, r, step) {
    var n = Math.max(8, Math.round(TAU * r / step)), out = [];
    for (var i = 0; i < n; i++) out.push([cx + r * Math.cos(TAU * i / n), cy + r * Math.sin(TAU * i / n), z]);
    return out;
  }
  function arcPath(cx, cy, z, r, a0, a1, step) {
    var n = Math.max(2, Math.round(Math.abs(a1 - a0) * r / step)), out = [];
    for (var i = 0; i <= n; i++) { var a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a), z]); }
    return out;
  }
  // rounded rectangle, counter-clockwise from the bottom edge, with an optional speech-bubble tail on it
  function rrPath(cx, cy, z, w, h, r, step, tail) {
    var L = cx - w / 2, Rt = cx + w / 2, B = cy - h / 2, T = cy + h / 2, p = [];
    r = Math.min(r, w / 2, h / 2);
    var seg = Math.max(2, Math.round(r * Math.PI / 2 / step));
    function corner(ox, oy, a0) {
      for (var i = 0; i <= seg; i++) { var a = a0 + (Math.PI / 2) * i / seg; p.push([ox + r * Math.cos(a), oy + r * Math.sin(a), z]); }
    }
    p.push([L + r, B, z]);
    if (tail) { p.push([tail.x - 0.5, B, z]); p.push([tail.x + tail.dx, B - tail.dy, z]); p.push([tail.x + 0.4, B, z]); }
    p.push([Rt - r, B, z]);
    corner(Rt - r, B + r, -Math.PI / 2);
    corner(Rt - r, T - r, 0);
    corner(L + r, T - r, Math.PI / 2);
    corner(L + r, B + r, Math.PI);
    p.pop();   // the last point repeats the first
    return p;
  }

  function buildWorld() {
    var R = rng(20260611);
    var P = [];        // [x, y, z, cluster, has an edge]
    var E = [];        // edges as [a, b, cluster] in generation order
    var meta = [];

    /* One shape's drawing kit. Points that carry an edge are placed once even when two strokes meet. */
    function Kit() {
      var pts = [], edges = [], at = {};
      var kit = {
        pts: pts, edges: edges,
        add: function (x, y, z, e) {
          if (e) {
            var key = Math.round(x * 40) + ',' + Math.round(y * 40) + ',' + Math.round(z * 40);
            if (at[key] !== undefined) return at[key];
            at[key] = pts.length;
          }
          pts.push([x, y, z, e ? 1 : 0]);
          return pts.length - 1;
        },
        join: function (a, b) { if (a !== b) edges.push([a, b]); },
        chain: function (samples, closed) {
          var idx = [], i;
          for (i = 0; i < samples.length; i++) idx.push(kit.add(samples[i][0], samples[i][1], samples[i][2], true));
          for (i = 1; i < idx.length; i++) kit.join(idx[i - 1], idx[i]);
          if (closed && idx.length > 2) kit.join(idx[idx.length - 1], idx[0]);
          return idx;
        },
        // a polyline with its corners kept exactly, sampled every `step`
        poly: function (path, z, step, closed) {
          var n = path.length, segs = closed ? n : n - 1, out = [], s, j;
          for (s = 0; s < segs; s++) {
            var a = v3(path[s], z), b = v3(path[(s + 1) % n], z), m = Math.max(1, Math.round(len3(a, b) / step));
            for (j = 0; j < m; j++) out.push(lerp3(a, b, j / m));
          }
          if (!closed) out.push(v3(path[n - 1], z));
          return kit.chain(out, closed);
        },
        // a smooth path, resampled to an even spacing
        curve: function (dense, step, closed) { return kit.chain(resample(dense, step, closed), closed); },
        line: function (a, b, z, step) { return kit.poly([a, b], z, step, false); },
        dot: function (x, y, z) { return kit.add(x, y, z, true); },
        // hex lattice of loose dots inside a region
        fill: function (test, x0, x1, y0, y1, z, step) {
          var dy = step * 0.866, row = 0;
          for (var y = y0; y <= y1; y += dy, row++) {
            for (var x = x0 + ((row & 1) ? step / 2 : 0); x <= x1; x += step) if (test(x, y)) pts.push([x, y, z, 2]);
          }
        }
      };
      return kit;
    }

    var S = 0.2;     // outline spacing, in world units

    var SHAPES = {};

    // PolicyPilot AI: a policy document, a sheet behind it, and a check that it was verified
    SHAPES.doc = function (k) {
      k.poly([[-2.65, 3.8], [-2.65, 4.25], [1.95, 4.25], [3.75, 2.45], [3.75, -3.55], [3.2, -3.55]], -1.2, S, false);
      k.poly([[3.2, -4], [-3.2, -4], [-3.2, 3.8], [1.4, 3.8], [3.2, 2], [3.2, -4]], 0, S, false);
      k.poly([[1.4, 3.8], [1.4, 2], [3.2, 2]], 0, S, false);
      k.line([-2.2, 2.8], [0.4, 2.8], 0, S);
      k.line([-2.3, 1.2], [2.3, 1.2], 0, S);
      k.line([-2.3, 0.2], [2.3, 0.2], 0, S);
      k.line([-2.3, -0.8], [2.3, -0.8], 0, S);
      k.line([-2.3, -1.8], [0.9, -1.8], 0, S);
      k.poly(circlePath(3, -3, 1, 1.4, S), 1, S, true);
      k.poly([[2.2, -3], [2.75, -3.65], [3.9, -2.3]], 1, S, false);
    };

    // SemiGit: a commit graph. Two branches leave main and merge back.
    SHAPES.git = function (k) {
      var G = 0.5;   // gap left around a commit
      function commit(x, y, z) {
        k.poly(circlePath(x, y, z, 0.36, 0.18), z, 0.18, true);
        k.dot(x, y, z);
      }
      function lane(xs, y, z) { for (var i = 0; i < xs.length - 1; i++) k.line([xs[i] + G, y], [xs[i + 1] - G, y], z, S); }
      function connector(x0, y0, z0, x1, y1, z1) {
        var dx = (x1 - x0) * 0.55;
        k.curve(bezier([x0, y0, z0], [x0 + dx, y0, z0], [x1 - dx, y1, z1], [x1, y1, z1], 28), S, false);
      }
      var main = [-4.6, -2.6, -0.6, 2.6, 4.0];
      lane(main, 0, 0);
      main.forEach(function (x) { commit(x, 0, 0); });
      // branch A, above
      connector(-2.6 + G, 0, 0, -1.3, 2.4, 0.8);
      k.line([-1.3, 2.4], [0 - G, 2.4], 0.8, S); commit(0, 2.4, 0.8);
      k.line([G, 2.4], [1.5, 2.4], 0.8, S);
      connector(1.5, 2.4, 0.8, 2.6 - G, 0, 0);
      // branch B, below
      connector(-0.6 + G, 0, 0, 0.6, -2.4, -0.8);
      k.line([0.6, -2.4], [1.4 - G, -2.4], -0.8, S); commit(1.4, -2.4, -0.8);
      lane([1.4, 2.6], -2.4, -0.8); commit(2.6, -2.4, -0.8);
      k.line([2.6 + G, -2.4], [3.0, -2.4], -0.8, S);
      connector(3.0, -2.4, -0.8, 4.0 - G, 0, 0);
    };

    // ProvChain: blocks chained one to the next
    SHAPES.cubes = function (k) {
      var ry = 0.62, rx = 0.42, cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
      function cube(ox, oy, oz, s) {
        var h = s / 2, V = [], i, j;
        for (i = 0; i < 8; i++) {
          var x = (i & 1) ? h : -h, y = (i & 2) ? h : -h, z = (i & 4) ? h : -h;
          var x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
          V.push([ox + x1, oy + y * cx - z1 * sx, oz + y * sx + z1 * cx]);
        }
        for (i = 0; i < 8; i++) for (j = i + 1; j < 8; j++) {
          var d = i ^ j;
          if (d === 1 || d === 2 || d === 4) k.poly([V[i], V[j]], 0, 0.26, false);
        }
      }
      var xs = [-3.7, 0, 3.7], ys = [1.0, 0, -1.0];
      for (var i = 0; i < 3; i++) cube(xs[i], ys[i], 0, 2.1);
      for (i = 0; i < 2; i++) {
        var mx = (xs[i] + xs[i + 1]) / 2, my = (ys[i] + ys[i + 1]) / 2;
        k.poly(rrPath(mx, my, 0, 0.8, 0.36, 0.18, 0.16), 0, 0.16, true);
      }
    };

    // InterviewIQ: a question and an answer
    SHAPES.bubbles = function (k) {
      k.poly(rrPath(-0.9, 2.2, 0.6, 6.6, 3.4, 1.0, S, { x: -3.0, dx: -0.2, dy: 0.95 }), 0.6, S, true);
      k.line([-3.8, 3.0], [1.6, 3.0], 0.6, S);
      k.line([-3.8, 2.0], [0.2, 2.0], 0.6, S);
      k.poly(rrPath(1.5, -1.7, -0.6, 6.4, 3.0, 1.0, S, { x: 3.2, dx: 0.2, dy: 0.95 }), -0.6, S, true);
      for (var i = 0; i < 3; i++) {
        var cxd = 0.3 + i * 1.2;
        k.poly(circlePath(cxd + 0.9, -1.7, -0.6, 0.3, 0.16), -0.6, 0.16, true);
        k.dot(cxd + 0.9, -1.7, -0.6);
      }
    };

    // ClasslyAI: a graduation cap
    SHAPES.cap = function (k) {
      k.curve(spline([[-2.9, -0.2, -0.4], [-2.9, -1.5, -0.4], [-1.6, -2.7, -0.4], [0, -3.2, -0.4], [1.6, -2.7, -0.4], [2.9, -1.5, -0.4], [2.9, -0.2, -0.4]], false, 10), S, false);
      k.poly([[-5, 0.9], [0, 3.4], [5, 0.9], [0, -1.6]], 0.5, S, true);
      k.fill(function (x, y) { return Math.abs(x) / 5 + Math.abs(y - 0.9) / 2.5 < 0.86; }, -5, 5, -1.7, 3.5, 0.5, 0.5);
      k.poly(circlePath(0, 0.9, 0.5, 0.28, 0.14), 0.5, 0.14, true);
      k.curve(bezier([0, 0.9, 0.5], [2.2, 1.0, 0.6], [4.4, 1.0, 0.6], [4.4, -1.0, 0.6], 24), S, false);
      k.poly(circlePath(4.4, -1.5, 0.6, 0.45, 0.16), 0.6, 0.16, true);
      for (var i = -1; i <= 1; i++) k.line([4.4 + i * 0.28, -1.9], [4.4 + i * 0.38, -3.4], 0.6, S);
    };

    // Offline UPI Mesh: five phones passing a payment from hand to hand
    SHAPES.mesh = function (k) {
      var ph = [[-4.1, -0.6, 0.8], [-2.0, 1.9, -0.4], [0.1, -1.2, 0.6], [2.2, 1.6, -0.6], [4.3, -0.9, 0.8]];
      var hw = 0.64, hh = 1.18;
      ph.forEach(function (p, i) {
        k.poly(rrPath(p[0], p[1], p[2], hw * 2, hh * 2, 0.3, S), p[2], S, true);
        k.line([p[0] - 0.25, p[1] - hh + 0.28], [p[0] + 0.25, p[1] - hh + 0.28], p[2], 0.16);
        if (i === 0 || i === 4) k.fill(function (x, y) { return true; }, p[0] - 0.4, p[0] + 0.4, p[1] - 0.8, p[1] + 0.9, p[2], 0.3);
      });
      var links = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 2], [2, 4], [1, 3]];
      links.forEach(function (l) {
        var a = ph[l[0]], b = ph[l[1]], dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy);
        var te = Math.min(hw / Math.max(Math.abs(dx / d), 1e-6), hh / Math.max(Math.abs(dy / d), 1e-6)) + 0.16;
        var ux = dx / d, uy = dy / d;
        k.line([a[0] + ux * te, a[1] + uy * te, a[2]], [b[0] - ux * te, b[1] - uy * te, b[2]], 0, 0.24);
      });
    };

    // All-Ears: headphones, with the sound they are listening to
    SHAPES.phones = function (k) {
      k.curve(arcPath(0, 0.4, 0, 3.7, 0, Math.PI, S), S, false);
      k.curve(arcPath(0, 0.4, 0, 3.2, 0.12, Math.PI - 0.12, S), S, false);
      [-1, 1].forEach(function (sd) {
        k.poly(rrPath(sd * 3.7, -1.3, 0.4, 1.8, 3.4, 0.7, S), 0.4, S, true);
        k.fill(function () { return true; }, sd * 3.7 - 0.45, sd * 3.7 + 0.45, -2.5, -0.1, 0.4, 0.3);
      });
      var wave = [];
      for (var i = 0; i <= 90; i++) {
        var t = i / 90, x = -2.3 + 4.6 * t;
        wave.push([x, -1.3 + 1.35 * Math.sin(Math.PI * t) * Math.sin(t * Math.PI * 7), 0]);
      }
      k.curve(wave, 0.17, false);
    };

    // Fisherman: a fish and the hook that is after it
    SHAPES.fish = function (k) {
      var dx = 0.45;
      var body = [[2.4, 0.45], [1.2, 1.2], [-0.4, 1.95], [-2.2, 1.85], [-3.6, 1.05], [-4.5, 0], [-3.6, -1.05], [-2.2, -1.65], [-0.4, -1.85], [1.2, -1.1], [2.4, -0.45]].map(function (p) { return [p[0] + 0.3 + dx, p[1], 0]; });
      k.curve(spline(body, false, 12), S, false);
      k.poly([[2.7 + dx, 0.45], [4.4 + dx, 1.9], [3.8 + dx, 0], [4.4 + dx, -1.9], [2.7 + dx, -0.45]], 0, S, false);
      k.poly([[-0.5 + dx, 1.9], [0.5 + dx, 3.1], [1.6 + dx, 1.4]], -0.3, S, false);
      k.poly([[-0.6 + dx, -1.8], [0.2 + dx, -2.7], [0.9 + dx, -1.3]], -0.3, S, false);
      k.curve(arcPath(-2.5 + dx, 0, 0, 1.5, -0.8, 0.8, S), S, false);
      k.poly(circlePath(-3.5 + dx, 0.5, 0.3, 0.26, 0.14), 0.3, 0.14, true);
      k.dot(-3.5 + dx, 0.5, 0.3);
      k.line([-4.2 + dx, -0.35], [-3.6 + dx, -0.3], 0, 0.16);
      k.fill(function (x, y) { var a = (x - 0.4 - dx) / 1.6, b = y / 1.25; return a * a + b * b < 1; }, -1.4 + dx, 2.2 + dx, -1.3, 1.3, 0, 0.42);
      // the hook: a line from above that ends in a barb at the fish's lip
      k.line([-5.1, 4.2], [-5.1, -1.0], 0, S);
      k.curve(arcPath(-4.65, -1.0, 0, 0.45, Math.PI, 2 * Math.PI, 0.16), 0.16, false);
      k.line([-4.2, -1.0], [-4.2, -0.5], 0, 0.16);
      k.line([-4.2, -0.5], [-4.45, -0.72], 0, 0.14);
    };

    // LazyForm: a short form, filled in step by step
    SHAPES.form = function (k) {
      k.poly(rrPath(0, -0.1, 0, 7.4, 8.2, 0.5, S), 0, S, true);
      var sx = [-2.2, 0, 2.2];
      sx.forEach(function (x, i) {
        k.poly(circlePath(x, 2.9, 0.3, 0.42, 0.16), 0.3, 0.16, true);
        if (i === 0) k.fill(function () { return true; }, x - 0.2, x + 0.2, 2.7, 3.1, 0.3, 0.2);
        if (i === 1) k.dot(x, 2.9, 0.3);
        if (i < 2) k.line([x + 0.56, 2.9], [sx[i + 1] - 0.56, 2.9], 0.3, 0.2);
      });
      k.line([-3.0, 1.6], [-1.4, 1.6], 0.3, 0.2);
      k.poly(rrPath(0, 0.6, 0.3, 6.0, 0.95, 0.28, S), 0.3, S, true);
      k.line([-2.6, 0.6], [-0.6, 0.6], 0.3, 0.2);
      k.line([-0.2, 0.3], [-0.2, 0.9], 0.3, 0.15);
      k.line([-3.0, -0.6], [-1.0, -0.6], 0.3, 0.2);
      k.poly(rrPath(0, -1.6, 0.3, 6.0, 0.95, 0.28, S), 0.3, S, true);
      k.line([-2.6, -1.6], [0.9, -1.6], 0.3, 0.2);
      k.poly(rrPath(0, -3.2, 0.3, 3.6, 1.0, 0.5, S), 0.3, S, true);
      k.fill(function () { return true; }, -1.3, 1.3, -3.5, -2.9, 0.3, 0.3);
    };

    // Dispatch Load Balancer: requests in, one balancer, four servers sharing the load
    SHAPES.balancer = function (k) {
      var hx = -1.6;
      var hexp = [];
      for (var i = 0; i < 6; i++) hexp.push([hx + 1.3 * Math.cos(i * Math.PI / 3 + Math.PI), 1.3 * Math.sin(i * Math.PI / 3 + Math.PI)]);
      k.poly(hexp, 0.3, S, true);
      k.fill(function (x, y) { return Math.hypot(x - hx, y) < 0.95; }, hx - 1, hx + 1, -1, 1, 0.3, 0.3);
      [-1.4, 0, 1.4].forEach(function (y) {
        k.curve(bezier([-5.0, y * 1.35, 0], [-3.9, y * 1.35, 0], [-3.7, 0, 0], [hx - 1.4, 0, 0], 24), 0.2, false);
      });
      var ysv = [3.0, 1.0, -1.0, -3.0], load = [0.62, 0.58, 0.66, 0.6];
      ysv.forEach(function (y, i) {
        k.poly(rrPath(3.1, y, 0, 3.2, 1.45, 0.25, S), 0, S, true);
        k.line([1.8, y], [1.8 + 2.0 * load[i], y], 0, 0.2);
        k.dot(4.15, y + 0.3, 0); k.dot(4.15, y - 0.3, 0);
        k.curve(bezier([hx + 1.4, 0, 0], [0.7, 0, 0], [0.5, y, 0], [1.5, y, 0], 24), 0.2, false);
      });
    };

    // AI and ML systems: a small network
    SHAPES.net = function (k) {
      var layers = [[-2.8, [-1.2, 0, 1.2]], [0, [-1.8, -0.6, 0.6, 1.8]], [2.8, [-1.2, 0, 1.2]]], nodes = [];
      layers.forEach(function (L) { nodes.push(L[1].map(function (y) { return [L[0], y]; })); });
      for (var l = 0; l < 2; l++) nodes[l].forEach(function (a) { nodes[l + 1].forEach(function (b) {
        var dx = b[0] - a[0], dy = b[1] - a[1], d = Math.hypot(dx, dy), g = 0.3 / d;
        k.line([a[0] + dx * g, a[1] + dy * g], [b[0] - dx * g, b[1] - dy * g], 0, 0.5);
      }); });
      nodes.forEach(function (col) { col.forEach(function (n) {
        k.poly(circlePath(n[0], n[1], 0.2, 0.3, 0.16), 0.2, 0.16, true);
      }); });
    };

    // Backend and APIs: a database, with a request going out
    SHAPES.db = function (k) {
      var rx = 2.0, ry = 0.55;
      function ell(y, a0, a1) {
        var d = [];
        for (var i = 0; i <= 40; i++) { var a = a0 + (a1 - a0) * i / 40; d.push([rx * Math.cos(a) - 0.8, y + ry * Math.sin(a), 0]); }
        return d;
      }
      k.curve(ell(1.5, 0, TAU - 0.0001), 0.2, true);
      [0.5, -0.5, -1.5].forEach(function (y) { k.curve(ell(y, Math.PI, TAU), 0.2, false); });
      k.line([-0.8 - rx, 1.5], [-0.8 - rx, -1.5], 0, S);
      k.line([-0.8 + rx, 1.5], [-0.8 + rx, -1.5], 0, S);
      [1.0, 0, -1.0].forEach(function (y) { k.dot(0.7 - 0.8, y - 0.55, 0); });
      k.line([1.5, 0], [4.2, 0], 0, S);
      k.poly([[3.7, 0.45], [4.25, 0], [3.7, -0.45]], 0, 0.14, false);
    };

    // Frontend: a browser window
    SHAPES.browser = function (k) {
      k.poly(rrPath(0, 0, 0, 6.6, 4.6, 0.35, S), 0, S, true);
      k.line([-3.3, 1.2], [3.3, 1.2], 0, S);
      [-2.7, -2.25, -1.8].forEach(function (x) { k.poly(circlePath(x, 1.75, 0.2, 0.12, 0.1), 0.2, 0.1, true); });
      k.poly(rrPath(0.9, 1.75, 0.2, 3.6, 0.5, 0.25, 0.16), 0.2, 0.16, true);
      k.poly(rrPath(-1.7, -0.35, 0.2, 2.3, 1.9, 0.15, 0.2), 0.2, 0.2, true);
      k.fill(function () { return true; }, -2.55, -0.85, -1.1, 0.4, 0.2, 0.32);
      k.line([0.3, 0.5], [2.7, 0.5], 0.2, 0.2);
      k.line([0.3, -0.2], [2.7, -0.2], 0.2, 0.2);
      k.line([0.3, -0.9], [1.7, -0.9], 0.2, 0.2);
    };

    // Cloud and tools: a cloud with an upload arrow
    SHAPES.cloud = function (k) {
      var circles = [[-1.7, -0.5, 1.0], [-0.6, 0.5, 1.4], [0.9, 0.3, 1.2], [2.0, -0.5, 1.0]], O = [0.1, -0.4], floor = -1.5, dense = [], i, j;
      for (i = 0; i < 360; i++) {
        var a = TAU * i / 360, dx = Math.cos(a), dy = Math.sin(a), best = 0;
        for (j = 0; j < circles.length; j++) {
          var c = circles[j], ox = O[0] - c[0], oy = O[1] - c[1], b = ox * dx + oy * dy, cc = ox * ox + oy * oy - c[2] * c[2], disc = b * b - cc;
          if (disc >= 0) { var t = -b + Math.sqrt(disc); if (t > best) best = t; }
        }
        if (dy < 0) best = Math.min(best, (floor - O[1]) / dy);
        dense.push([O[0] + dx * best - 0.1, O[1] + dy * best, 0]);
      }
      k.curve(dense, 0.2, true);
      k.line([0, -0.9], [0, 0.45], 0, S);
      k.poly([[-0.5, 0.0], [0, 0.55], [0.5, 0.0]], 0, 0.16, false);
    };

    /* ---- place every cluster in the world ---- */
    CLUSTERS.forEach(function (def, ci) {
      var k = Kit();
      SHAPES[def.shape](k);
      var base = P.length, maxR = 0, top = 0, o = def.out, r = def.right;
      for (var i = 0; i < k.pts.length; i++) {
        var q = k.pts[i];
        var wx = def.c[0] + q[0] * r[0] + q[2] * o[0], wy = def.c[1] + q[1], wz = def.c[2] + q[0] * r[2] + q[2] * o[2];
        P.push([wx, wy, wz, ci, q[3]]);
        maxR = Math.max(maxR, Math.hypot(wx - def.c[0], wy - def.c[1], wz - def.c[2]));
        top = Math.max(top, q[1]);
      }
      for (var e = 0; e < k.edges.length; e++) E.push([base + k.edges[e][0], base + k.edges[e][1], ci]);
      meta.push({ base: base, count: k.pts.length, radius: maxR, top: top });
    });

    // The wall: a faint lattice of rings around everything. It gives the camera something to travel past.
    for (var rj = 0; rj < WALL_RINGS; rj++) {
      for (var rn = 0; rn < WALL_N; rn++) {
        var wa = TAU * rn / WALL_N;
        P.push([WALL_R * Math.cos(wa), 36 - rj * 8, WALL_R * Math.sin(wa), -1, 0]);
      }
    }

    var M = P.length, i2;
    // Points that carry an edge come first, so thinning the cloud on a slow device never breaks an outline.
    var vi = [], fi = [], oi = [];
    for (i2 = 0; i2 < M; i2++) (P[i2][4] === 1 ? vi : P[i2][4] === 2 ? fi : oi).push(i2);
    function shuffle(a) { for (var n = a.length - 1; n > 0; n--) { var j = (R() * (n + 1)) | 0, t = a[n]; a[n] = a[j]; a[j] = t; } }
    shuffle(vi); shuffle(fi); shuffle(oi);
    var order = vi.concat(fi, oi), slot = new Uint32Array(M);
    for (i2 = 0; i2 < M; i2++) slot[order[i2]] = i2;

    var w = {
      M: M, nV: vi.length,
      hx: new Float32Array(M), hy: new Float32Array(M), hz: new Float32Array(M),
      cl: new Int8Array(M), jit: new Float32Array(M),
      ox: new Float32Array(M), oy: new Float32Array(M), oz: new Float32Array(M),
      delay: new Float32Array(M),
      members: [], edges: [], meta: meta
    };
    for (i2 = 0; i2 < M; i2++) {
      var s2 = slot[i2], p = P[i2];
      w.hx[s2] = p[0]; w.hy[s2] = p[1]; w.hz[s2] = p[2]; w.cl[s2] = p[3];
      w.jit[s2] = 0.92 + R() * 0.2;
      // where this point flies to when the page is scrolled: a direction and a distance
      var od = [gauss(R), gauss(R), gauss(R)], oL = Math.hypot(od[0], od[1], od[2]) || 1, oR = 4 + R() * 10;
      w.ox[s2] = od[0] / oL * oR; w.oy[s2] = od[1] / oL * oR; w.oz[s2] = od[2] / oL * oR;
      w.delay[s2] = R() * 0.6;
    }
    for (var c = 0; c < CLUSTERS.length; c++) { w.members.push([]); w.edges.push([]); }
    for (i2 = 0; i2 < M; i2++) if (w.cl[i2] >= 0) w.members[w.cl[i2]].push(i2);
    for (var e2 = 0; e2 < E.length; e2++) {
      var ea = slot[E[e2][0]], eb = slot[E[e2][1]];
      w.edges[E[e2][2]].push(ea < eb ? ea : eb, ea < eb ? eb : ea);
    }
    for (c = 0; c < CLUSTERS.length; c++) w.edges[c] = new Uint32Array(w.edges[c]);
    return w;
  }

  /* ==========================================================================
     Engine
     ========================================================================== */
  var BUCKETS = 6;
  var B_ALPHA = [0.34, 0.48, 0.68, 0.92, 0.72, 0.44];
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
    var quality = coarse ? 0.52 : (cores >= 8 ? 1 : 0.82);
    var pixelScale = 1;

    // inputs (latest values posted by the page)
    var scrollY = 0, marks = null, edgeDocY = 1e9;
    var pointer = { x: -1, y: -1, on: false, last: 0 };
    var focus = -1;
    var labels = [];

    // springs
    var uS = 0, uV = 0;                 // station parameter
    var drS = 0, drV = 0;               // progress through the current park (see scrollToU)
    var yawS = 0, yawV = 0, pitS = 0, pitV = 0;
    var focusW = 0, focusWV = 0, focusIdx = -1;
    var act = new Float32Array(NC), actV = new Float32Array(NC);
    var camSpeed = 0;
    var bcx = new Float32Array(NC + 1), bcz = new Float32Array(NC + 1), bcos = new Float32Array(NC + 1), bsin = new Float32Array(NC + 1);
    bcos[0] = 1;   // index 0 is the wall, which never turns
    var scat = 0, scatV = 0, lastSY = -1, svE = 0;   // how far the figure is scattered, and the scroll speed behind it
    var px = -1, py = -1, pxV = 0, pyV = 0;   // smoothed query position

    // per-frame buffers
    var sx = new Float32Array(M), sy = new Float32Array(M);
    var psx = new Float32Array(M), psy = new Float32Array(M);
    var sr = new Float32Array(M);
    var skey = new Int32Array(M);
    var sorted = new Uint32Array(M);
    var NB = 10;                        // x-bands: the left fade is baked into point alpha, not a full-screen mask pass
    var K = (NC + 1) * BUCKETS * 2 * NB;
    var bandA = new Float32Array(NB), bandW = -1, bandWide = null;
    var cursor = new Int32Array(K);
    var counts = new Int32Array(K + 1);
    var streaks = new Uint32Array(M), nStreaks = 0;
    var nearI = new Int32Array(NEIGHBOURS), nearD = new Float32Array(NEIGHBOURS), nNear = 0;

    var started = false, startT = 0, introDur = 2.7;
    var missEMA = 0, lastT = 0, frames = 0, ticks = 0, skip = 1, baseHz = 60, introGrace = 150, dtEMA = 1 / 60, periodGuess = 1 / 60, samples = [], slowRun = 0;
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
      // The figure is soft dots and hairlines, so it does not need a retina backing store.
      // Fill cost scales with pixels, so cap both the ratio and the total.
      var pr = Math.max(0.5, Math.min(dpr, 1.5) * pixelScale);
      var area = W * H * pr * pr, cap = 2.2e6;
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

    /* Where the camera should be for a scroll position. marks[k] = [start, end]: the camera is parked on
       station k for scrollY in that range, and flies to station k+1 between end and the next start.
       Returns [u, dr]: u is the position along the stations, dr a sawtooth that rises 0 → 1 through a park
       and falls 1 → 0 during the flight after it, so the slow drift inside a park never jumps. */
    var uOut = [0, 0];
    function fly(t) { return lerp(t, smooth(t), 0.7); }
    function scrollToU(y) {
      var n = STATIONS.length;
      if (!marks || marks.length !== n) { uOut[0] = 0; uOut[1] = 0; return uOut; }
      if (y <= marks[0][0]) { uOut[0] = 0; uOut[1] = 0; return uOut; }
      var k = 0;
      while (k < n - 1 && y >= marks[k + 1][0]) k++;
      var s0 = marks[k][0], e0 = marks[k][1];
      if (k === n - 1 || y <= e0) {
        uOut[0] = k; uOut[1] = (e0 > s0 && k < n - 1) ? clamp((y - s0) / (e0 - s0), 0, 1) : 0;
        return uOut;
      }
      var tt = clamp((y - e0) / ((marks[k + 1][0] - e0) || 1), 0, 1), te = fly(tt);
      uOut[0] = k + te; uOut[1] = 1 - te;
      return uOut;
    }

    /* ---- the frame ---- */
    var cpuEMA = 0;
    function frame(now) {
      queued = false;
      if (!started) { schedule(); return; }
      if (skip > 1 && !reduced && (++ticks % skip) !== 0) { schedule(); return; }
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
      var tgt = scrollToU(scrollY), uTarget = tgt[0], drTarget = tgt[1];
      var s;
      if (reduced) {
        uS = uTarget; uV = 0; drS = drTarget; drV = 0; yawS = pitS = 0; yawV = pitV = 0;
        focusW = focus >= 0 ? 1 : 0; focusIdx = focus >= 0 ? focus : focusIdx;
      } else {
        // quick enough that the camera is where the content says it should be, soft enough to take the steps out of a wheel
        s = damp(uS, uTarget, uV, 10.5, dt); uS = s[0]; uV = s[1];
        s = damp(drS, drTarget, drV, 8, dt); drS = s[0]; drV = s[1];
        var yawT = pointer.on ? (pointer.x / W - 0.5) * 0.30 : 0;
        var pitT = pointer.on ? (pointer.y / H - 0.5) * -0.16 : 0;
        s = damp(yawS, yawT, yawV, 3.2, dt); yawS = s[0]; yawV = s[1];
        s = damp(pitS, pitT, pitV, 3.2, dt); pitS = s[0]; pitV = s[1];
        if (focus >= 0) focusIdx = focus;
        s = damp(focusW, focus >= 0 ? 1 : 0, focusWV, 5.0, dt); focusW = s[0]; focusWV = s[1];
      }

      // Scroll speed drives the scatter: points leave their shape only while the page is moving, and
      // come back together when it stops. It rises quickly and settles more slowly.
      if (lastSY < 0) lastSY = scrollY;
      var sv = Math.abs(scrollY - lastSY) / dt; lastSY = scrollY;
      svE += (sv - svE) * Math.min(1, dt * 14);
      var scTarget = reduced ? 0 : smooth((svE - 240) / 1500);
      s = damp(scat, scTarget, scatV, scTarget > scat ? 15 : 4.4, dt); scat = clamp(s[0], 0, 1); scatV = s[1];

      var P = stationAt(uS, 'p'), T = stationAt(uS, 't');
      if (focusIdx >= 0 && focusW > 0.001) {
        var cdef = CLUSTERS[focusIdx];
        var fd = focusIdx < NPROJ ? 24 : 26;     // a project's case opening moves the camera in closer than a skill hover does
        var fp = [cdef.c[0] + cdef.out[0] * fd, cdef.c[1] + 2.2, cdef.c[2] + cdef.out[2] * fd];
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
      var kk = clamp(Math.floor(uS), 0, STATIONS.length - 2), ff = clamp(uS - kk, 0, 1);
      var orbA = lerp(STATIONS[kk].orb, STATIONS[kk + 1].orb, ff), dolA = lerp(STATIONS[kk].dolly, STATIONS[kk + 1].dolly, ff);
      az += yawS + idle + (1 - introE) * 0.9 + orbA * (drS - 0.5);
      el = clamp(el + pitS + (1 - introE) * 0.18, -1.2, 1.2);
      dist *= (1 - (1 - introE) * 0.45) * (1 - dolA * drS);
      var ce = Math.cos(el);
      P = [T[0] + dist * ce * Math.cos(az), T[1] + dist * Math.sin(el), T[2] + dist * ce * Math.sin(az)];

      // basis
      var fx = T[0] - P[0], fy = T[1] - P[1], fz = T[2] - P[2];
      var fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
      var rx = -fz, ry = 0, rz = fx;                      // forward × up(0,1,0), so the picture is not turned around
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
      var maxAct = 0, nearest = -1, nearestD = 2.5;   // a cluster is active only when the camera is aimed at it
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

      // Every shape turns about its own vertical axis to face the camera, so none is ever seen edge-on.
      for (c = 0; c < NC; c++) {
        var cb = CLUSTERS[c], tc = Math.atan2(P[2] - cb.c[2], P[0] - cb.c[0]) - Math.atan2(cb.out[2], cb.out[0]);
        tc = Math.atan2(Math.sin(tc), Math.cos(tc)) * 0.9;
        bcx[c + 1] = cb.c[0]; bcz[c + 1] = cb.c[2]; bcos[c + 1] = Math.cos(tc); bsin[c + 1] = Math.sin(tc);
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
      // left-hand fade, as alpha per x-band: the old mask was 1 - (0.74 -> 0.5 -> 0) over 0..0.72W
      if (bandW !== W || bandWide !== wide) {
        bandW = W; bandWide = wide;
        for (var bb = 0; bb < NB - 1; bb++) {
          var u0 = (bb + 0.5) / (NB - 1);                 // 0..1 across the faded region
          var mk = u0 < 0.55 ? lerp(0.74, 0.5, u0 / 0.55) : lerp(0.5, 0, (u0 - 0.55) / 0.45);
          bandA[bb] = 1 - mk;
        }
        bandA[NB - 1] = 1;
      }
      var bandEdge = W * 0.72, bandK = (NB - 1) / bandEdge;
      var Nq = Math.max(400, (M * quality) | 0);
      Nq = Math.min(Math.max(Nq, world.nV), M);   // outline points are never thinned
      counts.fill(0);
      nStreaks = 0; nNear = 0;
      var worst = QUERY_RADIUS * QUERY_RADIUS;
      var hx = world.hx, hy = world.hy, hz = world.hz, cl = world.cl, jit = world.jit;
      var ox = world.ox, oy = world.oy, oz = world.oz, dl = world.delay;
      var dF = dist;
      var scatOn = scat > 0.002;
      var NEAR = 0.8;
      var introOn = intro < 1;
      var i, p0, p1, p2, zz, k2, bk, sc, rad, key, side, kk;

      for (i = 0; i < Nq; i++) {
        p0 = hx[i]; p1 = hy[i]; p2 = hz[i];
        var cb1 = cl[i] + 1, tdx = p0 - bcx[cb1], tdz = p2 - bcz[cb1];
        p0 = bcx[cb1] + tdx * bcos[cb1] - tdz * bsin[cb1]; p2 = bcz[cb1] + tdx * bsin[cb1] + tdz * bcos[cb1];
        if (scatOn) {
          var lc = (scat - dl[i] * 0.5) / 0.7;
          if (lc > 0) {
            if (lc > 1) lc = 1;
            lc = lc * lc * (3 - 2 * lc);
            p0 += ox[i] * lc; p1 += oy[i] * lc; p2 += oz[i] * lc;
          }
        }
        if (introOn) {
          var k = easeOut((tin - dl[i] * introDur * 0.6) / (introDur * 0.55));
          var inv = (1 - k) * 6.5;
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
        var band = wide ? (X >= bandEdge ? NB - 1 : (X * bandK) | 0) : NB - 1;
        key = (((cl[i] + 1) * BUCKETS + bk) * 2 + side) * NB + band;
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
      for (kk = 0; kk < K; kk++) cursor[kk] = counts[kk];
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
      ctx.lineWidth = 0.9;
      var edgeFade = clamp(1 - scat * 2.6, 0, 1);
      for (c = 0; c < NC; c++) {
        if (act[c] < 0.03 || edgeFade < 0.02) continue;
        var edgesC = world.edges[c], eN = edgesC.length;
        ctx.strokeStyle = 'rgba(' + COBALT.join(',') + ',' + (0.5 * act[c] * edgeFade).toFixed(3) + ')';
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
      var dim = 1 - 0.2 * maxAct;
      var aScale = wide ? 1 : 0.7;
      var cursorBase = 0;
      var bokeh = 0;
      for (var cc = -1; cc < NC; cc++) {
        var a2 = cc >= 0 ? act[cc] : 0;
        var colInk = mix(INK, COBALT, a2);
        var colPaper = mix(PAPER, WHITE, a2);
        var cdim = cc >= 0 ? lerp(dim, 1, a2) : dim * 0.85;
        for (bk = 0; bk < BUCKETS; bk++) {
          for (side = 0; side < 2; side++) for (var bnd = 0; bnd < NB; bnd++) {
            key = (((cc + 1) * BUCKETS + bk) * 2 + side) * NB + bnd;
            var from = counts[key], to = key + 1 <= K - 1 ? counts[key + 1] : counts[K];
            if (to <= from) continue;
            // `counts[key]` was turned into start offsets; end is the next key's start
            ctx.globalAlpha = B_ALPHA[bk] * cdim * aScale * bandA[bnd] * (bnd < NB - 1 && cc >= 0 ? lerp(0.5, 1, a2) : 1);
            ctx.fillStyle = rgb(side ? colPaper : colInk);
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
        var tp = world.meta[c].top * lsc;
        var ax = Math.min(Math.max(LX - lb.w * 0.5, 16), W - lb.w - 16), ay = Math.max(LY - tp - 16, lb.h + 76);
        ctx.globalAlpha = act[c];
        ctx.strokeStyle = 'rgba(' + COBALT.join(',') + ',0.7)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(LX, ay + 2); ctx.lineTo(LX, ay + 12); ctx.stroke();
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

    /* ---- frame pacing and quality governor ----
       Uneven frames look worse than a steady lower rate, and changing quality
       back and forth looks worse than either. So: it only ever steps down, in
       this order (resolution is invisible on soft dots, point count is not),
       waits after every step, and on a 100 Hz+ screen that can't keep up it
       settles on every second refresh instead of alternating 8 and 16 ms.      */
    var PX_STEPS = [1, 0.84, 0.7, 0.58], Q_STEPS = [1, 0.82, 0.66, 0.52, 0.4];
    var pxStep = 0, qStep = quality >= 1 ? 0 : (quality >= 0.8 ? 1 : 3), cooldown = 0, calmRun = 0;
    function governor(dt) {
      if (root.__noGov) return;
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
          baseHz = best; periodGuess = 1 / best;
          if (post) post({ type: 'stats', hz: best });
        }
        return;
      }
      if (introGrace > 0) { introGrace--; return; }   // the intro and font loading cause real but short hitches
      dtEMA += (dt - dtEMA) * 0.1;
      missEMA += ((dt > periodGuess * 1.5 ? 1 : 0) - missEMA) * 0.03;   // share of frames that missed their slot
      if (cooldown > 0) { cooldown--; return; }
      var slow = dtEMA > periodGuess * 1.3 || missEMA > 0.07;
      if (slow) {
        calmRun = 0; slowRun++;
        if (slowRun < 24) return;
        slowRun = 0;
        if (baseHz >= 100 && skip === 1) skip = 2;                         // steady 60 beats a ragged 85
        else if (pxStep < PX_STEPS.length - 1) { pxStep++; pixelScale = PX_STEPS[pxStep]; applySize(); }
        else if (qStep < Q_STEPS.length - 1) { qStep++; quality = Q_STEPS[qStep]; }
        else if (baseHz >= 100 && skip === 2 && dtEMA > periodGuess * 1.3) { skip = 3; }
        periodGuess = skip / baseHz;
        dtEMA = periodGuess; missEMA = 0; cooldown = 90;
        if (post) post({ type: 'stats', q: quality, px: pixelScale, skip: skip });
      } else {
        slowRun = 0;
        // one cautious step back up after a long calm spell, never faster
        if (++calmRun > 1500 && (pxStep > 0 || qStep > 0)) {
          calmRun = 0;
          if (qStep > 0) { qStep--; quality = Q_STEPS[qStep]; } else { pxStep--; pixelScale = PX_STEPS[pxStep]; applySize(); }
          cooldown = 240;
          if (post) post({ type: 'stats', q: quality, px: pixelScale, skip: skip });
        }
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
            var g0 = scrollToU(scrollY); uS = g0[0]; uV = 0; drS = g0[1]; drV = 0;
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
