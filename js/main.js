/* ============================================================================
   main.js — everything on the page that isn't the figure.
   Starts the figure (in a Worker when possible), feeds it scroll, pointer and
   layout, and runs the project rows, the caption and the nav colour.
   ========================================================================== */
(function () {
  'use strict';

  var doc = document, root = doc.documentElement, win = window;
  var canvas = doc.getElementById('figure');
  var nav = doc.getElementById('nav');
  var caption = doc.getElementById('caption');
  var contact = doc.getElementById('contact');
  var rows = Array.prototype.slice.call(doc.querySelectorAll('.row'));
  var sets = Array.prototype.slice.call(doc.querySelectorAll('.skillset'));
  var reduceMQ = win.matchMedia('(prefers-reduced-motion: reduce)');
  var coarse = win.matchMedia('(pointer: coarse)').matches;

  var CLUSTER_NAMES = ['PolicyPilot AI', 'SemiGit', 'ProvChain', 'InterviewIQ', 'ClasslyAI', 'Offline UPI Mesh', 'All-Ears',
    'Fisherman', 'LazyForm', 'Dispatch Load Balancer',
    'AI and ML systems', 'Backend and APIs', 'Frontend', 'Cloud and tools'];

  var CAPTIONS = {
    hero: 'More than 10,000 points in a three-dimensional space, each one a fragment of my work. Your cursor is a query: its nearest points light up.',
    work: 'Each cluster is one project, and its shape follows what the project does: a graph, a tree, a drift, a mesh.',
    about: 'The same space from the side. The projects wind down a helix.',
    skills: 'Skills sit in four clusters below the projects.',
    contact: 'The end of the space. Write to me.'
  };

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

  /* ---------------------------------------------------------------- layout */
  var measureQueued = false;
  function queueMeasure() {
    if (measureQueued) return;
    measureQueued = true;
    win.requestAnimationFrame(function () { measureQueued = false; measure(); });
  }

  function docTop(el) { return el.getBoundingClientRect().top + win.scrollY; }

  function measure() {
    var vh = win.innerHeight, sy = win.scrollY;
    var marks = [0];
    rows.forEach(function (row) {
      var r = row.querySelector('.row__head').getBoundingClientRect();
      marks.push(r.top + sy + r.height / 2 - vh * 0.5);
    });
    var about = doc.getElementById('about'), skills = doc.getElementById('skills');
    marks.push(docTop(about) + Math.min(about.offsetHeight * 0.4, 520) - vh * 0.5);
    marks.push(docTop(skills) - vh * 0.1);
    marks.push(docTop(skills) + skills.offsetHeight * 0.55 - vh * 0.5);
    docData.edge = docTop(contact);
    marks.push(docData.edge - vh * 0.25);
    for (var i = 1; i < marks.length; i++) if (marks[i] < marks[i - 1] + 60) marks[i] = marks[i - 1] + 60;
    docData.marks = marks;
    send({ type: 'layout', marks: marks, edge: docData.edge });
    paintChrome();
  }

  /* ----------------------------------------------------------------- scroll */
  var scrollQueued = false, lastInv = null, lastCapInv = null;
  function paintChrome() {
    var y = win.scrollY;
    var inv = y + 36 > docData.edge;
    if (inv !== lastInv) { nav.classList.toggle('is-inv', inv); lastInv = inv; }
    var capInv = y + win.innerHeight - 40 > docData.edge;
    if (capInv !== lastCapInv) { caption.classList.toggle('is-inv', capInv); lastCapInv = capInv; }
  }
  win.addEventListener('scroll', function () {
    send({ type: 'scroll', y: win.scrollY });
    onScrollForFocus();
    if (!scrollQueued) {
      scrollQueued = true;
      win.requestAnimationFrame(function () { scrollQueued = false; paintChrome(); });
    }
  }, { passive: true });

  var resizeQueued = false;
  win.addEventListener('resize', function () {
    if (resizeQueued) return;
    resizeQueued = true;
    win.requestAnimationFrame(function () {
      resizeQueued = false;
      viewport();
      send({ type: 'size', w: W, h: H, dpr: DPR });
      measure();
    });
  });
  if (win.ResizeObserver) new ResizeObserver(queueMeasure).observe(doc.querySelector('main'));
  if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(queueMeasure);

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

  /* ------------------------------------------------- focus: rows and skills */
  var focusTimer = 0, focusSent = -1;
  function sendFocus(i) { if (i === focusSent) return; focusSent = i; send({ type: 'focus', i: i }); }
  function setFocus(i) { clearTimeout(focusTimer); sendFocus(i); }
  function clearFocus() { clearTimeout(focusTimer); focusTimer = setTimeout(function () { sendFocus(-1); }, 90); }

  /* Rows and skill groups slide under a resting cursor while you scroll. Each one would fire a hover and send
     the camera off to a different cluster mid-scroll, which reads as erratic motion. So hover focus is held back
     until scrolling has been still for a moment, and only applied if the cursor is still over that element. */
  var lastScrollAt = 0, settleTimer = 0, hoverEl = null, hoverIdx = -1;
  function scrolling() { return performance.now() - lastScrollAt < 170; }
  function hoverFocus(el, i) { hoverEl = el; hoverIdx = i; if (!scrolling()) setFocus(i); }
  function hoverBlur() { hoverEl = null; hoverIdx = -1; clearFocus(); }
  function onScrollForFocus() {
    lastScrollAt = performance.now();
    if (focusSent >= 0 && !(doc.activeElement && doc.activeElement.classList && doc.activeElement.classList.contains('row__head'))) {
      clearTimeout(focusTimer); sendFocus(-1);
    }
    clearTimeout(settleTimer);
    settleTimer = setTimeout(function () {
      if (hoverEl && hoverEl.matches(':hover')) setFocus(hoverIdx);
    }, 190);
  }

  rows.forEach(function (row, i) {
    var head = row.querySelector('.row__head');
    row.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') hoverFocus(row, i); });
    row.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hoverBlur(); });
    head.addEventListener('focus', function () { setFocus(i); });
    head.addEventListener('blur', clearFocus);
    head.addEventListener('click', function () { toggle(row); });
  });
  sets.forEach(function (el) {
    var i = parseInt(el.getAttribute('data-i'), 10);
    el.addEventListener('pointerenter', function (e) { if (e.pointerType !== 'touch') hoverFocus(el, i); });
    el.addEventListener('pointerleave', function (e) { if (e.pointerType !== 'touch') hoverBlur(); });
  });

  function setOpen(row, v) {
    row.classList.toggle('is-open', v);
    row.querySelector('.row__head').setAttribute('aria-expanded', v ? 'true' : 'false');
  }
  function toggle(row) {
    var willOpen = !row.classList.contains('is-open');
    rows.forEach(function (r) { setOpen(r, false); });
    if (!willOpen) return;
    setOpen(row, true);
    setTimeout(function () {
      var r = row.getBoundingClientRect(), vh = win.innerHeight, nav = 80;
      var behavior = reduceMQ.matches ? 'auto' : 'smooth';
      if (r.bottom > vh - 20) win.scrollBy({ top: Math.min(r.bottom - vh + 40, r.top - nav - 8), behavior: behavior });
      else if (r.top < nav) win.scrollBy({ top: r.top - nav - 8, behavior: behavior });
    }, reduceMQ.matches ? 0 : 640);
  }

  // Deep links from the docs pages (index.html#p-semigit) open the row.
  function openFromHash() {
    var h = win.location.hash;
    if (h.indexOf('#p-') !== 0) return;
    var row = doc.querySelector(h);
    if (row && row.classList.contains('row')) {
      setOpen(row, true);
      row.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }

  /* ---------------------------------------------------------------- caption */
  var capText = caption.querySelector('.caption__t'), capKey = 'hero', capTimer = 0;
  function setCaption(key) {
    if (!CAPTIONS[key] || key === capKey) return;
    capKey = key;
    caption.classList.add('is-swap');
    clearTimeout(capTimer);
    capTimer = setTimeout(function () { capText.textContent = CAPTIONS[key]; caption.classList.remove('is-swap'); }, 190);
  }
  if (win.IntersectionObserver) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setCaption(e.target.getAttribute('data-section')); });
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
    function go() { if (done) return; done = true; openFromHash(); boot(); }
    if (doc.fonts && doc.fonts.load) {
      Promise.all([doc.fonts.load('600 1em "Bricolage Grotesque"'), doc.fonts.load('1em Newsreader')]).then(go, go);
      setTimeout(go, 1800);
    } else go();
  }
  fontsThenBoot();
})();
