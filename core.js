/* PLANTFINC core: geometría, normativa y generación de la matriz arbolada.
   Sin dependencias de DOM; se puede probar con node. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PF = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var R = 6378137, RAD = Math.PI / 180;

  // group: euc | frond | resto  (pino = conífera -> distancias "resto")
  var SPECIES = {
    nitens:   { name: 'Eucalipto nitens',   group: 'euc',   kind: 'euc',   color: '#1e88e5' },
    globulus: { name: 'Eucalipto globulus', group: 'euc',   kind: 'euc',   color: '#8e24aa' },
    castano:  { name: 'Castaño',            group: 'frond', kind: 'frond', color: '#ef6c00' },
    roble:    { name: 'Roble',              group: 'frond', kind: 'frond', color: '#6d4c41' },
    abedul:   { name: 'Abedul',             group: 'frond', kind: 'frond', color: '#fdd835' },
    olmo:     { name: 'Olmo',               group: 'frond', kind: 'frond', color: '#00897b' },
    pino:     { name: 'Pino pinaster',      group: 'resto', kind: 'conif', color: '#e91e63' },
    radiata:  { name: 'Pino insigne (radiata)', group: 'resto', kind: 'conif', color: '#7cb342' }
  };

  // Distancias mínimas (m). fr = frondosas Anexo I Lei 7/2012; resto = eucalipto, pino y demás.
  // Fuente: Lei 7/2012 de montes de Galicia, art. 68 y anexo II (ver pestaña Normativa).
  var LINDEROS = {
    libre:       { label: 'Propio / sin restricción',                 fr: 0,  resto: 0,  color: '#9e9e9e' },
    forestal:    { label: 'Parcela forestal vecina',                  fr: 2,  resto: 2,  color: '#2e7d32' },
    agricola:    { label: 'Labradío / prado / cultivo vecino',        fr: 4,  resto: 10, color: '#fbc02d' },
    agropec:     { label: 'Rústico esp. protección agropecuaria',     fr: 10, resto: 10, color: '#f57f17' },
    carretera:   { label: 'Carretera / autovía (desde dom. público)', fr: 4,  resto: 10, color: '#455a64' },
    ferrocarril: { label: 'Ferrocarril (desde dom. público)',         fr: 4,  resto: 10, color: '#000000' },
    camino:      { label: 'Pista forestal / camino',                  fr: 2,  resto: 4,  color: '#8d6e63' },
    rio:         { label: 'Río > 2 m (desde dom. público)',           fr: 5,  resto: 15, color: '#1976d2' },
    vivienda:    { label: 'Vivienda / núcleo rural / suelo urbano',   fr: 15, resto: 50, color: '#d32f2f' },
    industrial:  { label: 'Camping / gasolinera / industria peligrosa', fr: 15, resto: 50, color: '#6a1b9a' }
  };

  var CONCELLOS = {
    abegondo: { name: 'Abegondo',    ferrado: 436 },
    oza:      { name: 'Oza-Cesuras', ferrado: null },
    curtis:   { name: 'Curtis',      ferrado: null },
    aranga:   { name: 'Aranga',      ferrado: null }
  };

  function defaultNorm() {
    var n = {};
    Object.keys(LINDEROS).forEach(function (k) { n[k] = { fr: LINDEROS[k].fr, resto: LINDEROS[k].resto }; });
    return n;
  }

  function groupKey(sp) { return SPECIES[sp].group === 'frond' ? 'fr' : 'resto'; }

  function defaultEdge(tipo) { return { tipo: tipo || 'forestal', vecino: null, franja: false, especie: 'castano' }; }

  function ensureEdges(finca) {
    var n = finca.ring.length;
    if (!finca.edges) finca.edges = [];
    while (finca.edges.length < n) finca.edges.push(defaultEdge());
    finca.edges.length = n;
  }

  /* ---------- geometría ---------- */
  function centroidLL(ring) {
    var sx = 0, sy = 0;
    ring.forEach(function (p) { sx += p[0]; sy += p[1]; });
    return [sx / ring.length, sy / ring.length];
  }

  function makeProj(lng0, lat0) {
    var kx = R * RAD * Math.cos(lat0 * RAD), ky = R * RAD;
    return {
      toXY: function (lng, lat) { return [(lng - lng0) * kx, (lat - lat0) * ky]; },
      toLL: function (x, y) { return [lng0 + x / kx, lat0 + y / ky]; }
    };
  }

  function areaXY(poly) {
    var a = 0;
    for (var i = 0; i < poly.length; i++) {
      var p = poly[i], q = poly[(i + 1) % poly.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return Math.abs(a) / 2;
  }

  function inPoly(x, y, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function distSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    var t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  function stats(ring) {
    var c = centroidLL(ring), pj = makeProj(c[0], c[1]);
    var xy = ring.map(function (p) { return pj.toXY(p[0], p[1]); });
    var per = 0, lens = [];
    for (var i = 0; i < xy.length; i++) {
      var q = xy[(i + 1) % xy.length];
      var l = Math.hypot(q[0] - xy[i][0], q[1] - xy[i][1]);
      lens.push(l); per += l;
    }
    return { area: areaXY(xy), perimeter: per, lengths: lens };
  }

  /* ---------- preparación y generación ---------- */
  function prepare(finca, norm) {
    norm = norm || defaultNorm();
    var c = centroidLL(finca.ring), pj = makeProj(c[0], c[1]);
    var toXY = function (p) { return pj.toXY(p[0], p[1]); };
    var cache = {};
    var prep = {
      pj: pj,
      ring: finca.ring.map(toXY),
      edges: finca.edges,
      excl: (finca.exclusions || []).map(function (e) {
        return { kind: e.kind, pts: e.coords.map(toXY), buf: +e.buffer || 0 };
      }),
      zones: (finca.subzonas || []).map(function (z) { return { sp: z.sp, pts: z.coords.map(toXY) }; }),
      anchor: finca.params && finca.params.anchor ? toXY(finca.params.anchor) : [0, 0]
    };
    // distancia mínima efectiva en el lindero i para la especie sp
    prep.sb = function (i, sp) {
      var key = i + '|' + sp;
      if (cache[key] !== undefined) return cache[key];
      var e = finca.edges[i];
      var t = norm[e.tipo] || LINDEROS[e.tipo] || LINDEROS.forestal;
      var base = +t[groupKey(sp)];
      var v = (e.vecino === null || e.vecino === '' || e.vecino === undefined) ? null : +e.vecino;
      // distancia del vecino si es mayor o igual al mínimo legal; si no, el mínimo legal
      var val = (v !== null && !isNaN(v) && v >= base) ? v : base;
      cache[key] = val;
      return val;
    };
    return prep;
  }

  // Devuelve una función ev(x,y) → especie plantable en ese punto, o null (fuera, excluido o dentro de la distancia legal).
  function makeEval(prep, finca, over) {
    var P = {}, k;
    for (k in finca.params) P[k] = finca.params[k];
    if (over) for (k in over) P[k] = over[k];
    var sx = +P.sx, sy = +P.sy;
    var ring = prep.ring, n = ring.length, edges = prep.edges;
    var core = P.core, nRows = Math.max(0, +P.rows || 0), rowsDepth = nRows * Math.min(sx, sy);
    var depth = [], i;
    for (i = 0; i < n; i++) {
      var e = edges[i];
      depth.push(e.franja && nRows > 0 ? prep.sb(i, e.especie) + rowsDepth : -1);
    }
    var sbCore = [], sbEsp = {};
    for (i = 0; i < n; i++) sbCore.push(prep.sb(i, core));
    var d = new Array(n);
    return function (x, y) {
      if (!inPoly(x, y, ring)) return null;
      if (prep.slopeFn && prep.slopeMax > 0 && prep.slopeFn(x, y) > prep.slopeMax) return null;
      var q;
      for (q = 0; q < prep.excl.length; q++) {
        var ex = prep.excl[q];
        if (ex.kind === 'line') {
          for (var m = 0; m + 1 < ex.pts.length; m++) {
            if (distSeg(x, y, ex.pts[m][0], ex.pts[m][1], ex.pts[m + 1][0], ex.pts[m + 1][1]) < ex.buf) return null;
          }
        } else if (inPoly(x, y, ex.pts)) return null;
      }
      for (q = 0; q < n; q++) {
        var b = ring[(q + 1) % n];
        d[q] = distSeg(x, y, ring[q][0], ring[q][1], b[0], b[1]);
      }
      var sp = null;
      for (q = 0; q < prep.zones.length; q++) {
        if (inPoly(x, y, prep.zones[q].pts)) { sp = prep.zones[q].sp; break; }
      }
      if (!sp) {
        var best = -1, bd = Infinity;
        for (q = 0; q < n; q++) {
          if (depth[q] >= 0 && d[q] < depth[q] && d[q] < bd) { bd = d[q]; best = q; }
        }
        sp = best >= 0 ? edges[best].especie : core;
      }
      for (q = 0; q < n; q++) {
        var need = sp === core ? sbCore[q] : prep.sb(q, sp);
        if (d[q] < need) return null;
      }
      return sp;
    };
  }

  function generate(prep, finca, over, countOnly) {
    var P = {}, k;
    for (k in finca.params) P[k] = finca.params[k];
    if (over) for (k in over) P[k] = over[k];
    var sx = +P.sx, sy = +P.sy;
    var tres = P.pattern === 'tres', syE = tres ? sx * 0.8660254 : sy, vp = tres ? 2 * syE : syE, off = tres ? sx / 2 : 0;
    var th = (+P.angle || 0) * RAD, c = Math.cos(th), s = Math.sin(th);
    var shU = +P.shU || 0, shV = +P.shV || 0;
    var ox = prep.anchor[0], oy = prep.anchor[1];
    var ring = prep.ring, n = ring.length;
    var umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, i, j;
    for (i = 0; i < n; i++) {
      var dx = ring[i][0] - ox, dy = ring[i][1] - oy;
      var u = dx * c + dy * s, v = -dx * s + dy * c;
      if (u < umin) umin = u; if (u > umax) umax = u;
      if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    var i0 = Math.ceil((umin - shU - off) / sx), i1 = Math.floor((umax - shU) / sx);
    var j0 = Math.ceil((vmin - shV) / syE), j1 = Math.floor((vmax - shV) / syE);
    var ev = makeEval(prep, finca, over);
    var trees = [], counts = {}, total = 0;
    for (i = i0; i <= i1; i++) {
      for (j = j0; j <= j1; j++) {
        var uu = i * sx + shU + (off && (j & 1) ? off : 0), vv = j * syE + shV;
        var x = ox + uu * c - vv * s, y = oy + uu * s + vv * c;
        var sp = ev(x, y);
        if (!sp) continue;
        total++;
        counts[sp] = (counts[sp] || 0) + 1;
        if (!countOnly) trees.push({ x: x, y: y, sp: sp, i: i, j: j });
      }
    }
    return { trees: trees, counts: counts, total: total };
  }

  // Máscara de puntos plantables (rápida para optimizar): 1 = se puede plantar
  function buildMask(prep, finca, over) {
    var ring = prep.ring, n = ring.length, i;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (i = 0; i < n; i++) { minx = Math.min(minx, ring[i][0]); maxx = Math.max(maxx, ring[i][0]); miny = Math.min(miny, ring[i][1]); maxy = Math.max(maxy, ring[i][1]); }
    var area = Math.abs(areaXY(ring)), res = Math.max(0.2, Math.sqrt(area) / 250);
    var nx = Math.ceil((maxx - minx) / res) + 1, ny = Math.ceil((maxy - miny) / res) + 1;
    var data = new Uint8Array(nx * ny), ev = makeEval(prep, finca, over), ix, iy;
    for (iy = 0; iy < ny; iy++) for (ix = 0; ix < nx; ix++) data[iy * nx + ix] = ev(minx + ix * res, miny + iy * res) ? 1 : 0;
    return { x0: minx, y0: miny, res: res, nx: nx, ny: ny, data: data };
  }

  // Busca ángulo (salvo que se fije) y desplazamientos que maximizan el número de árboles.
  function optimizeAuto(prep, finca, opts) {
    opts = opts || {};
    var P = finca.params, sx = +P.sx, sy = +P.sy;
    var tres = P.pattern === 'tres', syE = tres ? sx * 0.8660254 : sy, vp = tres ? 2 * syE : syE, off = tres ? sx / 2 : 0;
    var ring = prep.ring, n = ring.length, ox = prep.anchor[0], oy = prep.anchor[1];
    var mk = buildMask(prep, finca), data = mk.data, nx = mk.nx, ny = mk.ny, inv = 1 / mk.res, x0 = mk.x0, y0 = mk.y0;
    function score(angDeg, shU, shV) {
      var th = angDeg * RAD, c = Math.cos(th), s = Math.sin(th), i, j;
      var umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
      for (i = 0; i < n; i++) {
        var dx = ring[i][0] - ox, dy = ring[i][1] - oy, u = dx * c + dy * s, v = -dx * s + dy * c;
        if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v;
      }
      var i0 = Math.ceil((umin - shU - off) / sx), i1 = Math.floor((umax - shU) / sx), j0 = Math.ceil((vmin - shV) / syE), j1 = Math.floor((vmax - shV) / syE), tot = 0;
      for (i = i0; i <= i1; i++) for (j = j0; j <= j1; j++) {
        var uu = i * sx + shU + (off && (j & 1) ? off : 0), vv = j * syE + shV;
        var x = ox + uu * c - vv * s, y = oy + uu * s + vv * c;
        var gx = Math.round((x - x0) * inv), gy = Math.round((y - y0) * inv);
        if (gx >= 0 && gy >= 0 && gx < nx && gy < ny && data[gy * nx + gx]) tot++;
      }
      return tot;
    }
    var best = { total: -1, angle: 0, shU: 0, shV: 0 }, deadline = Date.now() + (opts.budget || 1500), cands = [];
    function tryAll(angles, nu, nv, u0, v0, su, sv) {
      for (var ai = 0; ai < angles.length; ai++) for (var p = 0; p < nu; p++) for (var q = 0; q < nv; q++) {
        if (best.total >= 0 && Date.now() > deadline) return;
        var a = angles[ai], u = ((u0 + p * su) % sx + sx) % sx, v = ((v0 + q * sv) % vp + vp) % vp, t = score(a, u, v);
        cands.push({ total: t, angle: a, shU: u, shV: v });
        if (cands.length > 4000) { cands.sort(function (x, y) { return y.total - x.total; }); cands.length = 300; }
        if (t > best.total) best = { total: t, angle: a, shU: u, shV: v };
      }
    }
    var fixed = opts.fixedAngle != null && isFinite(opts.fixedAngle);
    var maxA = tres ? 60 : (Math.abs(sx - sy) < 1e-9 ? 90 : 180), angles = [], a;
    if (fixed) angles = [+opts.fixedAngle];
    else for (a = 0; a < maxA; a += 2) angles.push(a);
    tryAll(angles, 6, 6, 0, 0, sx / 6, vp / 6);
    if (!fixed) {
      angles = []; for (a = best.angle - 2; a <= best.angle + 2.0001; a += 0.25) angles.push(((a % maxA) + maxA) % maxA);
      tryAll(angles, 8, 8, 0, 0, sx / 8, vp / 8);
    }
    var b0 = best, steps = 8, ang = [best.angle];
    tryAll(ang, steps * 2 + 1, steps * 2 + 1, b0.shU - steps * 0.05, b0.shV - steps * 0.05, 0.05, 0.05);
    // refinamiento EXACTO con el generador real (cuenta idéntica a la final)
    var fixedA = fixed ? +opts.fixedAngle : null, dl2 = Date.now() + (opts.budget2 || 2500);
    function exact(a, u, v) { return generate(prep, finca, { angle: a, shU: ((u % sx) + sx) % sx, shV: ((v % vp) + vp) % vp }, true).total; }
    cands.sort(function (x, y) { return y.total - x.total; });
    var starts = [], ci;
    for (ci = 0; ci < cands.length && starts.length < 6; ci++) {
      var c0 = cands[ci], dup = false;
      for (var si = 0; si < starts.length; si++) if (Math.abs(starts[si].angle - c0.angle) < 3 && Math.abs(starts[si].shU - c0.shU) < sx * 0.3) dup = true;
      if (!dup) starts.push(c0);
    }
    if (!starts.length) starts.push(best);
    var eb = { total: -1 };
    for (var st = 0; st < starts.length && (eb.total < 0 || Date.now() < dl2); st++) {
      var cur = { angle: fixed ? fixedA : starts[st].angle, shU: starts[st].shU, shV: starts[st].shV };
      cur.total = exact(cur.angle, cur.shU, cur.shV);
      var sa = [1, 0.5, 0.25, 0.1], ss = [0.25, 0.1, 0.05, 0.02];
      for (var lv = 0; lv < sa.length; lv++) {
        var imp = true, guard = 0;
        while (imp && guard++ < 40 && Date.now() < dl2) {
          imp = false;
          var moves = [];
          if (!fixed) moves.push([sa[lv], 0, 0], [-sa[lv], 0, 0]);
          moves.push([0, ss[lv], 0], [0, -ss[lv], 0], [0, 0, ss[lv]], [0, 0, -ss[lv]], [0, ss[lv], ss[lv]], [0, -ss[lv], -ss[lv]], [0, ss[lv], -ss[lv]], [0, -ss[lv], ss[lv]]);
          for (var mi = 0; mi < moves.length; mi++) {
            var m = moves[mi], na = cur.angle + m[0], nu = cur.shU + m[1], nv = cur.shV + m[2], tt = exact(na, nu, nv);
            if (tt > cur.total) { cur = { angle: na, shU: ((nu % sx) + sx) % sx, shV: ((nv % vp) + vp) % vp, total: tt }; imp = true; }
          }
        }
      }
      if (cur.total > eb.total) eb = cur;
    }
    if (eb.total >= 0) best = eb;
    best.angle = +best.angle.toFixed(3); best.shU = +best.shU.toFixed(3); best.shV = +best.shV.toFixed(3);
    return best;
  }


  /* ---------- relleno de huecos: puntos candidatos (máx. aprovechamiento) ---------- */
  // occ: [[x,y],...] posiciones ocupadas (árboles y quitados). Devuelve [{x,y,sp}] con distancia mínima dmin entre árboles.
  function fillCandidates(prep, finca, occ, dmin, opts) {
    opts = opts || {};
    var ev = makeEval(prep, finca), ring = prep.ring, i;
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (i = 0; i < ring.length; i++) { minx = Math.min(minx, ring[i][0]); maxx = Math.max(maxx, ring[i][0]); miny = Math.min(miny, ring[i][1]); maxy = Math.max(maxy, ring[i][1]); }
    var area = Math.abs(areaXY(ring)), st = Math.max(0.1, Math.min(0.5, Math.sqrt(area) / 700));
    var cell = dmin, H = {};
    function key(x, y) { return Math.floor(x / cell) + ',' + Math.floor(y / cell); }
    function near(x, y) {
      var md = Infinity, cx = Math.floor(x / cell), cy = Math.floor(y / cell), a, b, k, j;
      for (a = -1; a <= 1; a++) for (b = -1; b <= 1; b++) { k = H[(cx + a) + ',' + (cy + b)]; if (k) for (j = 0; j < k.length; j++) { var d = Math.hypot(k[j][0] - x, k[j][1] - y); if (d < md) md = d; } }
      return md;
    }
    function put(x, y) { var k = key(x, y); (H[k] || (H[k] = [])).push([x, y]); }
    occ.forEach(function (p) { put(p[0], p[1]); });
    var cand = [], x, y, d, deadline = Date.now() + (opts.budget || 2500);
    for (x = minx; x <= maxx; x += st) for (y = miny; y <= maxy; y += st) {
      d = near(x, y);
      if (d >= dmin - 1e-9 && ev(x, y)) cand.push([x, y, d]);
      if (Date.now() > deadline) break;
    }
    cand.sort(function (a, b) { return b[2] - a[2]; });
    var out = [];
    for (i = 0; i < cand.length; i++) {
      var c0 = cand[i];
      if (near(c0[0], c0[1]) < dmin - 1e-9) continue;
      var sp = ev(c0[0], c0[1]); if (!sp) continue;
      put(c0[0], c0[1]); out.push({ x: c0[0], y: c0[1], sp: sp });
    }
    return out;
  }

  // Retícula que pasa exactamente por el punto pt (x,y): busca el ángulo que da más árboles.
  function optimizeThrough(prep, finca, pt, opts) {
    opts = opts || {};
    var P = finca.params, sx = +P.sx, sy = +P.sy;
    var tres = P.pattern === 'tres', syE = tres ? sx * 0.8660254 : sy, vp = tres ? 2 * syE : syE, off = tres ? sx / 2 : 0;
    var ox = prep.anchor[0], oy = prep.anchor[1];
    function shifts(a) {
      var th = a * RAD, c = Math.cos(th), s = Math.sin(th), dx = pt[0] - ox, dy = pt[1] - oy;
      var u = dx * c + dy * s, v = -dx * s + dy * c;
      var sV = ((v % vp) + vp) % vp, jj = Math.round((v - sV) / syE), sU = (((u - (off && (jj & 1) ? off : 0)) % sx) + sx) % sx;
      return { shU: sU, shV: sV };
    }
    function exact(a) { var sh = shifts(a); return generate(prep, finca, { angle: a, shU: sh.shU, shV: sh.shV }, true).total; }
    var fixed = opts.fixedAngle != null && isFinite(opts.fixedAngle);
    var maxA = tres ? 60 : (Math.abs(sx - sy) < 1e-9 ? 90 : 180), best = { angle: fixed ? +opts.fixedAngle : 0, total: -1 }, a, t, dl = Date.now() + (opts.budget || 2500);
    if (fixed) best.total = exact(best.angle);
    else {
      for (a = 0; a < maxA; a += 2) { t = exact(a); if (t > best.total) best = { angle: a, total: t }; if (Date.now() > dl) break; }
      var steps = [1, 0.5, 0.25, 0.1];
      for (var k = 0; k < steps.length; k++) {
        var imp = true, g = 0;
        while (imp && g++ < 20 && Date.now() < dl) {
          imp = false;
          [steps[k], -steps[k]].forEach(function (d) { var na = best.angle + d, tt = exact(na); if (tt > best.total) { best = { angle: na, total: tt }; imp = true; } });
        }
      }
    }
    var sh = shifts(best.angle);
    return { angle: +best.angle.toFixed(3), shU: +sh.shU.toFixed(3), shV: +sh.shV.toFixed(3), total: best.total };
  }

  // Curva ángulo -> nº máximo de árboles (con la mejor posición para cada ángulo).
  function angleCurve(prep, finca, stepDeg, opts) {
    opts = opts || {}; stepDeg = stepDeg || 2;
    var P = finca.params, sx = +P.sx, sy = +P.sy;
    var tres = P.pattern === 'tres', syE = tres ? sx * 0.8660254 : sy, vp = tres ? 2 * syE : syE, off = tres ? sx / 2 : 0;
    var ring = prep.ring, n = ring.length, ox = prep.anchor[0], oy = prep.anchor[1];
    var mk = buildMask(prep, finca), data = mk.data, nx = mk.nx, ny = mk.ny, inv = 1 / mk.res, x0 = mk.x0, y0 = mk.y0;
    function score(angDeg, shU, shV) {
      var th = angDeg * RAD, c = Math.cos(th), s = Math.sin(th), i, j, umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
      for (i = 0; i < n; i++) { var dx = ring[i][0] - ox, dy = ring[i][1] - oy, u = dx * c + dy * s, v = -dx * s + dy * c; if (u < umin) umin = u; if (u > umax) umax = u; if (v < vmin) vmin = v; if (v > vmax) vmax = v; }
      var i0 = Math.ceil((umin - shU - off) / sx), i1 = Math.floor((umax - shU) / sx), j0 = Math.ceil((vmin - shV) / syE), j1 = Math.floor((vmax - shV) / syE), tot = 0;
      for (i = i0; i <= i1; i++) for (j = j0; j <= j1; j++) {
        var uu = i * sx + shU + (off && (j & 1) ? off : 0), vv = j * syE + shV, x = ox + uu * c - vv * s, y = oy + uu * s + vv * c, gx = Math.round((x - x0) * inv), gy = Math.round((y - y0) * inv);
        if (gx >= 0 && gy >= 0 && gx < nx && gy < ny && data[gy * nx + gx]) tot++;
      }
      return tot;
    }
    var maxA = tres ? 60 : (Math.abs(sx - sy) < 1e-9 ? 90 : 180), out = [], a, p, q, dl = Date.now() + (opts.budget || 4000), N = 5;
    for (a = 0; a < maxA; a += stepDeg) {
      var b = 0;
      for (p = 0; p < N; p++) for (q = 0; q < N; q++) { var t = score(a, p * sx / N, q * vp / N); if (t > b) b = t; }
      out.push({ a: a, total: b });
      if (Date.now() > dl) break;
    }
    return { maxA: maxA, pts: out };
  }

  // Busca ángulo y desplazamiento de la retícula que maximizan el nº de árboles.

  // Filas siguiendo curvas de nivel. zg = {x0,y0,cs,nx,ny,z(Float32Array, NaN fuera)}; dz = desnivel entre filas (m)
  function contourTrees(prep, finca, zg, dz) {
    var P = finca.params, sx = Math.max(0.5, +P.sx), dmin = Math.max(0.5, +P.dmin || 1.5), ev = makeEval(prep, finca);
    var nx = zg.nx, ny = zg.ny, cs = zg.cs, z = zg.z, x0 = zg.x0, y0 = zg.y0, i, j, zmin = Infinity, zmax = -Infinity;
    for (i = 0; i < z.length; i++) if (z[i] === z[i]) { if (z[i] < zmin) zmin = z[i]; if (z[i] > zmax) zmax = z[i]; }
    var trees = [], H = {}, cell = dmin;
    function near(x, y) {
      var cx = Math.floor(x / cell), cy = Math.floor(y / cell), a, b, k, q, md = Infinity;
      for (a = -1; a <= 1; a++) for (b = -1; b <= 1; b++) { k = H[(cx + a) + ',' + (cy + b)]; if (k) for (q = 0; q < k.length; q++) { var d = Math.hypot(k[q][0] - x, k[q][1] - y); if (d < md) md = d; } }
      return md;
    }
    function put(x, y) { var k = Math.floor(x / cell) + ',' + Math.floor(y / cell); (H[k] || (H[k] = [])).push([x, y]); }
    var row = 0, lv;
    for (lv = zmin + dz / 2; lv < zmax; lv += dz) {
      var nodes = {}, deg = {};
      function node(key, ax, ay, bx, by, va, vb) {
        if (!nodes[key]) { var t = (lv - va) / (vb - va); nodes[key] = { p: [ax + (bx - ax) * t, ay + (by - ay) * t], n: [] }; }
        return key;
      }
      function link(a, b) { nodes[a].n.push(b); nodes[b].n.push(a); }
      for (j = 0; j < ny - 1; j++) for (i = 0; i < nx - 1; i++) {
        var va = z[j * nx + i], vb = z[j * nx + i + 1], vc = z[(j + 1) * nx + i + 1], vd = z[(j + 1) * nx + i];
        if (!(va === va && vb === vb && vc === vc && vd === vd)) continue;
        var X = x0 + i * cs, Y = y0 + j * cs, ks = [];
        if ((va < lv) !== (vb < lv)) ks.push(node('h' + i + ',' + j, X, Y, X + cs, Y, va, vb));
        if ((vb < lv) !== (vc < lv)) ks.push(node('v' + (i + 1) + ',' + j, X + cs, Y, X + cs, Y + cs, vb, vc));
        if ((vd < lv) !== (vc < lv)) ks.push(node('h' + i + ',' + (j + 1), X, Y + cs, X + cs, Y + cs, vd, vc));
        if ((va < lv) !== (vd < lv)) ks.push(node('v' + i + ',' + j, X, Y, X, Y + cs, va, vd));
        if (ks.length === 2) link(ks[0], ks[1]); else if (ks.length === 4) { link(ks[0], ks[1]); link(ks[2], ks[3]); }
      }
      var seen = {}, keys = Object.keys(nodes), chains = [];
      function walk(s) {
        var path = [], cur = s, prev = null;
        while (cur && !seen[cur]) {
          seen[cur] = 1; path.push(nodes[cur].p);
          var nx2 = null, n = nodes[cur].n, q;
          for (q = 0; q < n.length; q++) if (n[q] !== prev && !seen[n[q]]) { nx2 = n[q]; break; }
          prev = cur; cur = nx2;
        }
        return path;
      }
      keys.forEach(function (k) { if (!seen[k] && nodes[k].n.length === 1) chains.push(walk(k)); });
      keys.forEach(function (k) { if (!seen[k]) chains.push(walk(k)); });
      var any = false, idx = 0;
      chains.forEach(function (ch) {
        if (ch.length < 2) return;
        var pos = 0, next = 0, s;
        for (s = 1; s < ch.length; s++) {
          var ax = ch[s - 1][0], ay = ch[s - 1][1], bx = ch[s][0], by = ch[s][1], L = Math.hypot(bx - ax, by - ay);
          if (L < 1e-9) continue;
          while (next <= pos + L) {
            var t = (next - pos) / L, px = ax + (bx - ax) * t, py = ay + (by - ay) * t, sp = ev(px, py);
            if (sp && near(px, py) >= dmin - 1e-9) { put(px, py); trees.push({ x: px, y: py, sp: sp, i: idx++, j: row }); any = true; }
            next += sx;
          }
          pos += L;
        }
      });
      if (any) row++;
    }
    var counts = {}; trees.forEach(function (t) { counts[t.sp] = (counts[t.sp] || 0) + 1; });
    return { trees: trees, counts: counts, total: trees.length, rows: row };
  }

  function optimize(prep, finca, stepDeg, nShift) {
    stepDeg = stepDeg || 2.5; nShift = nShift || 4;
    var sx = +finca.params.sx, sy = +finca.params.sy;
    var maxA = Math.abs(sx - sy) < 1e-9 ? 90 : 180;
    var best = { total: -1 }, a, p, q;
    for (a = 0; a < maxA; a += stepDeg) {
      for (p = 0; p < nShift; p++) {
        for (q = 0; q < nShift; q++) {
          var o = { angle: a, shU: p * sx / nShift, shV: q * sy / nShift };
          var r = generate(prep, finca, o, true);
          if (r.total > best.total) best = { total: r.total, angle: a, shU: o.shU, shV: o.shV };
        }
      }
    }
    return best;
  }

  /* ---------- importación ---------- */
  function stripClose(ring) {
    if (ring.length > 1) {
      var f = ring[0], l = ring[ring.length - 1];
      if (f[0] === l[0] && f[1] === l[1]) ring = ring.slice(0, -1);
    }
    return ring;
  }

  // Devuelve el anillo exterior más grande de un GeoJSON (EPSG:4326) como [[lng,lat],...]
  function ringFromGeoJSON(obj) {
    var rings = [];
    (function walk(o) {
      if (!o) return;
      if (o.type === 'FeatureCollection') (o.features || []).forEach(walk);
      else if (o.type === 'Feature') walk(o.geometry);
      else if (o.type === 'GeometryCollection') (o.geometries || []).forEach(walk);
      else if (o.type === 'Polygon') rings.push(o.coordinates[0]);
      else if (o.type === 'MultiPolygon') o.coordinates.forEach(function (p) { rings.push(p[0]); });
    })(obj);
    if (!rings.length) throw new Error('El fichero no contiene polígonos.');
    var best = null, ba = -1;
    rings.forEach(function (r) {
      var rr = stripClose(r.map(function (p) { return [p[0], p[1]]; }));
      var a = stats(rr).area;
      if (a > ba) { ba = a; best = rr; }
    });
    if (Math.abs(best[0][0]) > 180 || Math.abs(best[0][1]) > 90) {
      throw new Error('Coordenadas no geográficas. Exporta el GeoJSON en EPSG:4326 (WGS84).');
    }
    return best;
  }

  // Parcela catastral INSPIRE (GML): extrae gml:posList del primer anillo exterior.
  function ringFromGML(text) {
    var m = /<gml:posList[^>]*>([^<]+)<\/gml:posList>/.exec(text);
    if (!m) throw new Error('Respuesta del Catastro sin geometría.');
    var nums = m[1].trim().split(/\s+/).map(Number);
    var ring = [];
    for (var i = 0; i + 1 < nums.length; i += 2) {
      var a = nums[i], b = nums[i + 1];
      // en EPSG:4326 el WFS devuelve lat,lon; si el primer valor parece latitud, se intercambia
      ring.push(Math.abs(a) >= 20 && Math.abs(a) <= 60 && Math.abs(b) < 20 ? [b, a] : [a, b]);
    }
    return stripClose(ring);
  }

  return {
    SPECIES: SPECIES, LINDEROS: LINDEROS, CONCELLOS: CONCELLOS,
    defaultNorm: defaultNorm, defaultEdge: defaultEdge, ensureEdges: ensureEdges, groupKey: groupKey,
    centroidLL: centroidLL, makeProj: makeProj, areaXY: areaXY, inPoly: inPoly, distSeg: distSeg, stats: stats,
    prepare: prepare, generate: generate, optimize: optimize, makeEval: makeEval, optimizeAuto: optimizeAuto, fillCandidates: fillCandidates, optimizeThrough: optimizeThrough, contourTrees: contourTrees, angleCurve: angleCurve,
    ringFromGeoJSON: ringFromGeoJSON, ringFromGML: ringFromGML
  };
});
