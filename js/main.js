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

  window.addEventListener("scroll", function () {
    nav.classList.toggle("is-solid", window.scrollY > 40);
  }, { passive: true });

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

  function initStars() {
    stars = [];
    for (var i = 0; i < 120; i++) {
      stars.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 1.2 + 0.2,
        v: Math.random() * 0.15 + 0.03,
        a: Math.random() * 0.7 + 0.2,
        tw: Math.random() * 0.02
      });
    }
  }

  function drawStars() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      s.y -= s.v;
      if (s.y < -2) { s.y = canvas.height + 2; s.x = Math.random() * canvas.width; }
      s.a += (Math.random() - 0.5) * s.tw * 10;
      if (s.a < 0.1) s.a = 0.1;
      if (s.a > 0.9) s.a = 0.9;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255," + s.a.toFixed(2) + ")";
      ctx.fill();
    }
    if (starfieldRunning) rafId = requestAnimationFrame(drawStars);
  }

  sizeCanvas();
  initStars();
  window.addEventListener("resize", function () { sizeCanvas(); initStars(); });

  if (!reducedMotion) {
    new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !starfieldRunning) {
          starfieldRunning = true;
          drawStars();
        } else if (!entry.isIntersecting && starfieldRunning) {
          starfieldRunning = false;
          cancelAnimationFrame(rafId);
        }
      });
    }).observe(canvas);
  } else {
    drawStars(); // single static frame
  }

  /* ---------------------------------------------------------------------
     HERO — headline decode/typing effect
  --------------------------------------------------------------------- */
  var heroTitle = document.getElementById("heroTitle");
  var heroText = heroTitle.textContent;
  if (!reducedMotion) {
    heroTitle.textContent = "";
    var caret = document.createElement("span");
    caret.className = "caret";
    caret.innerHTML = "&nbsp;";
    heroTitle.appendChild(caret);
    var idx = 0;
    (function typeHero() {
      if (idx <= heroText.length) {
        heroTitle.textContent = heroText.slice(0, idx);
        heroTitle.appendChild(caret);
        idx++;
        setTimeout(typeHero, 38);
      } else {
        setTimeout(function () { caret.remove(); }, 2500);
      }
    })();
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
  }, { threshold: 0.12 });
  document.querySelectorAll(".reveal").forEach(function (el) { revealObserver.observe(el); });

  /* ---------------------------------------------------------------------
     STAT COUNTERS
  --------------------------------------------------------------------- */
  var statsEl = document.getElementById("stats");
  function animateCount(el) {
    var target = parseInt(el.dataset.count, 10);
    var suffix = el.dataset.suffix || "";
    if (reducedMotion) { el.textContent = target.toLocaleString() + suffix; return; }
    var start = null;
    var dur = 1600;
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

})();
