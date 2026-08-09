(function () {
  "use strict";
  function _(n) {
    const t = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(n);
    return t ? { r: parseInt(t[1], 16), g: parseInt(t[2], 16), b: parseInt(t[3], 16) } : { r: 0, g: 0, b: 0 };
  }
  function R(n) {
    let t = n.r / 255,
      e = n.g / 255,
      o = n.b / 255;
    ((t = t > 0.04045 ? Math.pow((t + 0.055) / 1.055, 2.4) : t / 12.92),
      (e = e > 0.04045 ? Math.pow((e + 0.055) / 1.055, 2.4) : e / 12.92),
      (o = o > 0.04045 ? Math.pow((o + 0.055) / 1.055, 2.4) : o / 12.92),
      (t *= 100),
      (e *= 100),
      (o *= 100));
    const r = t * 0.4124 + e * 0.3576 + o * 0.1805,
      a = t * 0.2126 + e * 0.7152 + o * 0.0722,
      c = t * 0.0193 + e * 0.1192 + o * 0.9505;
    let i = r / 95.047,
      l = a / 100,
      s = c / 108.883;
    return (
      (i = i > 0.008856 ? Math.pow(i, 1 / 3) : 7.787 * i + 16 / 116),
      (l = l > 0.008856 ? Math.pow(l, 1 / 3) : 7.787 * l + 16 / 116),
      (s = s > 0.008856 ? Math.pow(s, 1 / 3) : 7.787 * s + 16 / 116),
      { l: 116 * l - 16, a: 500 * (i - l), b: 200 * (l - s) }
    );
  }
  function T(n, t) {
    const e = n.l - t.l,
      o = n.a - t.a,
      r = n.b - t.b;
    return Math.sqrt(e * e + o * o + r * r);
  }
  function Y(n, t) {
    if (t.length === 0) throw new Error("Palette cannot be empty");
    let e = 1 / 0,
      o = t[0].id;
    for (let r = 0; r < t.length; r++) {
      const a = t[r],
        c = n.l - a.l,
        i = n.a - a.a,
        l = n.b - a.b,
        s = c * c + i * i + l * l;
      s < e && ((e = s), (o = a.id));
    }
    return o;
  }
  const N = 16;
  function rn(n, t) {
    const e = [];
    for (let o = 0; o < n; o++) e.push(o);
    if (t > 1) {
      const o = (t - 1) * n;
      for (let r = 0; r < n; r++) e.push(o + r);
    }
    for (let o = 1; o < t - 1; o++) (e.push(o * n), n > 1 && e.push(o * n + n - 1));
    return e;
  }
  function cn(n, t) {
    return Array.from(new Set([0, n - 1, (t - 1) * n, t * n - 1]));
  }
  function y(n, t) {
    const e = t * 4;
    return R({ r: n[e], g: n[e + 1], b: n[e + 2] });
  }
  function F(n) {
    const t = [...n].sort((o, r) => o - r),
      e = Math.floor(t.length / 2);
    return t.length % 2 === 1 ? t[e] : (t[e - 1] + t[e]) / 2;
  }
  function Q(n) {
    return { l: F(n.map((t) => t.l)), a: F(n.map((t) => t.a)), b: F(n.map((t) => t.b)) };
  }
  function an({ imageData: n, width: t, height: e, mode: o, preset: r }) {
    const a = t * e,
      c = new Uint8Array(a);
    for (let f = 0; f < a; f++) n[f * 4 + 3] <= N && (c[f] = 1);
    if (o === "keep") return { mask: c, detected: !1, confidence: 0 };
    const i = rn(t, e),
      l = i.filter((f) => n[f * 4 + 3] > N);
    if (l.length === 0) return { mask: c, detected: !1, confidence: 1 };
    const s = l.map((f) => y(n, f)),
      d = Q(s),
      u = cn(t, e)
        .filter((f) => n[f * 4 + 3] > N)
        .map((f) => y(n, f)),
      g = u.length > 0 ? Q(u) : d,
      h = u.reduce((f, I) => f + (T(I, g) <= r.backgroundSeedDeltaE ? 1 : 0), 0),
      b = u.length > 0 ? h / u.length : 0,
      E = u.length >= 3 && b >= 0.75,
      p = E ? g : d,
      L = s.reduce((f, I) => f + (T(I, p) <= r.backgroundSeedDeltaE ? 1 : 0), 0) / s.length,
      C = Math.max(L, E ? b : 0);
    if (o === "auto" && C < r.backgroundMinimumConfidence) return { mask: c, detected: !1, confidence: C };
    const k = new Int32Array(a);
    let P = 0,
      x = 0;
    const S = (f) => {
      if (c[f] === 1) {
        k[x++] = f;
        return;
      }
      T(y(n, f), p) > r.backgroundFillDeltaE || ((c[f] = 1), (k[x++] = f));
    };
    for (i.forEach(S); P < x;) {
      const f = k[P++],
        I = f % t,
        w = Math.floor(f / t),
        U = [I > 0 ? f - 1 : -1, I < t - 1 ? f + 1 : -1, w > 0 ? f - t : -1, w < e - 1 ? f + t : -1];
      for (const M of U) {
        if (M < 0 || c[M] === 1) continue;
        (n[M * 4 + 3] <= N || T(y(n, M), p) <= r.backgroundFillDeltaE) && ((c[M] = 1), (k[x++] = M));
      }
    }
    return { mask: c, detected: !0, confidence: C };
  }
  function ln(n, t, e, o, r) {
    if (!r.cleanupMinimumNeighbors) return n;
    const a = [...n];
    for (let c = 0; c < o; c++)
      for (let i = 0; i < e; i++) {
        const l = c * e + i,
          s = n[l],
          d = t[l];
        if (!s || !d || d.isOutline) continue;
        const m = new Map();
        for (let h = -1; h <= 1; h++)
          for (let b = -1; b <= 1; b++) {
            if (b === 0 && h === 0) continue;
            const E = i + b,
              p = c + h;
            if (E < 0 || E >= e || p < 0 || p >= o) continue;
            const D = n[p * e + E];
            D && m.set(D, (m.get(D) || 0) + 1);
          }
        let u = s,
          g = 0;
        (m.forEach((h, b) => {
          h > g && ((u = b), (g = h));
        }),
          u !== s && g >= r.cleanupMinimumNeighbors && (a[l] = u));
      }
    return a;
  }
  function v(n, t) {
    const e = n.l - t.l,
      o = n.a - t.a,
      r = n.b - t.b;
    return e * e + o * o + r * r;
  }
  function J(n, t) {
    let e = 0,
      o = Number.POSITIVE_INFINITY;
    for (let r = 0; r < t.length; r++) {
      const a = v(n, t[r]);
      a < o && ((o = a), (e = r));
    }
    return e;
  }
  function sn(n, t) {
    const e = n.filter((a) => a.isOutline),
      r = [{ ...(e.length > 0 ? e : n).reduce((a, c) => (c.lab.l < a.lab.l ? c : a)).lab }];
    for (; r.length < t;) {
      let a = null,
        c = 0;
      for (const i of n) {
        const s = v(i.lab, r[J(i.lab, r)]) * i.weight;
        s > c && ((c = s), (a = i));
      }
      if (!a || c <= Number.EPSILON) break;
      r.push({ ...a.lab });
    }
    return r;
  }
  function un(n, t) {
    const e = sn(n, t);
    for (let o = 0; o < 12; o++) {
      const r = e.map(() => ({ l: 0, a: 0, b: 0, weight: 0 }));
      for (const c of n) {
        const i = J(c.lab, e),
          l = r[i];
        ((l.l += c.lab.l * c.weight), (l.a += c.lab.a * c.weight), (l.b += c.lab.b * c.weight), (l.weight += c.weight));
      }
      let a = 0;
      for (let c = 0; c < e.length; c++) {
        const i = r[c];
        if (i.weight === 0) continue;
        const l = { l: i.l / i.weight, a: i.a / i.weight, b: i.b / i.weight };
        ((a = Math.max(a, v(e[c], l))), (e[c] = l));
      }
      if (a < 1e-4) break;
    }
    return e;
  }
  function dn(n, t, e, o = 2.5) {
    if (t.length === 0) throw new Error("EMPTY_PALETTE");
    const r = [];
    n.forEach((u, g) => {
      u &&
        r.push({
          index: g,
          lab: R(u.rgb),
          weight: Math.max(0.01, u.coverage) * (u.isOutline ? o : 1),
          isOutline: u.isOutline,
        });
    });
    const a = new Array(n.length).fill("");
    if (r.length === 0) return a;
    const c = Math.max(1, Math.min(e, t.length, r.length)),
      i = un(r, c),
      l = t.map((u) => ({ id: u.id, ...R(_(u.hex)) })),
      s = new Set(i.map((u) => Y(u, l))),
      d = l.filter((u) => s.has(u.id)),
      m = d.reduce((u, g) => (g.l < u.l ? g : u));
    for (const u of r) a[u.index] = u.isOutline ? m.id : Y(u.lab, d);
    return a;
  }
  const fn = {
    zippland: {
      id: "zippland",
      maxColors: null,
      analysisPixelsPerCell: 1,
      minimumForegroundCoverage: 0,
      outlineDarkLuminance: 0,
      outlineDarkRatio: 1,
      outlineContrast: 1,
      outlineWeight: 1,
      backgroundSeedDeltaE: 0,
      backgroundFillDeltaE: 0,
      backgroundMinimumConfidence: 1,
      cleanupMinimumNeighbors: null,
    },
    simplified: {
      id: "simplified",
      maxColors: 8,
      analysisPixelsPerCell: 4,
      minimumForegroundCoverage: 0.28,
      outlineDarkLuminance: 0.34,
      outlineDarkRatio: 0.22,
      outlineContrast: 0.18,
      outlineWeight: 3,
      backgroundSeedDeltaE: 8,
      backgroundFillDeltaE: 13,
      backgroundMinimumConfidence: 0.85,
      cleanupMinimumNeighbors: 4,
    },
    standard: {
      id: "standard",
      maxColors: 10,
      analysisPixelsPerCell: 4,
      minimumForegroundCoverage: 0.2,
      outlineDarkLuminance: 0.32,
      outlineDarkRatio: 0.2,
      outlineContrast: 0.16,
      outlineWeight: 2.5,
      backgroundSeedDeltaE: 8,
      backgroundFillDeltaE: 14,
      backgroundMinimumConfidence: 0.85,
      cleanupMinimumNeighbors: 5,
    },
    detailed: {
      id: "detailed",
      maxColors: 16,
      analysisPixelsPerCell: 4,
      minimumForegroundCoverage: 0.12,
      outlineDarkLuminance: 0.28,
      outlineDarkRatio: 0.3,
      outlineContrast: 0.22,
      outlineWeight: 1.5,
      backgroundSeedDeltaE: 8,
      backgroundFillDeltaE: 13,
      backgroundMinimumConfidence: 0.88,
      cleanupMinimumNeighbors: 7,
    },
    legacy: {
      id: "legacy",
      maxColors: null,
      analysisPixelsPerCell: 1,
      minimumForegroundCoverage: 0,
      outlineDarkLuminance: 0,
      outlineDarkRatio: 1,
      outlineContrast: 1,
      outlineWeight: 1,
      backgroundSeedDeltaE: 0,
      backgroundFillDeltaE: 0,
      backgroundMinimumConfidence: 1,
      cleanupMinimumNeighbors: null,
    },
  };
  function q(n, t, e) {
    return (0.2126 * n + 0.7152 * t + 0.0722 * e) / 255;
  }
  function gn({
    imageData: n,
    imageWidth: t,
    imageHeight: e,
    targetWidth: o,
    targetHeight: r,
    backgroundMask: a,
    preset: c,
  }) {
    const i = [];
    for (let l = 0; l < r; l++) {
      const s = Math.floor((l * e) / r),
        d = Math.max(s + 1, Math.floor(((l + 1) * e) / r));
      for (let m = 0; m < o; m++) {
        const u = Math.floor((m * t) / o),
          g = Math.max(u + 1, Math.floor(((m + 1) * t) / o)),
          h = (g - u) * (d - s);
        let b = 0,
          E = 0,
          p = 0,
          D = 0,
          L = 0,
          C = 0,
          k = 0,
          P = 0,
          x = 1,
          S = 0;
        for (let z = s; z < d; z++)
          for (let G = u; G < g; G++) {
            const on = z * t + G;
            if (a[on] === 1) continue;
            const V = on * 4,
              Z = n[V],
              K = n[V + 1],
              $ = n[V + 2],
              j = q(Z, K, $);
            (b++,
              (E += Z),
              (p += K),
              (D += $),
              (x = Math.min(x, j)),
              (S = Math.max(S, j)),
              j <= c.outlineDarkLuminance && (P++, (L += Z), (C += K), (k += $)));
          }
        const f = b / h;
        if (b === 0 || f < c.minimumForegroundCoverage) {
          i.push(null);
          continue;
        }
        const I = P / b,
          w = S - x,
          U = q(E / b, p / b, D / b),
          M = P > 0 && I >= c.outlineDarkRatio && (w >= c.outlineContrast || U <= c.outlineDarkLuminance),
          H = M ? P : b;
        i.push({
          rgb: { r: Math.round((M ? L : E) / H), g: Math.round((M ? C : p) / H), b: Math.round((M ? k : D) / H) },
          coverage: f,
          darkRatio: I,
          luminanceRange: w,
          isOutline: M,
        });
      }
    }
    return i;
  }
  const hn = 128;
  function mn(n, t, e) {
    return (n << 16) | (t << 8) | e;
  }
  function bn(n) {
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function pn({ imageData: n, imageWidth: t, imageHeight: e, targetWidth: o, targetHeight: r }) {
    const a = [],
      c = t / o,
      i = e / r;
    for (let l = 0; l < r; l++) {
      const s = Math.floor(l * i),
        d = Math.min(e, Math.ceil((l + 1) * i));
      for (let m = 0; m < o; m++) {
        const u = Math.floor(m * c),
          g = Math.min(t, Math.ceil((m + 1) * c)),
          h = new Map();
        let b = null,
          E = 0;
        for (let p = s; p < d; p++) {
          const D = p * t;
          for (let L = u; L < g; L++) {
            const C = (D + L) * 4;
            if (n[C + 3] < hn) continue;
            const k = mn(n[C], n[C + 1], n[C + 2]),
              P = (h.get(k) || 0) + 1;
            (h.set(k, P), P > E && ((E = P), (b = k)));
          }
        }
        a.push(b === null ? null : bn(b));
      }
    }
    return a;
  }
  function W(n) {
    const t = n / 255;
    return t <= 0.04045 ? t / 12.92 : Math.pow((t + 0.055) / 1.055, 2.4);
  }
  function O(n) {
    const t = W(n.r),
      e = W(n.g),
      o = W(n.b),
      r = 0.4122214708 * t + 0.5363325363 * e + 0.0514459929 * o,
      a = 0.2119034982 * t + 0.6806995451 * e + 0.1073969566 * o,
      c = 0.0883024619 * t + 0.2817188376 * e + 0.6299787005 * o,
      i = Math.cbrt(r),
      l = Math.cbrt(a),
      s = Math.cbrt(c);
    return {
      l: 0.2104542553 * i + 0.793617785 * l - 0.0040720468 * s,
      a: 1.9779984951 * i - 2.428592205 * l + 0.4505937099 * s,
      b: 0.0259040371 * i + 0.7827717662 * l - 0.808675766 * s,
    };
  }
  function nn(n, t) {
    const e = n.l - t.l,
      o = n.a - t.a,
      r = n.b - t.b;
    return Math.sqrt(e * e + o * o + r * r) * 100;
  }
  function En(n, t) {
    return nn(O(n), O(t));
  }
  function tn(n) {
    return n.map((t) => ({ id: t.id, ...O(_(t.hex)) }));
  }
  function en(n, t) {
    if (t.length === 0) throw new Error("EMPTY_PALETTE");
    const e = O(n);
    let o = t[0].id,
      r = Number.POSITIVE_INFINITY;
    for (let a = 0; a < t.length; a++) {
      const c = t[a],
        i = nn(e, c);
      if ((i < r && ((r = i), (o = c.id)), i === 0)) break;
    }
    return o;
  }
  function Mn(n, t, e, o = En) {
    const r = new Map(t.map((s) => [s.id, _(s.hex)])),
      a = new Map();
    for (let s = 0; s < n.length; s++) {
      const d = n[s];
      d && a.set(d, (a.get(d) || 0) + 1);
    }
    const c = [...a.entries()].sort((s, d) => d[1] - s[1]).map(([s]) => s),
      i = new Set(),
      l = new Map();
    for (let s = 0; s < c.length; s++) {
      const d = c[s];
      if (i.has(d)) continue;
      const m = r.get(d);
      if (m)
        for (let u = s + 1; u < c.length; u++) {
          const g = c[u];
          if (i.has(g)) continue;
          const h = r.get(g);
          !h || o(m, h) >= e || (i.add(g), l.set(g, d));
        }
    }
    return n.map((s) => l.get(s) || s);
  }
  const Cn = 1;
  function kn(n, t, e) {
    return (n << 16) | (t << 8) | e;
  }
  function Pn(n, t, e) {
    const o = [];
    for (let r = 0; r < e; r++) o.push(n.slice(r * t, (r + 1) * t));
    return o;
  }
  function Dn(n) {
    const t = pn({
        imageData: n.imageData,
        imageWidth: n.imageWidth,
        imageHeight: n.imageHeight,
        targetWidth: n.targetWidth,
        targetHeight: n.targetHeight,
      }),
      e = tn(n.activePalette),
      o = new Map(),
      r = t.map((i) => {
        if (!i) return "";
        const l = kn(i.r, i.g, i.b),
          s = o.get(l);
        if (s) return s;
        const d = en(i, e);
        return (o.set(l, d), d);
      }),
      a = Mn(r, n.activePalette, Cn),
      c = a.filter(Boolean).length;
    if (c === 0) throw new Error("EMPTY_PATTERN");
    return {
      matrix: Pn(a, n.targetWidth, n.targetHeight),
      diagnostics: {
        backgroundDetected: !1,
        backgroundConfidence: 0,
        colorsUsed: new Set(a.filter(Boolean)).size,
        transparentCells: a.length - c,
        foregroundCells: c,
        processingMs: 0,
      },
    };
  }
  const In = 128,
    B = 0.22,
    Ln = 8,
    xn = 14,
    Rn = 0.75;
  function Tn({ imageData: n, imageWidth: t, imageHeight: e, sourceGrid: o, column: r, row: a }) {
    const c = Math.max(0, Math.floor(o.originX + (r + B) * o.pitchX)),
      i = Math.min(t, Math.ceil(o.originX + (r + 1 - B) * o.pitchX)),
      l = Math.max(0, Math.floor(o.originY + (a + B) * o.pitchY)),
      s = Math.min(e, Math.ceil(o.originY + (a + 1 - B) * o.pitchY));
    if (c >= i || l >= s) return null;
    let d = 0,
      m = 0,
      u = 0,
      g = 0;
    for (let h = l; h < s; h++) {
      const b = h * t;
      for (let E = c; E < i; E++) {
        const p = (b + E) * 4;
        n[p + 3] < In || ((d += n[p]), (m += n[p + 1]), (u += n[p + 2]), g++);
      }
    }
    return g === 0 ? null : { r: Math.round(d / g), g: Math.round(m / g), b: Math.round(u / g) };
  }
  function An(n, t, e) {
    const o = [n[0], n[t - 1], n[(e - 1) * t], n[e * t - 1]].filter((i) => i !== null);
    if (o.length === 0) return null;
    const r = o.map(R);
    let a = null,
      c = 0;
    for (const i of r) {
      let l = 0;
      for (const s of r) T(i, s) <= Ln && l++;
      l <= c || ((a = i), (c = l));
    }
    return a ? { lab: a, confidence: c / r.length } : null;
  }
  function Sn({ imageData: n, imageWidth: t, imageHeight: e, sourceGrid: o, backgroundMode: r }) {
    const a = [];
    for (let i = 0; i < o.rows; i++)
      for (let l = 0; l < o.columns; l++)
        a.push(Tn({ imageData: n, imageWidth: t, imageHeight: e, sourceGrid: o, column: l, row: i }));
    if (r === "keep") return { cells: a, backgroundDetected: !1, backgroundConfidence: 0 };
    const c = An(a, o.columns, o.rows);
    return c
      ? r === "auto" && c.confidence < Rn
        ? { cells: a, backgroundDetected: !1, backgroundConfidence: c.confidence }
        : {
            cells: a.map((i) => (i && T(R(i), c.lab) <= xn ? null : i)),
            backgroundDetected: !0,
            backgroundConfidence: c.confidence,
          }
      : { cells: a, backgroundDetected: !1, backgroundConfidence: 0 };
  }
  const wn = 16;
  function A() {
    return typeof performance > "u" ? Date.now() : performance.now();
  }
  function _n(n) {
    const { imageData: t, imageWidth: e, imageHeight: o, targetWidth: r, targetHeight: a, activePalette: c } = n;
    if (c.length === 0) throw new Error("EMPTY_PALETTE");
    if (e <= 0 || o <= 0 || r <= 0 || a <= 0) throw new Error("INVALID_DIMENSIONS");
    if (t.length !== e * o * 4) throw new Error("INVALID_IMAGE_DATA");
    if (!n.sourceGrid) return;
    const { sourceGrid: i } = n,
      s = [i.originX, i.originY, i.pitchX, i.pitchY, i.columns, i.rows].every(Number.isFinite),
      d =
        i.pitchX > 0 &&
        i.pitchY > 0 &&
        Number.isInteger(i.columns) &&
        Number.isInteger(i.rows) &&
        i.columns === r &&
        i.rows === a;
    if (!s || !d) throw new Error("INVALID_SOURCE_GRID");
  }
  function X(n, t, e) {
    const o = [];
    for (let r = 0; r < e; r++) o.push(n.slice(r * t, (r + 1) * t));
    return o;
  }
  function Nn(n) {
    const { imageData: t, imageWidth: e, imageHeight: o, targetWidth: r, targetHeight: a, activePalette: c } = n,
      i = c.map((d) => ({ id: d.id, ...R(_(d.hex)) })),
      l = [];
    for (let d = 0; d < a; d++) {
      const m = Math.min(o - 1, Math.floor(((d + 0.5) * o) / a));
      for (let u = 0; u < r; u++) {
        const g = Math.min(e - 1, Math.floor(((u + 0.5) * e) / r)),
          h = (m * e + g) * 4;
        if (t[h + 3] <= wn) {
          l.push("");
          continue;
        }
        l.push(Y(R({ r: t[h], g: t[h + 1], b: t[h + 2] }), i));
      }
    }
    const s = l.filter(Boolean).length;
    if (s === 0) throw new Error("EMPTY_PATTERN");
    return {
      matrix: X(l, r, a),
      diagnostics: {
        backgroundDetected: !1,
        backgroundConfidence: 0,
        colorsUsed: new Set(l.filter(Boolean)).size,
        transparentCells: l.length - s,
        foregroundCells: s,
        processingMs: 0,
      },
    };
  }
  function yn(n) {
    if (!n.sourceGrid) throw new Error("INVALID_SOURCE_GRID");
    const t = Sn({
        imageData: n.imageData,
        imageWidth: n.imageWidth,
        imageHeight: n.imageHeight,
        sourceGrid: n.sourceGrid,
        backgroundMode: n.options.backgroundMode,
      }),
      e = tn(n.activePalette),
      o = t.cells.map((a) => (a ? en(a, e) : "")),
      r = o.filter(Boolean).length;
    if (r === 0) throw new Error("EMPTY_PATTERN");
    return {
      matrix: X(o, n.targetWidth, n.targetHeight),
      diagnostics: {
        backgroundDetected: t.backgroundDetected,
        backgroundConfidence: t.backgroundConfidence,
        colorsUsed: new Set(o.filter(Boolean)).size,
        transparentCells: o.length - r,
        foregroundCells: r,
        processingMs: 0,
      },
    };
  }
  function On(n) {
    _n(n);
    const t = A(),
      e = fn[n.options.preset];
    if (n.sourceGrid) {
      const l = yn(n);
      return ((l.diagnostics.processingMs = A() - t), l);
    }
    if (e.id === "legacy") {
      const l = Nn(n);
      return ((l.diagnostics.processingMs = A() - t), l);
    }
    if (e.id === "zippland") {
      const l = Dn(n);
      return ((l.diagnostics.processingMs = A() - t), l);
    }
    const o = an({
        imageData: n.imageData,
        width: n.imageWidth,
        height: n.imageHeight,
        mode: n.options.backgroundMode,
        preset: e,
      }),
      r = gn({
        imageData: n.imageData,
        imageWidth: n.imageWidth,
        imageHeight: n.imageHeight,
        targetWidth: n.targetWidth,
        targetHeight: n.targetHeight,
        backgroundMask: o.mask,
        preset: e,
      }),
      a = dn(r, n.activePalette, e.maxColors || n.activePalette.length, e.outlineWeight),
      c = ln(a, r, n.targetWidth, n.targetHeight, e),
      i = c.filter(Boolean).length;
    if (i === 0) throw new Error("EMPTY_PATTERN");
    return {
      matrix: X(c, n.targetWidth, n.targetHeight),
      diagnostics: {
        backgroundDetected: o.detected,
        backgroundConfidence: o.confidence,
        colorsUsed: new Set(c.filter(Boolean)).size,
        transparentCells: c.length - i,
        foregroundCells: i,
        processingMs: A() - t,
      },
    };
  }
  self.onmessage = (n) => {
    try {
      self.postMessage(On(n.data));
    } catch (t) {
      self.postMessage({ error: t instanceof Error ? t.message : "PROCESSING_FAILED" });
    }
  };
})();
