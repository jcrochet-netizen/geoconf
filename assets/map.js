/* ============================================================================
   GeoConf — moteur de carte
   Projection Web Mercator. Les tracés sont projetés une seule fois dans
   l'espace Mercator ; le pan/zoom n'est ensuite qu'une transformation affine
   appliquée au <g> racine, ce qui reste fluide même avec ~16 000 points.
   ========================================================================== */
(function (global) {
  'use strict';

  var D2R = Math.PI / 180, R2D = 180 / Math.PI;
  var EARTH_KM = 6371.0088;

  function mercY(lat) {
    var l = Math.max(-85, Math.min(85, lat));
    return Math.log(Math.tan(Math.PI / 4 + l * D2R / 2)) * R2D;
  }
  function invMercY(y) {
    return (2 * Math.atan(Math.exp(y * D2R)) - Math.PI / 2) * R2D;
  }

  /** Distance orthodromique en kilomètres. */
  function haversine(a, b) {
    var p1 = a.lat * D2R, p2 = b.lat * D2R;
    var dp = (b.lat - a.lat) * D2R, dl = (b.lon - a.lon) * D2R;
    var h = Math.sin(dp / 2) * Math.sin(dp / 2) +
            Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
    return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  /** Points intermédiaires le long du grand cercle a→b. */
  function greatCircle(a, b, n) {
    var p1 = a.lat * D2R, l1 = a.lon * D2R, p2 = b.lat * D2R, l2 = b.lon * D2R;
    var d = 2 * Math.asin(Math.min(1, Math.sqrt(
      Math.pow(Math.sin((p2 - p1) / 2), 2) +
      Math.cos(p1) * Math.cos(p2) * Math.pow(Math.sin((l2 - l1) / 2), 2))));
    var out = [];
    if (d < 1e-9) return [a, b];
    for (var i = 0; i <= n; i++) {
      var f = i / n;
      var A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
      var x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2);
      var y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2);
      var z = A * Math.sin(p1) + B * Math.sin(p2);
      out.push({ lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * R2D, lon: Math.atan2(y, x) * R2D });
    }
    return out;
  }

  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(name, attrs) {
    var n = document.createElementNS(SVGNS, name);
    for (var k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

  /* ------------------------------------------------------------------ */

  function GeoMap(svg, opts) {
    opts = opts || {};
    this.svg = svg;
    this.onPick = opts.onPick || function () {};
    this.homeBox = opts.homeBox || { w: -26, e: 82, s: 29, n: 71 };
    this.maxZoom = opts.maxZoom || 80;
    this.padding = opts.padding == null ? 8 : opts.padding;

    this.W = 1; this.H = 1;
    this.k = 1; this.cx = 0; this.cy = 0;
    this.locked = false;
    this.markers = [];   // { lat, lon, kind, label }
    this.link = null;    // { from, to }
    this._anim = null; this._glide = null; this._target = null; this._frame = null;

    this.gWorld = el('g', { class: 'm-world' });
    this.gLand = el('g', { class: 'm-land' });
    this.gOverlay = el('g', { class: 'm-overlay' });
    this.gWorld.appendChild(this.gLand);
    svg.appendChild(this.gWorld);
    svg.appendChild(this.gOverlay);

    this._bindPointer();
    this._watchSize();
  }

  /* La carte se recale sur toute variation de taille du conteneur — fenêtre
     redimensionnée, mais aussi iframe qui ajuste sa hauteur. */
  GeoMap.prototype._watchSize = function () {
    if (!window.ResizeObserver) return;
    var self = this, queued = false;
    new ResizeObserver(function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { queued = false; if (self.dataBox) self.resize(); });
    }).observe(this.svg);
  }

  GeoMap.prototype.setGeo = function (features) {
    var frag = document.createDocumentFragment();
    var bx = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (var i = 0; i < features.length; i++) {
      var f = features[i], d = '';
      for (var r = 0; r < f.r.length; r++) {
        var ring = f.r[r];
        for (var p = 0; p < ring.length; p++) {
          var x = ring[p][0], y = mercY(ring[p][1]);
          if (x < bx.minX) bx.minX = x; if (x > bx.maxX) bx.maxX = x;
          if (y < bx.minY) bx.minY = y; if (y > bx.maxY) bx.maxY = y;
          d += (p ? 'L' : 'M') + x.toFixed(3) + ' ' + y.toFixed(3);
        }
        d += 'Z';
      }
      frag.appendChild(el('path', { d: d, 'vector-effect': 'non-scaling-stroke' }));
    }
    this.gLand.appendChild(frag);
    this.dataBox = bx;
    this.resize();
    this.home(false);
    return this;
  };

  /* ---- conversions ---- */
  GeoMap.prototype.toScreen = function (lon, lat) {
    return { x: (lon - this.cx) * this.k + this.W / 2,
             y: this.H / 2 - (mercY(lat) - this.cy) * this.k };
  };
  GeoMap.prototype.toLonLat = function (x, y) {
    return { lon: (x - this.W / 2) / this.k + this.cx,
             lat: invMercY((this.H / 2 - y) / this.k + this.cy) };
  };

  /* ---- cadrage ---- */
  GeoMap.prototype._fitK = function (box) {
    var dx = box.e - box.w, dy = mercY(box.n) - mercY(box.s);
    var pw = Math.max(40, this.W - this.padding * 2), ph = Math.max(40, this.H - this.padding * 2);
    return Math.min(pw / dx, ph / dy);
  };
  GeoMap.prototype.home = function (animate) {
    this._stopGlide();
    var b = this.homeBox;
    this.minK = this._fitK(b);
    this._to({ k: this.minK, cx: (b.w + b.e) / 2, cy: (mercY(b.s) + mercY(b.n)) / 2 }, animate ? 480 : 0);
  };
  GeoMap.prototype.fitPoints = function (pts, animate, padPx) {
    if (!pts.length) return;
    this._stopGlide();
    var w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
    pts.forEach(function (p) {
      w = Math.min(w, p.lon); e = Math.max(e, p.lon);
      s = Math.min(s, p.lat); n = Math.max(n, p.lat);
    });
    var mx = Math.max(1.6, (e - w) * 0.45), my = Math.max(1.2, (n - s) * 0.45);
    var box = { w: w - mx, e: e + mx, s: Math.max(-84, s - my), n: Math.min(84, n + my) };
    var save = this.padding; this.padding = padPx == null ? 46 : padPx;
    var k = Math.min(this._fitK(box), this.minK * this.maxZoom);
    this.padding = save;
    this._to({ k: k, cx: (box.w + box.e) / 2, cy: (mercY(box.s) + mercY(box.n)) / 2 }, animate ? 620 : 0);
  };

  GeoMap.prototype._clamp = function (st) {
    st.k = Math.max(this.minK, Math.min(this.minK * this.maxZoom, st.k));
    var b = this.dataBox;
    if (!b) return st;
    var hw = this.W / 2 / st.k, hh = this.H / 2 / st.k;
    st.cx = (b.maxX - b.minX) < hw * 2 ? (b.minX + b.maxX) / 2
          : Math.max(b.minX + hw, Math.min(b.maxX - hw, st.cx));
    st.cy = (b.maxY - b.minY) < hh * 2 ? (b.minY + b.maxY) / 2
          : Math.max(b.minY + hh, Math.min(b.maxY - hh, st.cy));
    return st;
  };

  GeoMap.prototype._to = function (target, ms) {
    var self = this;
    if (this._anim) { cancelAnimationFrame(this._anim); this._anim = null; }
    this._clamp(target);
    if (!ms) { this.k = target.k; this.cx = target.cx; this.cy = target.cy; return this.render(); }
    var from = { k: this.k, cx: this.cx, cy: this.cy }, t0 = performance.now();
    // interpolation logarithmique sur l'échelle : le zoom paraît linéaire
    var lk0 = Math.log(from.k), lk1 = Math.log(target.k);
    (function step(t) {
      var f = Math.min(1, (t - t0) / ms), e = easeInOut(f);
      self.k = Math.exp(lk0 + (lk1 - lk0) * e);
      self.cx = from.cx + (target.cx - from.cx) * e;
      self.cy = from.cy + (target.cy - from.cy) * e;
      self.render();
      if (f < 1) self._anim = requestAnimationFrame(step); else self._anim = null;
    })(t0);
  };

  /* Le zoom glisse vers une cible au lieu d'y sauter. Chaque cran de molette
     déplace la cible, la vue la rejoint image par image : les crans rapides se
     composent au lieu de se combattre, et les boutons s'animent sans code de
     plus. 0,26 par image ≈ 250 ms pour arriver, assez vif pour rester réactif. */
  var GLIDE = 0.26;

  GeoMap.prototype._applyZoom = function (k, sx, sy) {
    var before = this.toLonLat(sx, sy), beforeY = mercY(before.lat);
    var st = this._clamp({ k: k, cx: this.cx, cy: this.cy });
    st.cx = before.lon - (sx - this.W / 2) / st.k;      // le point sous le curseur ne bouge pas
    st.cy = beforeY - (this.H / 2 - sy) / st.k;
    this._to(st, 0);
  };

  GeoMap.prototype._stopGlide = function () {
    if (this._glide) { cancelAnimationFrame(this._glide); this._glide = null; }
    this._target = null;
  };

  /** direct = true pour le pincement tactile, déjà continu par nature. */
  GeoMap.prototype.zoomTo = function (k, sx, sy, direct) {
    if (sx == null) { sx = this.W / 2; sy = this.H / 2; }
    k = Math.max(this.minK, Math.min(this.minK * this.maxZoom, k));
    if (direct) { this._stopGlide(); return this._applyZoom(k, sx, sy); }
    this._target = { k: k, sx: sx, sy: sy };
    if (this._glide) return;
    var self = this;
    this._glide = requestAnimationFrame(function step() {
      var t = self._target;
      if (!t) { self._glide = null; return; }
      var d = Math.log(t.k) - Math.log(self.k);
      if (Math.abs(d) < 0.0015) { self._applyZoom(t.k, t.sx, t.sy); self._stopGlide(); return; }
      self._applyZoom(Math.exp(Math.log(self.k) + d * GLIDE), t.sx, t.sy);
      self._glide = requestAnimationFrame(step);
    });
  };

  GeoMap.prototype.zoomBy = function (factor, sx, sy) {
    // On compose sur la cible en cours, pas sur la vue : sinon deux crans
    // rapprochés s'annulent en partie.
    var base = (this._glide && this._target) ? this._target.k : this.k;
    this.zoomTo(base * factor, sx, sy);
  };

  GeoMap.prototype.resize = function () {
    var r = this.svg.getBoundingClientRect();
    this.W = Math.max(1, r.width); this.H = Math.max(1, r.height);
    this.svg.setAttribute('viewBox', '0 0 ' + this.W + ' ' + this.H);
    var b = this.homeBox;
    var nk = this._fitK(b);
    var wasHome = this.minK && Math.abs(this.k - this.minK) < 1e-6;
    this.minK = nk;
    if (wasHome || !this.k) this.home(false); else this._to({ k: this.k, cx: this.cx, cy: this.cy }, 0);
  };

  /* ---- rendu ---- */
  GeoMap.prototype.render = function () {
    // Un rendu par image au maximum : la molette peut émettre plus d'événements
    // que l'écran n'affiche d'images.
    var self = this;
    if (this._frame) return;
    this._frame = requestAnimationFrame(function () { self._frame = null; self._paint(); });
  };

  GeoMap.prototype._paint = function () {
    this.gWorld.setAttribute('transform',
      'translate(' + (this.W / 2) + ',' + (this.H / 2) + ') scale(' + this.k + ',' + (-this.k) +
      ') translate(' + (-this.cx) + ',' + (-this.cy) + ')');
    this._drawOverlay();
    if (this.onView) this.onView(this.k / this.minK);
  };

  GeoMap.prototype._drawOverlay = function () {
    var g = this.gOverlay;
    while (g.firstChild) g.removeChild(g.firstChild);

    if (this.link) {
      var pts = greatCircle(this.link.from, this.link.to, 64).map(function (p) {
        var s = this.toScreen(p.lon, p.lat); return s.x.toFixed(1) + ',' + s.y.toFixed(1);
      }, this).join(' ');
      g.appendChild(el('polyline', { class: 'm-link', points: pts }));
    }

    for (var i = 0; i < this.markers.length; i++) {
      var m = this.markers[i], s = this.toScreen(m.lon, m.lat);
      var mg = el('g', { class: 'm-mk m-mk-' + m.kind, transform: 'translate(' + s.x.toFixed(1) + ',' + s.y.toFixed(1) + ')' });
      if (m.kind === 'truth') {
        mg.appendChild(el('circle', { class: 'm-halo', r: 16 }));
        mg.appendChild(el('circle', { class: 'm-ring', r: 9 }));
        mg.appendChild(el('circle', { class: 'm-core', r: 4 }));
      } else {
        mg.appendChild(el('circle', { class: 'm-shadow', r: 7, cy: 1 }));
        mg.appendChild(el('circle', { class: 'm-core', r: 6 }));
        mg.appendChild(el('circle', { class: 'm-dot', r: 2.2 }));
      }
      if (m.label) {
        var t = el('text', { class: 'm-label', y: m.kind === 'truth' ? -20 : -16 });
        t.textContent = m.label;
        mg.appendChild(t);
      }
      g.appendChild(mg);
    }
  };

  GeoMap.prototype.setMarkers = function (list) { this.markers = list || []; this._drawOverlay(); };
  GeoMap.prototype.setLink = function (l) { this.link = l; this._drawOverlay(); };
  GeoMap.prototype.clear = function () { this.markers = []; this.link = null; this._drawOverlay(); };

  /* ---- interactions ---- */
  GeoMap.prototype._bindPointer = function () {
    var self = this, svg = this.svg;
    var pts = new Map(), down = null, moved = false, pinch = null;

    function local(e) {
      var r = svg.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    svg.addEventListener('pointerdown', function (e) {
      if (self.locked) return;
      self._stopGlide();
      svg.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, local(e));
      if (pts.size === 1) { down = { p: local(e), t: performance.now(), cx: self.cx, cy: self.cy }; moved = false; }
      else if (pts.size === 2) {
        var a = [].concat(Array.from(pts.values()));
        pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), k: self.k };
        moved = true;
      }
      svg.classList.add('is-grabbing');
    });

    svg.addEventListener('pointermove', function (e) {
      if (!pts.has(e.pointerId) || self.locked) return;
      pts.set(e.pointerId, local(e));
      if (pts.size >= 2 && pinch) {
        var a = Array.from(pts.values());
        var d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
        if (pinch.d > 4) self.zoomTo(pinch.k * (d / pinch.d), (a[0].x + a[1].x) / 2, (a[0].y + a[1].y) / 2, true);
        return;
      }
      if (!down) return;
      var p = local(e), dx = p.x - down.p.x, dy = p.y - down.p.y;
      if (!moved && Math.hypot(dx, dy) > 4) moved = true;
      if (!moved) return;
      self._to({ k: self.k, cx: down.cx - dx / self.k, cy: down.cy + dy / self.k }, 0);
    });

    function end(e) {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      svg.classList.remove('is-grabbing');
      if (pts.size === 0 && down) {
        var quick = performance.now() - down.t < 600;
        if (!moved && quick && !self.locked) {
          var p = local(e);
          self.onPick(self.toLonLat(p.x, p.y), p);
        }
        down = null;
      }
    }
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);

    svg.addEventListener('wheel', function (e) {
      if (self.locked) return;
      e.preventDefault();
      var p = local(e);
      var d = e.deltaY;
      if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 400;
      // Un cran de molette vaut ~100, un pavé tactile 1 à 10. On borne pour que
      // le premier n'emporte pas tout, et on répond plus fort au pincement d'un
      // pavé tactile, que le navigateur signale par ctrlKey.
      d = Math.max(-70, Math.min(70, d));
      self.zoomBy(Math.exp(-d * (e.ctrlKey ? 0.020 : 0.0075)), p.x, p.y);
    }, { passive: false });

    svg.addEventListener('dblclick', function (e) {
      if (self.locked) return;
      var p = local(e); self.zoomBy(2.2, p.x, p.y);
    });
  };

  global.GeoMap = GeoMap;
  global.geoUtil = { haversine: haversine, mercY: mercY, invMercY: invMercY };
})(window);
