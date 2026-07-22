/* ==========================================================================
   YASHSINGH CHAUHAN — PORTFOLIO
   Vanilla JS: nav, starfield, scroll reveals, stat counters, project demos
   ========================================================================== */
(function () {
  "use strict";

  var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------------------------------------------------------------
     NAV — solid background on scroll + mobile hamburger
  --------------------------------------------------------------------- */
  var nav = document.getElementById("nav");
  var burger = document.getElementById("navBurger");
  var navLinks = document.getElementById("navLinks");

  var scrollbar = document.getElementById("scrollbar");
  var toTop = document.getElementById("toTop");
  var heroInner = document.querySelector(".hero__inner");
  var ticking = false;

  function onScroll() {
    var y = window.scrollY;
    nav.classList.toggle("is-solid", y > 40);
    // scroll progress hairline
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollbar) scrollbar.style.width = (max > 0 ? (y / max) * 100 : 0) + "%";
    // back-to-top visibility
    if (toTop) toTop.classList.toggle("is-visible", y > window.innerHeight * 0.8);
    // hero parallax: content drifts up slower + fades as you scroll past
    if (heroInner && !reducedMotion && y < window.innerHeight) {
      heroInner.style.transform = "translateY(" + y * 0.25 + "px)";
      heroInner.style.opacity = String(Math.max(0, 1 - y / (window.innerHeight * 0.85)));
    }
    ticking = false;
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });

  if (toTop) {
    toTop.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
    });
  }

  burger.addEventListener("click", function () {
    var open = navLinks.classList.toggle("is-open");
    burger.classList.toggle("is-open", open);
    burger.setAttribute("aria-expanded", String(open));
  });
  navLinks.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      navLinks.classList.remove("is-open");
      burger.classList.remove("is-open");
      burger.setAttribute("aria-expanded", "false");
    }
  });

  /* ---------------------------------------------------------------------
     HERO — canvas starfield (paused off-screen / reduced motion)
  --------------------------------------------------------------------- */
  var canvas = document.getElementById("starfield");
  var ctx = canvas.getContext("2d");
  var stars = [];
  var starfieldRunning = false;
  var rafId = null;

  function sizeCanvas() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }

  // "Depth Telemetry" — stars carry a z-depth; deeper stars are smaller,
  // slower, and drift less under mouse parallax. Rare meteors streak through.
  var mouseX = 0.5, mouseY = 0.5;
  var meteors = [];
  var meteorTimer = 0;

  document.addEventListener("mousemove", function (e) {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  }, { passive: true });

  function initStars() {
    stars = [];
    for (var i = 0; i < 150; i++) {
      var z = Math.random() * 0.85 + 0.15; // depth: 0.15 (far) → 1 (near)
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        z: z,
        r: z * 1.4 + 0.2,
        v: z * 0.18 + 0.02,
        a: Math.random() * 0.6 + 0.15,
        tw: Math.random() * 0.02
      });
    }
  }

  function spawnMeteor() {
    meteors.push({
      x: Math.random() * canvas.width * 0.8 + canvas.width * 0.2,
      y: -10,
      vx: -(Math.random() * 3 + 4),
      vy: Math.random() * 2.5 + 3.5,
      life: 1
    });
  }

  // Scroll-velocity warp: fast scrolling stretches stars into hyperspace
  // streaks; easing back to points when you stop. Scroll also parallaxes
  // each depth layer, so the page travels *through* the field.
  var lastScrollY = window.scrollY;
  var warp = 0; // smoothed scroll velocity

  function drawStars() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    var px = (mouseX - 0.5) * 36;
    var py = (mouseY - 0.5) * 24;
    var sy = window.scrollY;
    warp += ((sy - lastScrollY) - warp) * 0.22; // smooth velocity, quick response
    lastScrollY = sy;
    var h = canvas.height;
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y -= s.v;
      if (s.y < -2) { s.y = h + 2; s.x = Math.random() * canvas.width; }
      s.a += (Math.random() - 0.5) * s.tw * 10;
      if (s.a < 0.1) s.a = 0.1;
      if (s.a > 0.9) s.a = 0.9;
      // screen position: base drift + mouse parallax + scroll parallax (wrapped)
      var yy = (s.y - sy * s.z * 0.22) % h;
      if (yy < 0) yy += h;
      var xx = s.x - px * s.z;
      var alpha = s.a * s.z + 0.08;
      var streak = warp * s.z * 1.1;
      if (streak > 2 || streak < -2) {
        // hyperspace streak, capped for sanity
        if (streak > 44) streak = 44;
        if (streak < -44) streak = -44;
        var grad2 = ctx.createLinearGradient(xx, yy, xx, yy + streak);
        grad2.addColorStop(0, "rgba(255,255,255," + alpha.toFixed(2) + ")");
        grad2.addColorStop(1, "rgba(255,255,255,0)");
        ctx.strokeStyle = grad2;
        ctx.lineWidth = s.r;
        ctx.beginPath();
        ctx.moveTo(xx, yy);
        ctx.lineTo(xx, yy + streak);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(xx, yy, s.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(255,255,255," + alpha.toFixed(2) + ")";
        ctx.fill();
      }
    }
    // meteors: spawn roughly every 6–12 seconds
    meteorTimer -= 1;
    if (meteorTimer <= 0) { spawnMeteor(); meteorTimer = 360 + Math.random() * 360; }
    for (var m = meteors.length - 1; m >= 0; m--) {
      var mt = meteors[m];
      mt.x += mt.vx; mt.y += mt.vy; mt.life -= 0.012;
      if (mt.life <= 0 || mt.y > canvas.height + 20) { meteors.splice(m, 1); continue; }
      var grad = ctx.createLinearGradient(mt.x, mt.y, mt.x - mt.vx * 12, mt.y - mt.vy * 12);
      grad.addColorStop(0, "rgba(255,255,255," + (0.7 * mt.life).toFixed(2) + ")");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(mt.x, mt.y);
      ctx.lineTo(mt.x - mt.vx * 12, mt.y - mt.vy * 12);
      ctx.stroke();
    }
    if (starfieldRunning) rafId = requestAnimationFrame(drawStars);
  }

  sizeCanvas();
  initStars();
  window.addEventListener("resize", function () { sizeCanvas(); initStars(); });

  if (!reducedMotion) {
    // The field is a fixed full-page backdrop now — run always,
    // pause only when the tab is hidden.
    starfieldRunning = true;
    drawStars();
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && starfieldRunning) {
        starfieldRunning = false;
        cancelAnimationFrame(rafId);
      } else if (!document.hidden && !starfieldRunning) {
        starfieldRunning = true;
        lastScrollY = window.scrollY; // avoid a warp spike on return
        drawStars();
      }
    });
  } else {
    drawStars(); // single static frame
  }

  /* ---------------------------------------------------------------------
     HERO — orchestrated boot: eyebrow → headline decode → sub → CTA,
     then the telemetry readout starts cycling. The one signature moment.
  --------------------------------------------------------------------- */
  var heroTitle = document.getElementById("heroTitle");
  var heroText = heroTitle.textContent;
  var bootEls = document.querySelectorAll(".hero .boot-el");
  var GLYPHS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#/<>_\\";

  function scrambleDecode(el, text, done) {
    var revealed = 0;
    var total = text.length;
    var iv = setInterval(function () {
      revealed += 1;
      var out = "";
      for (var i = 0; i < total; i++) {
        var ch = text[i];
        if (i < revealed || ch === " ") {
          out += ch;
        } else if (i < revealed + 7) {
          out += '<span class="scramble">' + GLYPHS[Math.floor(Math.random() * GLYPHS.length)] + "</span>";
        } else {
          out += "&nbsp;";
        }
      }
      el.innerHTML = out;
      if (revealed >= total) { clearInterval(iv); el.textContent = text; if (done) done(); }
    }, 22);
  }

  // Telemetry readout (bottom-left cockpit corner)
  var tlText = document.getElementById("tlText");
  var TL_MSGS = [
    "T+00:00:02 · retrieval index online",
    "agents 4/4 · consensus nominal",
    "inference local · zero cloud dependency",
    "latency 3.2s · was 4 hours manual",
    "mesh packet relayed · ttl 5",
    "all systems nominal"
  ];
  function startTelemetry() {
    if (!tlText) return;
    if (reducedMotion) { tlText.textContent = TL_MSGS[TL_MSGS.length - 1]; return; }
    var mi = 0;
    (function nextMsg() {
      typeText(tlText, TL_MSGS[mi], 26, function () {
        mi = (mi + 1) % TL_MSGS.length;
        setTimeout(nextMsg, 2600);
      });
    })();
  }

  if (reducedMotion) {
    bootEls.forEach(function (el) { el.classList.add("is-in"); });
    startTelemetry();
  } else {
    // 1. eyebrow
    setTimeout(function () { bootEls[0] && bootEls[0].classList.add("is-in"); }, 150);
    // 2. headline decodes
    setTimeout(function () {
      scrambleDecode(heroTitle, heroText, function () {
        // 3. sub + CTA cascade in
        bootEls[1] && bootEls[1].classList.add("is-in");
        setTimeout(function () { bootEls[2] && bootEls[2].classList.add("is-in"); }, 110);
        // 4. telemetry begins
        setTimeout(startTelemetry, 300);
      });
    }, 380);
  }

  /* ---------------------------------------------------------------------
     WORD-MASK HEADINGS — wrap each word of section headings so it can
     slide out of its own clip on reveal
  --------------------------------------------------------------------- */
  if (!reducedMotion) {
    document.querySelectorAll("main .display-xl, main .display-lg").forEach(function (h) {
      var words = h.textContent.trim().split(/\s+/);
      h.innerHTML = words.map(function (w, i) {
        return '<span class="w-mask"><span style="--d:' + (i * 0.045).toFixed(3) + 's">' + w + "</span></span>";
      }).join(" ");
    });
  }

  /* ---------------------------------------------------------------------
     SCROLL REVEALS
  --------------------------------------------------------------------- */
  var revealObserver = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.04, rootMargin: "0px 0px -4% 0px" });
  document.querySelectorAll(".reveal").forEach(function (el) { revealObserver.observe(el); });

  /* ---------------------------------------------------------------------
     NAV SCROLL-SPY — underline the section currently in view
  --------------------------------------------------------------------- */
  var spyLinks = document.querySelectorAll('.nav__links a[href^="#"]');
  spyLinks.forEach(function (link) {
    var target = document.querySelector(link.getAttribute("href"));
    if (!target) return;
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          spyLinks.forEach(function (l) { l.classList.remove("is-active"); });
          link.classList.add("is-active");
        }
      });
    }, { rootMargin: "-40% 0px -55% 0px" }).observe(target);
  });

  /* ---------------------------------------------------------------------
     AMBIENT DRONE — generative Interstellar-style organ pad, synthesized
     live with WebAudio. Opt-in via the sound toggle (autoplay-safe).
  --------------------------------------------------------------------- */
  var soundBtn = document.getElementById("soundToggle");
  var audioCtx = null, masterGain = null, droneOscs = [], chordTimer = null;
  // Slow progression of open fifths/octaves rooted low — Am → F → C → G
  var CHORDS = [
    [55.0, 110.0, 164.81, 220.0, 329.63],   // A1 A2 E3 A3 E4
    [43.65, 87.31, 130.81, 174.61, 261.63], // F1 F2 C3 F3 C4
    [65.41, 130.81, 196.0, 261.63, 392.0],  // C2 C3 G3 C4 G4
    [49.0, 98.0, 146.83, 196.0, 293.66]     // G1 G2 D3 G3 D4
  ];
  var chordIdx = 0;

  function startDrone() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    var now = audioCtx.currentTime;

    masterGain = audioCtx.createGain();
    masterGain.gain.setValueAtTime(0.0001, now);
    masterGain.gain.exponentialRampToValueAtTime(0.055, now + 4); // slow fade-in

    var filter = audioCtx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(680, now);
    filter.Q.value = 0.4;

    // breathing swell on the whole pad
    var lfo = audioCtx.createOscillator();
    var lfoGain = audioCtx.createGain();
    lfo.frequency.value = 0.06; // ~16s breath cycle
    lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain);
    lfoGain.connect(masterGain.gain);
    lfo.start(now);

    filter.connect(masterGain);
    masterGain.connect(audioCtx.destination);

    droneOscs = [{ osc: lfo, gain: null }];
    CHORDS[0].forEach(function (freq, i) {
      var osc = audioCtx.createOscillator();
      var g = audioCtx.createGain();
      osc.type = i < 2 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now);
      osc.detune.value = (Math.random() - 0.5) * 7; // slight organ chorus
      g.gain.value = i < 2 ? 0.5 : 0.16; // low end carries, uppers whisper
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      droneOscs.push({ osc: osc, gain: g });
    });

    // glide the pad to the next chord every 22 seconds
    chordIdx = 0;
    chordTimer = setInterval(function () {
      chordIdx = (chordIdx + 1) % CHORDS.length;
      var t = audioCtx.currentTime;
      CHORDS[chordIdx].forEach(function (freq, i) {
        var node = droneOscs[i + 1];
        if (node && node.osc.frequency) {
          node.osc.frequency.exponentialRampToValueAtTime(freq, t + 7); // 7s glide
        }
      });
    }, 22000);
  }

  function stopDrone() {
    if (!audioCtx) return;
    clearInterval(chordTimer);
    var now = audioCtx.currentTime;
    if (masterGain) {
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value || 0.05, now);
      masterGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.5);
    }
    var oscs = droneOscs.slice();
    setTimeout(function () {
      oscs.forEach(function (n) { try { n.osc.stop(); } catch (e) {} });
    }, 1700);
    droneOscs = [];
  }

  if (soundBtn) {
    var soundOn = false;
    soundBtn.addEventListener("click", function () {
      soundOn = !soundOn;
      soundBtn.classList.toggle("is-playing", soundOn);
      soundBtn.setAttribute("aria-pressed", String(soundOn));
      if (soundOn) startDrone(); else stopDrone();
    });
  }

  /* ---------------------------------------------------------------------
     TARGETING RETICLE — lagging crosshair ring that inverts over content
  --------------------------------------------------------------------- */
  var reticle = document.getElementById("reticle");
  if (reticle && !reducedMotion && window.matchMedia("(hover: hover)").matches) {
    var rX = window.innerWidth / 2, rY = window.innerHeight / 2;
    var tX = rX, tY = rY;
    document.addEventListener("mousemove", function (e) {
      tX = e.clientX; tY = e.clientY;
      reticle.classList.add("is-on");
    }, { passive: true });
    document.addEventListener("mouseover", function (e) {
      reticle.classList.toggle("is-hover", !!(e.target.closest && e.target.closest("a, button")));
    });
    document.addEventListener("mouseleave", function () { reticle.classList.remove("is-on"); });
    (function reticleLoop() {
      rX += (tX - rX) * 0.32;
      rY += (tY - rY) * 0.32;
      reticle.style.transform = "translate(" + rX + "px," + rY + "px) translate(-50%,-50%)";
      requestAnimationFrame(reticleLoop);
    })();
  } else if (reticle) {
    reticle.style.display = "none";
  }

  /* ---------------------------------------------------------------------
     3D GLASS TILT — demo panels rotate toward the cursor with a
     specular glare that tracks the pointer
  --------------------------------------------------------------------- */
  if (!reducedMotion && window.matchMedia("(hover: hover)").matches) {
    document.querySelectorAll(".demo").forEach(function (panel) {
      var glare = document.createElement("div");
      glare.className = "demo__glare";
      panel.appendChild(glare);
      var pending = false;
      // While the cursor moves, the panel follows with zero transition lag —
      // the smooth ease only kicks in on exit. Reads as high-refresh-rate.
      panel.addEventListener("mouseenter", function () {
        panel.style.transition = "transform 0.06s linear, border-color 0.25s ease, box-shadow 0.25s ease";
      });
      panel.addEventListener("mousemove", function (e) {
        if (pending) return;
        pending = true;
        requestAnimationFrame(function () {
          var r = panel.getBoundingClientRect();
          var nx = (e.clientX - r.left) / r.width;
          var ny = (e.clientY - r.top) / r.height;
          panel.style.transform =
            "rotateY(" + ((nx - 0.5) * 5).toFixed(2) + "deg)" +
            " rotateX(" + ((0.5 - ny) * 5).toFixed(2) + "deg)" +
            " translateY(-4px)";
          glare.style.background =
            "radial-gradient(circle at " + (nx * 100).toFixed(1) + "% " + (ny * 100).toFixed(1) +
            "%, rgba(255,255,255,0.09), transparent 55%)";
          pending = false;
        });
      });
      panel.addEventListener("mouseleave", function () {
        panel.style.transition = ""; // restore the stylesheet ease for the return
        panel.style.transform = "";
        glare.style.background = "none";
      });
    });
  }

  /* ---------------------------------------------------------------------
     MAGNETIC BUTTONS — ghost pills lean toward the cursor
  --------------------------------------------------------------------- */
  if (!reducedMotion && window.matchMedia("(hover: hover)").matches) {
    document.querySelectorAll(".btn-ghost").forEach(function (btn) {
      btn.addEventListener("mouseenter", function () {
        btn.style.transition = "background 0.15s ease, color 0.15s ease, transform 0.05s linear";
      });
      btn.addEventListener("mousemove", function (e) {
        var r = btn.getBoundingClientRect();
        var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        btn.style.transform = "translate(" + dx * 4 + "px," + dy * 3 + "px)";
      });
      btn.addEventListener("mouseleave", function () {
        btn.style.transition = "";
        btn.style.transform = "";
      });
    });
  }

  /* ---------------------------------------------------------------------
     STAT COUNTERS
  --------------------------------------------------------------------- */
  var statsEl = document.getElementById("stats");
  function animateCount(el) {
    var target = parseInt(el.dataset.count, 10);
    var suffix = el.dataset.suffix || "";
    if (reducedMotion) { el.textContent = target.toLocaleString() + suffix; return; }
    var start = null;
    var dur = 900;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased).toLocaleString() + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  new IntersectionObserver(function (entries, obs) {
    if (entries[0].isIntersecting) {
      statsEl.querySelectorAll(".stat__num").forEach(animateCount);
      obs.disconnect();
    }
  }, { threshold: 0.4 }).observe(statsEl);

  /* ---------------------------------------------------------------------
     DEMO HELPERS
  --------------------------------------------------------------------- */
  // Sequentially append lines (HTML strings) into a container with delays.
  function playLines(container, lines, done) {
    container.innerHTML = "";
    var i = 0;
    function next() {
      if (i >= lines.length) { if (done) done(); return; }
      var line = lines[i++];
      var div = document.createElement("div");
      div.innerHTML = line.html;
      container.appendChild(div);
      setTimeout(next, reducedMotion ? 0 : (line.delay || 350));
    }
    next();
  }

  // Type text into an element character by character.
  function typeText(el, text, speed, done) {
    if (reducedMotion) { el.textContent = text; if (done) done(); return; }
    el.textContent = "";
    var i = 0;
    (function tick() {
      if (i <= text.length) {
        el.textContent = text.slice(0, i++);
        setTimeout(tick, speed);
      } else if (done) { done(); }
    })();
  }

  // Register a demo that starts when scrolled into view, then loops.
  function registerDemo(rootSelector, run, loopDelay) {
    var root = document.querySelector(rootSelector);
    if (!root) return;
    var playing = false;
    function cycle() {
      run(function () {
        setTimeout(function () { if (playing) cycle(); }, loopDelay || 5000);
      });
    }
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !playing) { playing = true; cycle(); }
      });
    }, { threshold: 0.35 }).observe(root);
  }

  /* ---------------------------------------------------------------------
     DEMO 1 — PolicyPilot AI: claims adjudication terminal
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="policypilot"]', function (done) {
    var screen = document.getElementById("demoPolicy");
    playLines(screen, [
      { html: '<span class="t-dim">$</span> policypilot adjudicate --claim CLM-88412', delay: 600 },
      { html: '<span class="t-dim">→</span> OCR extraction .............. <span class="t-ok">done</span>', delay: 450 },
      { html: '<span class="t-dim">→</span> Retrieving policy clauses (FAISS) ... <span class="t-ok">37 hits</span>', delay: 500 },
      { html: '<span class="t-dim">→</span> §4.2.1 Water damage — dwelling ....... <span class="t-ok">match 0.94</span>', delay: 380 },
      { html: '<span class="t-dim">→</span> §7.1.3 Exclusion: gradual seepage .... match 0.41', delay: 380 },
      { html: '<span class="t-dim">→</span> Knowledge graph traversal ..... <span class="t-ok">3 rules fired</span>', delay: 450 },
      { html: '<span class="t-dim">→</span> Multi-agent consensus ......... <span class="t-ok">4/4 agree</span>', delay: 500 },
      { html: '<span class="t-stamp">APPROVED — CONFIDENCE 96%</span>', delay: 400 },
      { html: '<span class="t-dim">elapsed: 3.2s (was: ~4 hours manual)</span>', delay: 300 }
    ], done);
  }, 5500);

  /* ---------------------------------------------------------------------
     DEMO 2 — SemiGit: diff → conventional commit
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="semigit"]', function (done) {
    var screen = document.getElementById("demoSemigit");
    playLines(screen, [
      { html: '<span class="t-dim">$</span> semigit generate', delay: 600 },
      { html: '<span class="t-dim">diff — src/auth/session.py</span>', delay: 400 },
      { html: '<span class="t-del">-  token = issue_token(user)</span>', delay: 300 },
      { html: '<span class="t-add">+  token = issue_token(user, refresh=True)</span>', delay: 300 },
      { html: '<span class="t-add">+  schedule_rotation(token, ttl=900)</span>', delay: 400 },
      { html: '<span class="t-dim">→</span> AST semantic analysis ........ <span class="t-ok">done</span>', delay: 450 },
      { html: '<span class="t-dim">→</span> Provider: ollama/llama3 <span class="t-dim">(offline)</span>', delay: 450 },
      { html: '&nbsp;', delay: 200 }
    ], function () {
      var line = document.createElement("div");
      line.className = "t-ok";
      screen.appendChild(line);
      typeText(line, "feat(auth): add refresh tokens with 15-min rotation", 26, function () {
        var tail = document.createElement("div");
        tail.innerHTML = '<span class="t-dim">✓ conventional commit ready — press enter to apply</span>';
        screen.appendChild(tail);
        done();
      });
    });
  }, 6000);

  /* ---------------------------------------------------------------------
     DEMO 3 — ProvChain: risk scan + dial
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="provchain"]', function (done) {
    var files = document.getElementById("scanFiles");
    var dial = document.getElementById("dialFill");
    var num = document.getElementById("dialNum");
    dial.style.strokeDashoffset = 326.7;
    num.textContent = "0";
    playLines(files, [
      { html: '<span class="t-dim">scanning</span> api/handlers.py ......... clean', delay: 380 },
      { html: '<span class="t-dim">scanning</span> utils/crypto.py <span class="flag">⚠ CVE-2024-3094</span>', delay: 450 },
      { html: '<span class="t-dim">scanning</span> models/loader.py ........ clean', delay: 380 },
      { html: '<span class="t-dim">scanning</span> deps/requests.lock <span class="flag">⚠ CVSS 8.1</span>', delay: 450 },
      { html: '<span class="t-dim">drift</span> vs. origin baseline ....... 12.4%', delay: 400 },
      { html: '<span class="t-dim">semantic similarity check ..... done</span>', delay: 400 }
    ], function () {
      // Risk 72/100 → dial fill
      var target = 72;
      dial.style.strokeDashoffset = String(326.7 * (1 - target / 100));
      if (reducedMotion) {
        num.textContent = String(target);
      } else {
        var v = 0;
        var iv = setInterval(function () {
          v += 2;
          if (v >= target) { v = target; clearInterval(iv); }
          num.textContent = String(v);
        }, 40);
      }
      done();
    });
  }, 6000);

  /* ---------------------------------------------------------------------
     DEMO 4 — InterviewIQ: Q → streamed answer → evaluation bars
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="interviewiq"]', function (done) {
    var q = document.getElementById("iqQuestion");
    var a = document.getElementById("iqAnswer");
    var bars = [
      { el: document.getElementById("barClarity"), w: 88 },
      { el: document.getElementById("barDepth"), w: 74 },
      { el: document.getElementById("barRelevance"), w: 93 }
    ];
    bars.forEach(function (b) { b.el.style.width = "0"; });
    a.textContent = "";
    typeText(q, "Your API latency doubled after a deploy. Walk me through your debugging process.", 18, function () {
      setTimeout(function () {
        typeText(a, "I'd start with the deploy diff, then compare p50 vs p99 to isolate whether it's uniform or tail latency — check connection pooling, N+1 queries introduced by the change, and roll back if the metrics confirm…", 12, function () {
          bars.forEach(function (b) { b.el.style.width = b.w + "%"; });
          done();
        });
      }, reducedMotion ? 0 : 500);
    });
  }, 6500);

  /* ---------------------------------------------------------------------
     DEMO 5 — ClasslyAI: enrollment counters, quiz bars, Stripe tick
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="classlyai"]', function (done) {
    var e1 = document.getElementById("lmsEnroll1");
    var e2 = document.getElementById("lmsEnroll2");
    var b1 = document.getElementById("lmsBar1");
    var b2 = document.getElementById("lmsBar2");
    var payState = document.getElementById("lmsPayState");
    b1.style.width = "0"; b2.style.width = "0";
    payState.textContent = "PROCESSING…";

    function tickCounter(el, target, cb) {
      if (reducedMotion) { el.textContent = target + " enrolled"; if (cb) cb(); return; }
      var v = 0;
      var iv = setInterval(function () {
        v += Math.ceil(target / 30);
        if (v >= target) { v = target; clearInterval(iv); if (cb) cb(); }
        el.textContent = v + " enrolled";
      }, 45);
    }
    tickCounter(e1, 1284);
    tickCounter(e2, 967, function () {
      b1.style.width = "82%";
      b2.style.width = "67%";
      setTimeout(function () {
        payState.textContent = "SUCCESS ✓";
        done();
      }, reducedMotion ? 0 : 1200);
    });
  }, 6000);

  /* ---------------------------------------------------------------------
     DEMO 6 — Offline UPI Mesh: packet hop, TTL, settle
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="upimesh"]', function (done) {
    var packet = document.getElementById("meshPacket");
    var ttlEl = document.getElementById("meshTTL");
    var stateEl = document.getElementById("meshState");
    var nodes = document.querySelectorAll(".mesh__node");
    var route = document.querySelector(".mesh__route");
    var states = [
      "ENCRYPTING — RSA + AES-GCM",
      "GOSSIP RELAY — PEER 1",
      "GOSSIP RELAY — PEER 2",
      "BRIDGE ONLINE — UPLINK",
      "SETTLED ✓"
    ];
    var hop = 0;
    nodes.forEach(function (n) { n.classList.remove("is-active"); });

    function positionPacket(i) {
      var node = nodes[i];
      var left = node.offsetLeft + node.offsetWidth / 2 - 4;
      packet.style.left = left + "px";
    }
    positionPacket(0);
    nodes[0].classList.add("is-active");
    ttlEl.textContent = "TTL 5";
    stateEl.textContent = states[0];

    function nextHop() {
      hop++;
      if (hop >= nodes.length) { done(); return; }
      positionPacket(hop);
      nodes[hop].classList.add("is-active");
      ttlEl.textContent = "TTL " + (5 - hop);
      stateEl.textContent = states[hop];
      setTimeout(nextHop, reducedMotion ? 0 : 1100);
    }
    setTimeout(nextHop, reducedMotion ? 0 : 1100);
  }, 5000);

  /* ---------------------------------------------------------------------
     DEMO 7 — All-Ears: now-playing player with queue
  --------------------------------------------------------------------- */
  registerDemo('[data-demo="allears"]', function (done) {
    var eq = document.getElementById("aeEq");
    var track = document.getElementById("aeTrack");
    var artist = document.getElementById("aeArtist");
    var progress = document.getElementById("aeProgress");
    var time = document.getElementById("aeTime");
    var queue = [
      document.getElementById("aeQ1"),
      document.getElementById("aeQ2"),
      document.getElementById("aeQ3")
    ];
    var status = document.getElementById("aeStatus");
    var upNext = ["Midnight Static — Nova Lane", "Paper Planes — Kite Theory", "Low Orbit — Delta Waves"];

    eq.classList.remove("is-playing");
    progress.style.width = "0";
    time.textContent = "0:00";
    queue.forEach(function (q) { q.textContent = ""; });
    status.textContent = "ROLE: LISTENER — QUEUE · SHUFFLE · REPEAT";

    typeText(track, "Gravity Falls", 34, function () {
      typeText(artist, "Aizen Hado", 34, function () {
        eq.classList.add("is-playing");
        // queue items appear one by one
        var qi = 0;
        (function nextQ() {
          if (qi < queue.length) {
            queue[qi].textContent = upNext[qi];
            qi++;
            setTimeout(nextQ, reducedMotion ? 0 : 350);
          }
        })();
        // progress 0 → 100 over ~4.5s with a running clock (3:42 track)
        if (reducedMotion) {
          progress.style.width = "100%";
          time.textContent = "3:42";
          done();
          return;
        }
        var p = 0;
        var iv = setInterval(function () {
          p += 1;
          progress.style.width = p + "%";
          var secs = Math.round(222 * p / 100);
          time.textContent = Math.floor(secs / 60) + ":" + String(secs % 60).padStart(2, "0");
          if (p >= 100) {
            clearInterval(iv);
            eq.classList.remove("is-playing");
            status.textContent = "UP NEXT: MIDNIGHT STATIC — AUTOPLAY IN 3…";
            done();
          }
        }, 45);
      });
    });
  }, 5500);

})();
