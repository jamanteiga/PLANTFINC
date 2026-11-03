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
    nitens:   { name: 'Eucalipto nitens',   group: 'euc',   color: '#1e88e5' },
    globulus: { name: 'Eucalipto globulus', group: 'euc',   color: '#8e24aa' },
    castano:  { name: 'Castaño',            group: 'frond', color: '#ef6c00' },
    roble:    { name: 'Roble',              group: 'frond', color: '#6d4c41' },
    abedul:   { name: 'Abedul',             group: 'frond', color: '#fdd835' },
    pino:     { name: 'Pino',               group: 'resto', color: '#e91e63' }
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

  function generate(prep, finca, over, countOnly) {
    var P = {};
    var k;
    for (k in finca.params) P[k] = finca.params[k];
    if (over) for (k in over) P[k] = over[k];
    var sx = +P.sx, sy = +P.sy;
    var th = (+P.angle || 0) * RAD, c = Math.cos(th), s = Math.sin(th);
    var shU = +P.shU || 0, shV = +P.shV || 0;
    var ox = prep.anchor[0], oy = prep.anchor[1];
    var ring = prep.ring, n = ring.length, edges = prep.edges;
    var core = P.core, nRows = Math.max(0, +P.rows || 0), rowsDepth = nRows * Math.min(sx, sy);  // filas de frondosas: la 1.ª a la distancia legal, las siguientes cada marco

    var umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity, i, j;
    for (i = 0; i < n; i++) {
      var dx = ring[i][0] - ox, dy = ring[i][1] - oy;
      var u = dx * c + dy * s, v = -dx * s + dy * c;
      if (u < umin) umin = u; if (u > umax) umax = u;
      if (v < vmin) vmin = v; if (v > vmax) vmax = v;
    }
    var i0 = Math.ceil((umin - shU) / sx), i1 = Math.floor((umax - shU) / sx);
    var j0 = Math.ceil((vmin - shV) / sy), j1 = Math.floor((vmax - shV) / sy);

    // profundidad de la franja de frondosas por lindero
    var depth = [];
    for (i = 0; i < n; i++) {
      var e = edges[i];
      depth.push(e.franja && nRows > 0 ? prep.sb(i, e.especie) + rowsDepth : -1);
    }

    var trees = [], counts = {}, total = 0, d = new Array(n);
    for (i = i0; i <= i1; i++) {
      for (j = j0; j <= j1; j++) {
        var uu = i * sx + shU, vv = j * sy + shV;
        var x = ox + uu * c - vv * s, y = oy + uu * s + vv * c;
        if (!inPoly(x, y, ring)) continue;

        var skip = false, q;
        for (q = 0; q < prep.excl.length && !skip; q++) {
          var ex = prep.excl[q];
          if (ex.kind === 'line') {
            for (var m = 0; m + 1 < ex.pts.length; m++) {
              if (distSeg(x, y, ex.pts[m][0], ex.pts[m][1], ex.pts[m + 1][0], ex.pts[m + 1][1]) < ex.buf) { skip = true; break; }
            }
          } else if (inPoly(x, y, ex.pts)) skip = true;
        }
        if (skip) continue;

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

        var ok = true;
        for (q = 0; q < n; q++) {
          if (d[q] < prep.sb(q, sp)) { ok = false; break; }
        }
        if (!ok) continue;

        total++;
        counts[sp] = (counts[sp] || 0) + 1;
        if (!countOnly) trees.push({ x: x, y: y, sp: sp });
      }
    }
    return { trees: trees, counts: counts, total: total };
  }

  // Busca ángulo y desplazamiento de la retícula que maximizan el nº de árboles.
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
    prepare: prepare, generate: generate, optimize: optimize,
    ringFromGeoJSON: ringFromGeoJSON, ringFromGML: ringFromGML
  };
});
