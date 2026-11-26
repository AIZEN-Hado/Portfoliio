/* ============================================================================
   portrait.js — the portrait in the introduction, drawn as a halftone field.

   A hex lattice of dots; each dot's size follows the tone of a source picture, so the
   picture is made of the same kind of points as the figure behind the page. The dots fly in
   from the right (from the figure) when the portrait scrolls into view, settle on springs,
   and part around the cursor, turning cobalt where they are disturbed. Only the person is drawn
   (the source has a paper-white background), so there is no frame. At rest the dots keep drifting,
   lean toward the cursor by depth, and a few free particles orbit the figure.

   Source: if the <figure id="portrait"> has data-src, that photo is used. Otherwise, or if
   the photo fails to load, a monogram of the initials is drawn instead.
   Only runs while on screen. With reduced motion it draws once and stays still.
   ============================================================================ */
(function () {
  'use strict';

  var fig = document.getElementById('portrait');
  if (!fig) return;
  var cv = fig.querySelector('canvas');
  var ctx = cv.getContext('2d');
  var reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  var TAU = Math.PI * 2;
  var INK = '#101326', COBALT = '#2C3EF5';

  var W = 0, H = 0, DPR = 1;
  var N = 0, hx, hy, x, y, vx, vy, rad, wait, tone;
  var mode = 'monogram', image = null;
  var vis = false, raf = 0, last = 0, t0 = 0, assembled = false, settled = false;
  var ptr = { x: -1e4, y: -1e4, cx: -1e4, cy: -1e4, on: false };
  var par = { x: 0, y: 0 };                 // the field leans toward the cursor, near dots more than far ones
  var NS = 150, so = null;                  // free particles that orbit the figure

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function smooth(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
  function hash(i) { var s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  /* ------------------------------------------------------------ tone sources */
  function drawMonogram(g, w, h) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    // a soft ground, lit from the upper left, so the plate reads as a halftone and not just two letters
    var grd = g.createRadialGradient(w * 0.28, h * 0.2, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.85);
    grd.addColorStop(0, 'rgba(0,0,0,0.1)'); grd.addColorStop(1, 'rgba(0,0,0,0.46)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    var fs = h * 0.6;
    g.textAlign = 'center'; g.textBaseline = 'alphabetic';
    g.font = '800 ' + fs + 'px "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif';
    var tw = g.measureText('YC').width;
    if (tw > w * 0.92) { fs *= (w * 0.92) / tw; g.font = '800 ' + fs + 'px "Bricolage Grotesque", "Helvetica Neue", Arial, sans-serif'; }
    g.fillStyle = '#000';
    g.fillText('YC', w / 2, h * 0.5 + fs * 0.36);
  }

  function drawPhoto(g, w, h) {
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    var iw = image.naturalWidth, ih = image.naturalHeight;
    var s = Math.max(w / iw, h / ih);          // cover
    var dw = iw * s, dh = ih * s;
    g.drawImage(image, (w - dw) / 2, (h - dh) * 0.32, dw, dh);   // keep the head: crop from the bottom
  }

  /* Reads the source into a lattice of tones (0 = paper, 1 = full ink). */
  function sampleTones(pts) {
    var sw = Math.max(8, Math.round(W / 2)), sh = Math.max(8, Math.round(H / 2));
    var c = document.createElement('canvas');
    c.width = sw; c.height = sh;
    var g = c.getContext('2d', { willReadFrequently: true });
    if (mode === 'photo') drawPhoto(g, sw, sh); else drawMonogram(g, sw, sh);
    var data = g.getImageData(0, 0, sw, sh).data;
    var lum = new Float32Array(sw * sh), hist = new Uint32Array(256);
    for (var i = 0; i < sw * sh; i++) {
      var l = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255;
      lum[i] = l; hist[(l * 255) | 0]++;
    }
    var lo = 0, hi = 1;
    if (mode === 'photo') {          // auto-levels, so a flat photo still has full range
      var acc = 0, total = sw * sh, a = 0, b = 255;
      for (a = 0; a < 255 && acc < total * 0.01; a++) acc += hist[a];
      acc = 0;
      for (b = 255; b > 0 && acc < total * 0.01; b--) acc += hist[b];
      lo = a / 255; hi = Math.max(lo + 0.1, b / 255);
    }
    var out = new Float32Array(pts.length / 2);
    for (var k = 0; k < out.length; k++) {
      var sx = clamp(Math.round(pts[k * 2] / W * (sw - 1)), 0, sw - 1);
      var sy = clamp(Math.round(pts[k * 2 + 1] / H * (sh - 1)), 0, sh - 1);
      var v = clamp((lum[sy * sw + sx] - lo) / (hi - lo), 0, 1);
      if (!(mode === 'photo' && fig.getAttribute('data-tone') === 'light')) v = 1 - v;   // data-tone="light": dots follow the light, for a dark photo
      if (mode === 'photo') {
        // the figure dissolves toward the bottom and sides of its frame instead of ending on a line
        var fy = 1 - smooth((sy / (sh - 1) - 0.74) / 0.24), fx = smooth(Math.min(sx, sw - 1 - sx) / (sw * 0.07));
        out[k] = Math.pow(v, 1.12) * fy * fx;
      } else out[k] = v;
    }
    return out;
  }

  /* ------------------------------------------------------------------ field */
  function build() {
    var rect = fig.getBoundingClientRect();
    W = Math.max(1, Math.round(rect.width)); H = Math.max(1, Math.round(rect.height));
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    var cell = Math.max(5, Math.round(W / 68 * 2) / 2);
    var rowH = cell * 0.866;
    var cols = Math.ceil(W / cell) + 1, rows = Math.ceil(H / rowH) + 1;
    var pts = new Float32Array(cols * rows * 2), n = 0;
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      pts[n++] = (c + (r & 1) * 0.5) * cell; pts[n++] = r * rowH;
    }
    var tones = sampleTones(pts);

    // keep only dots that will be seen
    var keep = [];
    for (var i = 0; i < tones.length; i++) if (tones[i] > 0.04 && pts[i * 2] <= W + cell && pts[i * 2 + 1] <= H + cell) keep.push(i);
    N = keep.length;
    var prevAssembled = assembled;
    hx = new Float32Array(N); hy = new Float32Array(N); x = new Float32Array(N); y = new Float32Array(N);
    vx = new Float32Array(N); vy = new Float32Array(N); rad = new Float32Array(N); wait = new Float32Array(N); tone = new Float32Array(N);
    for (var j = 0; j < N; j++) {
      var q = keep[j];
      hx[j] = pts[q * 2]; hy[j] = pts[q * 2 + 1]; tone[j] = tones[q];
      rad[j] = cell * 0.5 * Math.sqrt(tones[q]) * 0.94;
      if (prevAssembled || reduceMQ.matches) { x[j] = hx[j]; y[j] = hy[j]; }
      else {
        // arrive from the right, where the figure is
        x[j] = W + W * (0.15 + hash(j) * 0.9); y[j] = hy[j] + (hash(j + 9000) - 0.5) * H * 0.9;
      }
      wait[j] = (1 - hx[j] / W) * 0.3 + hash(j + 4000) * 0.55;
    }
    so = new Float32Array(NS * 6);
    for (var m = 0; m < NS; m++) {
      so[m * 6] = 0.34 + hash(m + 100) * 0.3;          // x radius, as a share of the width
      so[m * 6 + 1] = 0.36 + hash(m + 200) * 0.3;      // y radius
      so[m * 6 + 2] = hash(m + 300) * TAU;             // phase
      so[m * 6 + 3] = (0.05 + hash(m + 400) * 0.12) * (hash(m + 450) < 0.5 ? -1 : 1);   // speed
      so[m * 6 + 4] = 0.9 + hash(m + 500) * 1.5;       // radius
      so[m * 6 + 5] = hash(m + 600);                   // colour pick
    }
    settled = false;
    draw(performance.now());
  }

  /* ------------------------------------------------------------------- draw */
  var BREATH = 0.1;
  // where a dot rests: its place in the picture, a slow drift of its own, and a lean toward the cursor
  function ax0(i, tt) { return reduceMQ.matches ? 0 : Math.sin(tt * 0.9 + hy[i] * 0.031 + hx[i] * 0.012) * 1.3 + par.x * (0.3 + 0.7 * tone[i]); }
  function ay0(i, tt) { return reduceMQ.matches ? 0 : Math.cos(tt * 0.8 + hx[i] * 0.027 + hy[i] * 0.009) * 1.3 + par.y * (0.3 + 0.7 * tone[i]); }
  function draw(now) {
    var tt = now / 1000, still = reduceMQ.matches;
    ctx.clearRect(0, 0, W, H);
    var age0 = assembled ? 1e3 : (now - t0) / 1000;
    var ink = new Path2D(), blue = new Path2D();
    var R2 = 78 * 78;
    for (var i = 0; i < N; i++) {
      var age = age0 - wait[i];
      if (age < 0) continue;
      var grow = still ? 1 : smooth(age / 0.55);
      if (grow <= 0.01) continue;
      var rr = rad[i] * grow;
      if (!still) rr *= 1 + BREATH * Math.sin(tt * 1.5 + hx[i] * 0.045 + hy[i] * 0.032);
      var dx = x[i] - ptr.cx, dy = y[i] - ptr.cy;
      var near = ptr.on && dx * dx + dy * dy < R2;
      var mx = x[i] - hx[i] - ax0(i, tt), my = y[i] - hy[i] - ay0(i, tt);
      var moved = mx * mx + my * my > 9 && age > 1.6;
      var path = (near || moved) ? blue : ink;
      path.moveTo(x[i] + rr, y[i]);
      path.arc(x[i], y[i], rr, 0, TAU);
    }
    ctx.fillStyle = INK; ctx.fill(ink);
    ctx.fillStyle = COBALT; ctx.fill(blue);
    if (so && !still && age0 > 1.2) {
      var sa = smooth((age0 - 1.2) / 1.6), cxm = W * 0.5, cym = H * 0.5;
      var sInk = new Path2D(), sBlue = new Path2D();
      for (var m = 0; m < NS; m++) {
        var a = so[m * 6 + 2] + tt * so[m * 6 + 3];
        var px = cxm + Math.cos(a) * so[m * 6] * W + Math.sin(tt * 0.31 + m) * 6;
        var py = cym + Math.sin(a * 1.3 + m) * so[m * 6 + 1] * H + Math.cos(tt * 0.27 + m * 2) * 6;
        var sr = so[m * 6 + 4] * sa;
        var pth = so[m * 6 + 5] < 0.3 ? sBlue : sInk;
        pth.moveTo(px + sr, py); pth.arc(px, py, sr, 0, TAU);
      }
      ctx.globalAlpha = 0.55; ctx.fillStyle = INK; ctx.fill(sInk);
      ctx.globalAlpha = 0.9; ctx.fillStyle = COBALT; ctx.fill(sBlue);
      ctx.globalAlpha = 1;
    }
  }

  function step(dt, now) {
    var age0 = (now - t0) / 1000;
    var K = 24, C = 8.4;
    var R = 86, F = 1900;
    var allHome = true, tt = now / 1000;
    // the lean follows the cursor across the portrait, easing in and out
    var lx = ptr.on ? clamp((ptr.cx / W - 0.5) * 2, -1.2, 1.2) * 7 : 0, ly = ptr.on ? clamp((ptr.cy / H - 0.5) * 2, -1.2, 1.2) * 7 : 0;
    par.x += (lx - par.x) * Math.min(1, dt * 3); par.y += (ly - par.y) * Math.min(1, dt * 3);
    for (var i = 0; i < N; i++) {
      if (!assembled && age0 - wait[i] < 0) { allHome = false; continue; }
      var tx = hx[i] + ax0(i, tt), ty = hy[i] + ay0(i, tt);
      var ax = (tx - x[i]) * K - vx[i] * C, ay = (ty - y[i]) * K - vy[i] * C;
      if (ptr.on) {
        var dx = x[i] - ptr.cx, dy = y[i] - ptr.cy, d2 = dx * dx + dy * dy;
        if (d2 < R * R && d2 > 0.01) {
          var d = Math.sqrt(d2), f = (1 - d / R); f *= f * F;
          ax += dx / d * f; ay += dy / d * f;
        }
      }
      vx[i] += ax * dt; vy[i] += ay * dt;
      x[i] += vx[i] * dt; y[i] += vy[i] * dt;
      if (allHome && (Math.abs(x[i] - tx) > 3.5 || Math.abs(y[i] - ty) > 3.5)) allHome = false;
    }
    if (!assembled && age0 > 2.4 && allHome) assembled = true;
  }

  function frame(now) {
    raf = 0;
    if (!vis) return;
    var dt = last ? clamp((now - last) / 1000, 0.001, 0.033) : 1 / 60;
    // pointer in canvas space, read once per frame
    if (ptr.on) {
      var r = fig.getBoundingClientRect();
      ptr.cx = ptr.x - r.left; ptr.cy = ptr.y - r.top;
    }
    if (now - last < 14 && last) { raf = requestAnimationFrame(frame); return; }   // cap at about 70 per second
    last = now;
    step(dt, now);
    draw(now);
    raf = requestAnimationFrame(frame);
  }
  function start() { if (!raf && !reduceMQ.matches) { last = 0; raf = requestAnimationFrame(frame); } }

  /* ----------------------------------------------------------- source loading */
  function useMonogram() {
    mode = 'monogram'; image = null;
    fig.setAttribute('data-mode', 'monogram');
    build();
  }
  function load(src) {
    if (!src) { useMonogram(); return; }
    var img = new Image();
    img.onload = function () { image = img; mode = 'photo'; fig.setAttribute('data-mode', 'photo'); assembled = false; t0 = performance.now(); build(); };
    img.onerror = function () { useMonogram(); };
    img.decoding = 'async';
    img.src = src;
  }

  /* ------------------------------------------------------------------- wiring */
  fig.setAttribute('role', 'img');
  fig.setAttribute('aria-label', fig.getAttribute('data-alt') || 'Portrait');

  if (window.IntersectionObserver) {
    new IntersectionObserver(function (es) {
      var was = vis;
      vis = es[es.length - 1].isIntersecting;
      if (vis && !was) { if (!t0 || !assembled) t0 = performance.now(); start(); }
    }, { rootMargin: '80px 0px 80px 0px' }).observe(fig);
  } else { vis = true; t0 = performance.now(); start(); }

  window.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.on = true;
  }, { passive: true });
  document.documentElement.addEventListener('mouseleave', function () { ptr.on = false; });
  window.addEventListener('blur', function () { ptr.on = false; });

  var rsT = 0, lastW = 0;
  if (window.ResizeObserver) {
    new ResizeObserver(function () {
      var w = fig.clientWidth;
      if (!w || w === lastW) return;
      lastW = w;
      clearTimeout(rsT); rsT = setTimeout(build, 140);
    }).observe(fig);
  }
  var onReduce = function () { build(); if (!reduceMQ.matches) start(); };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);

  var inited = false;
  function init() {
    if (inited) return;
    inited = true;
    t0 = performance.now();
    if (reduceMQ.matches) assembled = true;
    load(fig.getAttribute('data-src') || '');
  }
  if (document.fonts && document.fonts.load) {
    document.fonts.load('800 80px "Bricolage Grotesque"').then(init, init);
    setTimeout(init, 1500);
  } else init();

  window.__portrait = { load: load, state: function () { return { mode: mode, dots: N, assembled: assembled, visible: vis }; } };
})();
