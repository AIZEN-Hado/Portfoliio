/* ============================================================================
   main.js — everything on the page that isn't the figure.
   Starts the figure (in a Worker when possible) and feeds it scroll, pointer and layout.
   Drives the pinned project scenes (--e / --h / --x), the project rail, the line-mask
   reveals, the introduction's scroll effects, the caption and the nav colour.
   The camera marks it sends are built from the same scene geometry that drives the text,
   so the figure and the page are always on the same beat.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement, win = window;
  var canvas = doc.getElementById('figure');
  var nav = doc.getElementById('nav');
  var caption = doc.getElementById('caption');
  var contact = doc.getElementById('contact');
  var projs = Array.prototype.slice.call(doc.querySelectorAll('.proj'));
  var sets = Array.prototype.slice.call(doc.querySelectorAll('.skillset'));
  var introEl = doc.getElementById('about'), skillsEl = doc.getElementById('skills');
  var introName = doc.querySelector('.intro__name');
  var rail = doc.getElementById('rail'), railLinks = rail ? Array.prototype.slice.call(rail.querySelectorAll('a')) : [];
  var progress = doc.getElementById('progress');
  var reduceMQ = win.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = win.matchMedia('(pointer: coarse)').matches;

  var CLUSTER_NAMES = ['PolicyPilot AI', 'SemiGit', 'ProvChain', 'InterviewIQ', 'ClasslyAI', 'Offline UPI Mesh', 'All-Ears',
    'Fisherman', 'LazyForm', 'Dispatch Load Balancer',
    'AI and ML systems', 'Backend and APIs', 'Frontend', 'Cloud and tools'];

  var CAPTIONS = {
    about: 'About 8,000 points in a three-dimensional space, each one a fragment of my work. The ten projects wind down a helix. Your cursor is a query: its nearest points light up.',
    work: 'Each shape is one project. Scroll and the points scatter, then settle into the next one.',
    skills: 'Skills sit in a column below the projects: a network, a database, a browser and a cloud.',
    contact: 'The end of the space. Write to me.'
  };
  // what each project's cluster is drawn as, in the order of the page
  var PROJECT_CAPTIONS = [
    'PolicyPilot AI, drawn as a policy document with a verified badge.',
    'SemiGit, drawn as a commit graph: two branches leave main and merge back.',
    'ProvChain, drawn as three blocks, each linked to the one before.',
    'InterviewIQ, drawn as a question and its answer.',
    'ClasslyAI, drawn as a graduation cap.',
    'Offline UPI Mesh, drawn as five phones passing a payment hand to hand.',
    'All-Ears, drawn as headphones listening to a waveform.',
    'Fisherman, drawn as a fish and the hook after it.',
    'LazyForm, drawn as a short form, filled in step by step.',
    'Dispatch Load Balancer, drawn as requests in, one balancer, four servers sharing the load.'
  ];

  var worker = null, scene = null;
  var W = 0, H = 0, DPR = 1;
  var docData = { marks: [], edge: 1e9 };

  function send(m, transfer) {
    if (worker) worker.postMessage(m, transfer || []);
    else if (scene) scene.handle(m);
  }

  /* ---------------------------------------------------------------- figure */
  function viewport() {
    W = canvas.clientWidth || win.innerWidth;
    H = canvas.clientHeight || win.innerHeight;
    DPR = Math.min(win.devicePixelRatio || 1, 2);
  }

  function initMessage(extra) {
    var m = { type: 'init', w: W, h: H, dpr: DPR, reduced: reduceMQ.matches, coarse: coarse, cores: navigator.hardwareConcurrency || 4 };
    for (var k in extra) m[k] = extra[k];
    return m;
  }

  function startWorker() {
    return new Promise(function (resolve, reject) {
      var off;
      try { off = canvas.transferControlToOffscreen(); } catch (e) { reject(e); return; }
      var w;
      try { w = new Worker('js/scene.js'); } catch (e) { reject(e); return; }
      var timer = setTimeout(function () { w.terminate(); reject(new Error('worker timeout')); }, 4000);
      w.onerror = function (e) { clearTimeout(timer); w.terminate(); reject(e); };
      w.onmessage = function (e) {
        var m = e.data;
        if (m.type === 'ready') { clearTimeout(timer); worker = w; resolve('worker'); }
        else if (m.type === 'error') { clearTimeout(timer); w.terminate(); reject(new Error(m.message)); }
        else if (m.type === 'stats') { win.__figure = Object.assign(win.__figure || {}, m); }
      };
      w.postMessage(initMessage({ canvas: off }), [off]);
    });
  }

  function startMain() {
    return new Promise(function (resolve, reject) {
      var s = doc.createElement('script');
      s.src = 'js/scene.js';
      s.onload = function () {
        try {
          scene = new win.FigureScene(canvas, initMessage({}), function (m) {
            if (m.type === 'stats') win.__figure = Object.assign(win.__figure || {}, m);
          });
          resolve('main');
        } catch (e) { reject(e); }
      };
      s.onerror = reject;
      doc.head.appendChild(s);
    });
  }

  function boot() {
    viewport();
    var canWorker = !!(win.Worker && win.OffscreenCanvas && canvas.transferControlToOffscreen);
    var first = canWorker ? startWorker() : Promise.reject(new Error('no offscreen'));
    first.catch(function () {
      // the canvas may have been transferred already; use a fresh element
      if (canWorker) {
        var fresh = canvas.cloneNode(false);
        canvas.parentNode.replaceChild(fresh, canvas);
        canvas = fresh;
      }
      return startMain();
    }).then(function (mode) {
      win.__figure = Object.assign(win.__figure || {}, { mode: mode });
      afterReady();
    }).catch(function (err) {
      // No figure: the page still works on plain paper.
      root.classList.add('is-ready');
      if (win.console) console.warn('Figure unavailable:', err);
    });
  }

  function afterReady() {
    measure();
    send({ type: 'scroll', y: win.scrollY });
    send({ type: 'start' });
    root.classList.add('is-ready');
    makeLabels().then(function (items) {
      var bitmaps = items.filter(Boolean).map(function (i) { return i.bitmap; });
      send({ type: 'labels', items: items }, worker ? bitmaps : []);
    });
  }

  /* Small tooltip-style labels, drawn here (fonts are available here) and handed to the figure as bitmaps. */
  function makeLabels() {
    if (!win.createImageBitmap) return Promise.resolve([]);
    var scale = DPR;
    return Promise.all(CLUSTER_NAMES.map(function (name) {
      var c = doc.createElement('canvas'), g = c.getContext('2d');
      var font = '600 15px "Bricolage Grotesque", Arial, sans-serif';
      g.font = font;
      var w = Math.ceil(g.measureText(name).width) + 34, h = 30;
      c.width = Math.round(w * scale); c.height = Math.round(h * scale);
      g.scale(scale, scale);
      g.fillStyle = 'rgba(233,235,240,0.97)';
      g.strokeStyle = 'rgba(44,62,245,0.7)';
      g.lineWidth = 1;
      g.fillRect(0.5, 0.5, w - 1, h - 1);
      g.strokeRect(0.5, 0.5, w - 1, h - 1);
      g.fillStyle = '#2C3EF5';
      g.fillRect(11, h / 2 - 3, 6, 6);
      g.fillStyle = '#101326';
      g.font = font; g.textBaseline = 'middle';
      g.fillText(name, 24, h / 2 + 0.5);
      return win.createImageBitmap(c).then(function (bm) { return { bitmap: bm, w: w, h: h }; });
    })).catch(function () { return []; });
  }

  /* ---------------------------------------------------------------- helpers */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function docTop(el) { return el.getBoundingClientRect().top + win.scrollY; }
  function num(v) { return Math.round(v * 1000) / 1000; }

  /* ---------------------------------------------------- text: line masks, fit */
  /* .rv text is split into its visual lines, and each line rises out of its own mask when it scrolls in. */
  var rvEls = Array.prototype.slice.call(doc.querySelectorAll('.rv'));
  var rvWidth = new Map();
  function splitLines(el) {
    var text = el.getAttribute('data-rv');
    if (text === null) { text = el.textContent.replace(/\s+/g, ' ').trim(); el.setAttribute('data-rv', text); }
    var words = text.split(' ');
    el.textContent = '';
    var ws = words.map(function (w, i) {
      var s = doc.createElement('span');
      s.textContent = w; s.style.display = 'inline-block';
      el.appendChild(s);
      if (i < words.length - 1) el.appendChild(doc.createTextNode(' '));
      return s;
    });
    var lines = [], top = null;
    ws.forEach(function (s, i) {
      var tp = s.offsetTop;
      if (top === null || Math.abs(tp - top) > 3) { lines.push([]); top = tp; }
      lines[lines.length - 1].push(words[i]);
    });
    el.textContent = '';
    lines.forEach(function (l, i) {
      var outer = doc.createElement('span'), inner = doc.createElement('span');
      outer.className = 'l'; outer.style.setProperty('--li', i);
      inner.textContent = l.join(' ');
      outer.appendChild(inner); el.appendChild(outer);
    });
    el.classList.add('is-split');
    rvWidth.set(el, el.clientWidth);
  }
  function prepareText(onlyIfNarrower) {
    rvEls.forEach(function (el) {
      if (onlyIfNarrower && rvWidth.get(el) === el.clientWidth) return;
      splitLines(el);
    });
    fitTitles();
  }

  /* Titles are set big and open from narrow to wide as you scroll. Measure each at its widest and shrink it, if it must, so it never reaches the stage. */
  function fitOne(el, scopeEl, varName, varVal, container) {
    el.style.setProperty('--fit', '1');
    var prev = scopeEl.style.getPropertyValue(varName);
    scopeEl.style.setProperty(varName, varVal);
    var widest = 0;
    Array.prototype.forEach.call(el.querySelectorAll('.line > span'), function (s) { widest = Math.max(widest, s.offsetWidth); });
    var cs = win.getComputedStyle(container);
    var avail = container.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (prev) scopeEl.style.setProperty(varName, prev); else scopeEl.style.removeProperty(varName);
    el.style.setProperty('--fit', widest > avail && widest > 0 ? String(num(avail / widest * 0.985)) : '1');
  }
  function fitTitles() {
    projs.forEach(function (p) {
      var el = p.querySelector('.proj__title'), inner = p.querySelector('.proj__inner');
      var wasOpen = p.classList.contains('is-open');
      if (wasOpen) p.classList.remove('is-open');
      fitOne(el, p, '--h', '1', inner);
      if (wasOpen) p.classList.add('is-open');
    });
    if (introName) fitOne(introName, introEl, '--np', '1', introName.parentNode);
  }

  if (win.IntersectionObserver) {
    var rvIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); rvIO.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -9% 0px' });
    rvEls.concat(introName ? [introName] : []).forEach(function (el) { rvIO.observe(el); });
  } else {
    rvEls.concat(introName ? [introName] : []).forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------------------------------------------------------------- layout */
  var geo = [];                 // per project scene: { top, hold, pin }
  var layout = { vh: 0, introTop: 0, introBottom: 0, workTop: 0, first: 0, last: 0 };
  var measureQueued = false;
  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    win.requestAnimationFrame(function () { measureQueued = false; measure(); });
  }

  function measure() {
    var vh = win.innerHeight, sy = win.scrollY;
    geo = projs.map(function (el) {
      var pin = el.querySelector('.proj__pin').offsetHeight;
      var z = reduceMQ.matches ? 0 : pin * 0.5;       // the swap between scenes (see --z in home.css)
      var hold = Math.max(1, el.offsetHeight - pin - z);
      var top = docTop(el);
      return { top: top, hold: hold, pin: pin, z: z, rest: top + (el === projs[0] ? 0 : z) };
    });
    layout.vh = vh;
        layout.introTop = docTop(introEl); layout.introBottom = layout.introTop + introEl.offsetHeight;
    layout.first = geo.length ? geo[0].top : 0;
    layout.last = geo.length ? geo[geo.length - 1].top + geo[geo.length - 1].hold + geo[geo.length - 1].z + geo[geo.length - 1].pin : 0;

    // Camera marks: [start, end] of the scroll range where the camera is parked on each station.
    // Between one park's end and the next one's start it flies. For the project scenes the park is
    // exactly the pinned range, so the camera arrives as the title finishes rising and leaves when the scene lets go.
    var m = [];
    m.push([0, Math.max(vh * 0.3, layout.introBottom - vh * 0.65)]);                                    // introduction, at the top of the page
    geo.forEach(function (g) { m.push([g.rest, g.top + g.hold]); });                                    // projects: parked after the swap
    var sT = docTop(skillsEl), sH = skillsEl.offsetHeight;
    m.push([sT - vh * 0.15, sT - vh * 0.15]);                                                           // skills, approaching
    m.push([sT + sH * 0.55 - vh * 0.5, sT + sH * 0.55 - vh * 0.5]);                                     // skills, at the ring
    docData.edge = docTop(contact);
    m.push([docData.edge - vh * 0.25, docData.edge - vh * 0.25]);                                       // contact
    for (var i = 0; i < m.length; i++) {
      if (m[i][1] < m[i][0]) m[i][1] = m[i][0];
      if (i > 0 && m[i][0] < m[i - 1][1] + 40) { m[i][0] = m[i - 1][1] + 40; if (m[i][1] < m[i][0]) m[i][1] = m[i][0]; }
    }
    docData.marks = m;
    send({ type: 'layout', marks: m, edge: docData.edge });
    win.__page = { marks: m, geo: geo, layout: layout };
    paint(true);
  }

  /* ----------------------------------------------------------------- scroll */
  var scrollQueued = false, lastInv = null, lastCapInv = null, lastCapOff = null;
  var cache = { prog: -1 };
  var et = [], xt = [], ev = [], xv = [], hv = [], sceneVals = [];   // target and shown entering/leaving per scene, and the last --h written
  var sceneRaf = 0, sceneLast = 0;
  /* the entering and leaving values run on a clock, not on the scroll: 0.95 s to come in, 0.7 s to go */
  function stepScenes(now) {
    sceneRaf = 0;
    var dt = sceneLast ? Math.min(0.05, (now - sceneLast) / 1000) : 0.016; sceneLast = now;
    var moving = false;
    for (var i = 0; i < projs.length; i++) {
      var e0 = ev[i] || 0, x0 = xv[i] || 0;
      var e1 = e0 < et[i] ? Math.min(et[i], e0 + dt / 0.95) : Math.max(et[i], e0 - dt / 0.6);
      var x1 = x0 < xt[i] ? Math.min(xt[i], x0 + dt / 0.7) : Math.max(xt[i], x0 - dt / 0.6);
      if (e1 !== e0 || x1 !== x0 || sceneVals[i] === undefined) {
        ev[i] = e1; xv[i] = x1; sceneVals[i] = 1;
        projs[i].style.setProperty('--e', e1.toFixed(4)); projs[i].style.setProperty('--x', x1.toFixed(4));
      }
      if (e1 !== et[i] || x1 !== xt[i]) moving = true;
    }
    if (moving) { sceneRaf = win.requestAnimationFrame(stepScenes); } else sceneLast = 0;
  }
  function kickScenes() {
    if (reduceMQ.matches) { stepScenes(performance.now()); return; }
    if (!sceneRaf) sceneRaf = win.requestAnimationFrame(stepScenes);
  }
  var current = -1, railOn = false;

  function setVar(el, name, v) { el.style.setProperty(name, v); }

  function paint(force) {
    var y = win.scrollY, vh = win.innerHeight;

    // nav colour and caption colour on the blue end of the page
    var inv = y + 36 > docData.edge;
    if (inv !== lastInv) { nav.classList.toggle('is-inv', inv); lastInv = inv; }
    var capInv = y + vh - 40 > docData.edge;
    if (capInv !== lastCapInv) { caption.classList.toggle('is-inv', capInv); lastCapInv = capInv; }
    // the footer line takes the bottom right at the very end of the page
    var capOff = y + vh > doc.documentElement.scrollHeight - 120;
    if (capOff !== lastCapOff) { caption.classList.toggle('is-off', capOff); lastCapOff = capOff; }

    // page progress line
    if (progress) {
      var maxY = Math.max(1, doc.documentElement.scrollHeight - vh);
      var pr = num(clamp(y / maxY, 0, 1));
      if (pr !== cache.prog) { progress.style.transform = 'scaleX(' + pr + ')'; cache.prog = pr; }
    }

    // Project scenes. Which one is being read is decided by where the page is, and the swap between scenes then plays
    // out in time, so stopping anywhere never leaves a title half-risen. Only --h (the rule filling) follows the scroll.
    var best = -1;
    for (var i = 0; i < geo.length; i++) {
      var g = geo[i];
      var from = i === 0 ? g.top - g.pin * 0.35 : geo[i - 1].top + geo[i - 1].hold + geo[i - 1].z * 0.5;
      var to = g.top + g.hold + g.z * 0.5;
      var on = y >= from && y < to;
      if (on) best = i;
      et[i] = y >= from ? 1 : 0;
      xt[i] = y >= to ? 1 : 0;
      var h = num(clamp((y - g.top) / g.hold, 0, 1));
      if (force || h !== hv[i]) { projs[i].style.setProperty('--h', h); hv[i] = h; }
    }
    if (reduceMQ.matches) { for (i = 0; i < geo.length; i++) { et[i] = 1; xt[i] = 0; ev[i] = 1; xv[i] = 0; } }
    kickScenes();
    if (best !== current) setCurrent(best);

    // the rail is on while a project is being read
    var on = best >= 0;
    if (on !== railOn && rail) { rail.classList.toggle('is-on', on); railOn = on; }
  }

  function projectName(i) { return CLUSTER_NAMES[i]; }
  function railLabel(i) { return (i + 1 < 10 ? '0' : '') + (i + 1) + ' / 10   ' + projectName(i); }
  function setCurrent(i) {
    var prev = current;
    current = i;
    projs.forEach(function (el, k) { el.classList.toggle('is-cur', k === i); });
    if (rail) {
      railLinks.forEach(function (a, k) {
        if (k === i) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        a.classList.toggle('is-past', i >= 0 && k < i);
      });
      if (i >= 0) rail.setAttribute('data-now', railLabel(i));
    }
    // a case left open stays with its scene: closing it as you move on keeps the camera from sitting in close on an old project
    if (prev >= 0 && projs[prev].classList.contains('is-open')) setOpen(projs[prev], false);
    if (i >= 0) setCaption('p' + i, PROJECT_CAPTIONS[i]);
    else setCaption(sectionKey);
  }

  win.addEventListener('scroll', function () {
    send({ type: 'scroll', y: win.scrollY });
    onScrollForFocus();
    if (!scrollQueued) {
      scrollQueued = true;
      win.requestAnimationFrame(function () { scrollQueued = false; paint(); });
    }
  }, { passive: true });

  var resizeQueued = false, resizeT = 0;
  win.addEventListener('resize', function () {
    if (!resizeQueued) {
      resizeQueued = true;
      win.requestAnimationFrame(function () {
        resizeQueued = false;
        viewport();
        send({ type: 'size', w: W, h: H, dpr: DPR });
        measure();
      });
    }
    clearTimeout(resizeT);
    resizeT = setTimeout(function () { prepareText(true); measure(); }, 160);
  });
  if (win.ResizeObserver) new ResizeObserver(queueMeasure).observe(doc.querySelector('main'));
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(function () { prepareText(true); queueMeasure(); });

  /* ---------------------------------------------------------------- pointer */
  var pend = false, px = 0, py = 0;
  win.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'touch') return;
    px = e.clientX; py = e.clientY;
    if (pend) return;
    pend = true;
    win.requestAnimationFrame(function () { pend = false; send({ type: 'pointer', x: px, y: py, on: true }); });
  }, { passive: true });
  root.addEventListener('mouseleave', function () { send({ type: 'pointer', x: -1, y: -1, on: false }); });
  win.addEventListener('blur', function () { send({ type: 'pointer', x: -1, y: -1, on: false }); });

  /* ------------------------------------------------- focus: cases and skills */
  /* Opening a project's case moves the camera in on its cluster. Hovering a skill group does the same for that group,
     but only once scrolling has been still for a moment: skill groups slide under a resting cursor while you scroll,
     and each would otherwise send the camera somewhere else mid-scroll. */
  var focusTimer = 0, focusSent = -1, caseFocus = -1;
  function sendFocus(i) { if (i === focusSent) return; focusSent = i; send({ type: 'focus', i: i }); }
  function setFocus(i) { clearTimeout(focusTimer); sendFocus(i); }
  function clearFocus() { clearTimeout(focusTimer); focusTimer = setTimeout(function () { if (caseFocus < 0) sendFocus(-1); }, 90); }

  var lastScrollAt = 0, settleTimer = 0, hoverEl = null, hoverIdx = -1;
  function scrolling() { return performance.now() - lastScrollAt < 170; }
  function hoverFocus(el, i) { hoverEl = el; hoverIdx = i; if (caseFocus < 0 && !scrolling()) setFocus(i); }
  function hoverBlur() { hoverEl = null; hoverIdx = -1; clearFocus(); }
  function onScrollForFocus() {
    lastScrollAt = performance.now();
    if (focusSent >= 0 && caseFocus < 0) { clearTimeout(focusTimer); sendFocus(-1); }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (caseFocus < 0 && hoverEl && hoverEl.matches(':hover')) setFocus(hoverIdx);
    }, 190);
  }
  sets.forEach(function (el) {
    var i = parseInt(el.getAttribute('data-i'), 10);
    el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') hoverFocus(el, i); });
    el.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hoverBlur(); });
  });

  /* ------------------------------------------------------------------- cases */
  function setOpen(proj, v) {
    var i = projs.indexOf(proj);
    proj.classList.toggle('is-open', v);
    var b = proj.querySelector('.proj__open');
    b.setAttribute('aria-expanded', v ? 'true' : 'false');
    if (!b._closed) b._closed = b.getAttribute('data-label');
    var label = v ? b.getAttribute('data-label-open') : b._closed;
    b.setAttribute('data-label', label);
    b.firstElementChild.textContent = label;
    if (v) { caseFocus = i; setFocus(i); }
    else if (caseFocus === i) { caseFocus = -1; clearTimeout(focusTimer); sendFocus(-1); }
  }
  projs.forEach(function (proj, i) {
    proj.querySelector('.proj__open').addEventListener('click', function () {
      var willOpen = !proj.classList.contains('is-open');
      projs.forEach(function (p) { if (p !== proj && p.classList.contains('is-open')) setOpen(p, false); });
      setOpen(proj, willOpen);
    });
    // reaching a scene by keyboard: bring it to its resting place so it is read, not half-risen
    proj.addEventListener('focusin', function () {
      var g = geo[i];
      if (!g) return;
      var y = win.scrollY;
      if (y < g.rest - 2 || y > g.top + g.hold + 2) win.scrollTo({ top: clamp(y, g.rest, g.top + g.hold), behavior: 'instant' });
    });
  });

  // the rail: hover names a project, click goes to its scene
  if (rail) {
    railLinks.forEach(function (a, k) {
      a.addEventListener('click', function (ev2) { if (geo[k]) { ev2.preventDefault(); win.scrollTo({ top: geo[k].rest }); } });
      a.addEventListener('pointerenter', function () { rail.setAttribute('data-now', railLabel(k)); });
      a.addEventListener('focus', function () { rail.setAttribute('data-now', railLabel(k)); });
      a.addEventListener('pointerleave', function () { if (current >= 0) rail.setAttribute('data-now', railLabel(current)); });
      a.addEventListener('blur', function () { if (current >= 0) rail.setAttribute('data-now', railLabel(current)); });
    });
  }

  // Deep links from the docs pages (index.html#p-semigit) land on the scene, at the point where its camera has just arrived.
  function openFromHash() {
    var h = win.location.hash;
    if (h.indexOf('#p-') !== 0) return;
    var el = doc.querySelector(h);
    var i = projs.indexOf(el);
    if (i >= 0 && geo[i]) win.scrollTo({ top: geo[i].rest, behavior: 'instant' });
  }

  /* ---------------------------------------------------------------- caption */
  var capText = caption.querySelector('.caption__t'), capKey = 'about', capTimer = 0, sectionKey = 'about';
  function setCaption(key, text) {
    var t = text || CAPTIONS[key];
    if (!t || key === capKey) return;
    capKey = key;
    caption.classList.add('is-swap');
    clearTimeout(capTimer);
    capTimer = setTimeout(function () { capText.textContent = t; caption.classList.remove('is-swap'); }, 190);
  }
  if (win.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        sectionKey = e.target.getAttribute('data-section');
        if (sectionKey !== 'work' || current < 0) setCaption(sectionKey);
      });
    }, { rootMargin: '-50% 0px -50% 0px' });
    doc.querySelectorAll('[data-section]').forEach(function (s) { io.observe(s); });
  }

  /* ---------------------------------------------------------- reduced motion */
  var onReduce = function (e) { send({ type: 'reduced', v: e.matches }); };
  if (reduceMQ.addEventListener) reduceMQ.addEventListener('change', onReduce);
  else if (reduceMQ.addListener) reduceMQ.addListener(onReduce);

  /* ------------------------------------------------------------------ start */
  function fontsThenBoot() {
    var done = false;
    function go() {
      if (done) return;
      done = true;
      prepareText(false);
      measure();
      openFromHash();
      paint(true);
      boot();
    }
    if (doc.fonts && doc.fonts.load) {
      Promise.all([doc.fonts.load('600 1em "Bricolage Grotesque"'), doc.fonts.load('1em Newsreader')]).then(go, go);
      setTimeout(go, 1800);
    } else go();
  }
  fontsThenBoot();
})();
