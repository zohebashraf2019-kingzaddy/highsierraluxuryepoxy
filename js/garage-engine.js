/*
 * High Sierra Garage Engine
 * A dependency-free WebGL2 renderer for the epoxy floor visualizer.
 *  - Real planar floor reflections (scene mirrored into a mip-mapped buffer)
 *  - Procedural, resolution-independent floor materials: flake broadcast,
 *    solid colour, metallic and marble-metallic epoxy, plus bare concrete
 *  - Hex LED ceiling, wood accent wall, cabinets, tool chest, garage door
 *  - Three lofted vehicles with clear-coat paint, glass, tyres and rims
 *  - Renders on demand only (no battery drain when idle)
 */

/* ------------------------------------------------------------------ math */
const V3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
};
function perspective(fov, asp, n, f) {
  const t = 1 / Math.tan(fov / 2);
  return new Float32Array([t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, (2 * f * n) / (n - f), 0]);
}
function lookAt(e, c, up) {
  const z = V3.norm(V3.sub(e, c)), x = V3.norm(V3.cross(up, z)), y = V3.cross(z, x);
  return new Float32Array([x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -V3.dot(x, e), -V3.dot(y, e), -V3.dot(z, e), 1]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s;
  }
  return o;
}
function trsY(x, y, z, yaw) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1]);
}
const IDENT = trsY(0, 0, 0, 0);
export const hexToLin = (h) => {
  const n = parseInt(h.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.pow(v / 255, 2.2));
};

/* -------------------------------------------------------------- geometry */
class Geo {
  constructor() { this.p = []; this.n = []; this.i = []; }
  get vc() { return this.p.length / 3; }
  quad(a, b, c, d, n) {
    const s = this.vc;
    for (const v of [a, b, c, d]) { this.p.push(...v); this.n.push(...n); }
    this.i.push(s, s + 1, s + 2, s, s + 2, s + 3);
  }
  box(x0, y0, z0, x1, y1, z1) {
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1]);
    this.quad([x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
    return this;
  }
  /** centred box helper: centre + full size */
  cbox(cx, cy, cz, w, h, d) { return this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2); }
  smooth(v0, i0) {
    for (let v = v0; v < this.vc; v++) { this.n[v * 3] = 0; this.n[v * 3 + 1] = 0; this.n[v * 3 + 2] = 0; }
    for (let k = i0; k < this.i.length; k += 3) {
      const a = this.i[k], b = this.i[k + 1], c = this.i[k + 2];
      const pa = this.p.slice(a * 3, a * 3 + 3), pb = this.p.slice(b * 3, b * 3 + 3), pc = this.p.slice(c * 3, c * 3 + 3);
      const fn = V3.cross(V3.sub(pb, pa), V3.sub(pc, pa));
      for (const v of [a, b, c]) { this.n[v * 3] += fn[0]; this.n[v * 3 + 1] += fn[1]; this.n[v * 3 + 2] += fn[2]; }
    }
    for (let v = v0; v < this.vc; v++) {
      const nn = V3.norm([this.n[v * 3], this.n[v * 3 + 1], this.n[v * 3 + 2]]);
      this.n[v * 3] = nn[0]; this.n[v * 3 + 1] = nn[1]; this.n[v * 3 + 2] = nn[2];
    }
  }
  /** Superellipse loft along z. f(t) -> {hw, bot, top, n} */
  loft(z0, z1, N, M, f) {
    const v0 = this.vc, i0 = this.i.length;
    const rings = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, z = z0 + (z1 - z0) * t, s = f(t);
      const e = 2 / s.n, yc = (s.bot + s.top) / 2, hh = Math.max((s.top - s.bot) / 2, 0.002);
      const ring = [];
      for (let j = 0; j < M; j++) {
        const a = (j / M) * Math.PI * 2, c = Math.cos(a), sn = Math.sin(a);
        const pt = [s.hw * Math.sign(c) * Math.pow(Math.abs(c), e), yc + hh * Math.sign(sn) * Math.pow(Math.abs(sn), e), z];
        ring.push(pt); this.p.push(...pt); this.n.push(0, 0, 0);
      }
      rings.push(ring);
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = v0 + i * M + j, b = v0 + i * M + ((j + 1) % M), c = v0 + (i + 1) * M + j, d = v0 + (i + 1) * M + ((j + 1) % M);
      this.i.push(a, c, b, b, c, d);
    }
    this.smooth(v0, i0);
    // flat caps
    for (const [ring, nz] of [[rings[0], -1], [rings[N], 1]]) {
      const c0 = this.vc; let cx = 0, cy = 0;
      ring.forEach((p) => { cx += p[0]; cy += p[1]; });
      this.p.push(cx / M, cy / M, ring[0][2]); this.n.push(0, 0, nz);
      ring.forEach((p) => { this.p.push(...p); this.n.push(0, 0, nz); });
      for (let j = 0; j < M; j++) this.i.push(c0, c0 + 1 + j, c0 + 1 + ((j + 1) % M));
    }
    return this;
  }
  /** Lathe around the x axis; profile = [[radius, x], ...] */
  lathe(profile, S) {
    const v0 = this.vc, i0 = this.i.length, P = profile.length;
    for (const [r, x] of profile) for (let j = 0; j < S; j++) {
      const a = (j / S) * Math.PI * 2; this.p.push(x, r * Math.cos(a), r * Math.sin(a)); this.n.push(0, 0, 0);
    }
    for (let k = 0; k < P - 1; k++) for (let j = 0; j < S; j++) {
      const a = v0 + k * S + j, b = v0 + k * S + ((j + 1) % S), c = v0 + (k + 1) * S + j, d = v0 + (k + 1) * S + ((j + 1) % S);
      this.i.push(a, c, b, b, c, d);
    }
    this.smooth(v0, i0);
    return this;
  }
  /** Disc facing +x/-x at x, optional angular range (for wheel arches) */
  disc(x, r, nx, S = 40, a0 = 0, a1 = Math.PI * 2) {
    const c0 = this.vc; this.p.push(x, 0, 0); this.n.push(nx, 0, 0);
    for (let j = 0; j <= S; j++) {
      const a = a0 + ((a1 - a0) * j) / S; this.p.push(x, r * Math.sin(a), r * Math.cos(a)); this.n.push(nx, 0, 0);
    }
    for (let j = 0; j < S; j++) this.i.push(c0, c0 + 1 + j, c0 + 2 + j);
    return this;
  }
  /** Append another geo with rotation about x, then y, then translation */
  merge(g, { rx = 0, ry = 0, t = [0, 0, 0] } = {}) {
    const base = this.vc, cx = Math.cos(rx), sx = Math.sin(rx), cy = Math.cos(ry), sy = Math.sin(ry);
    const tf = (x, y, z, tr) => {
      const y1 = y * cx - z * sx, z1 = y * sx + z * cx;
      const x2 = x * cy + z1 * sy, z2 = -x * sy + z1 * cy;
      return tr ? [x2 + t[0], y1 + t[1], z2 + t[2]] : [x2, y1, z2];
    };
    for (let v = 0; v < g.vc; v++) {
      this.p.push(...tf(g.p[v * 3], g.p[v * 3 + 1], g.p[v * 3 + 2], true));
      this.n.push(...tf(g.n[v * 3], g.n[v * 3 + 1], g.n[v * 3 + 2], false));
    }
    for (const k of g.i) this.i.push(k + base);
    return this;
  }
}

function spline(k) {
  return (t) => {
    const n = k.length;
    if (t <= k[0][0]) return k[0][1];
    if (t >= k[n - 1][0]) return k[n - 1][1];
    let i = 1; while (t > k[i][0]) i++;
    const p0 = k[Math.max(i - 2, 0)][1], p1 = k[i - 1][1], p2 = k[i][1], p3 = k[Math.min(i + 1, n - 1)][1];
    const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
    return 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u * u * u);
  };
}
const prof = (o) => {
  const f = {}; for (const k in o) f[k] = typeof o[k] === 'number' ? () => o[k] : spline(o[k]);
  return (t) => ({ hw: f.hw(t), bot: f.bot(t), top: f.top(t), n: f.n(t) });
};

/* ------------------------------------------------------------- materials */
const M = (hex, rough, metal = 0, cc = 0, ao = 1, emit = null) =>
  ({ color: hexToLin(hex), rough, metal, cc, ao, emit: emit ? hexToLin(emit).map((v) => v * 6) : [0, 0, 0] });
const MAT = {
  rubber: M('#0b0b0c', 0.82, 0, 0, 1),
  dark: M('#050506', 0.9, 0, 0, 1),
  trim: M('#0c0c0d', 0.35, 0, 0.4, 1),
  glass: M('#06080a', 0.04, 0, 0.7, 1),
  chrome: M('#e8e8e8', 0.07, 1, 0, 1),
  rimGun: M('#2a2c30', 0.22, 1, 0.3, 1),
  rimBlack: M('#111214', 0.28, 0.6, 0.6, 1),
  rimSilver: M('#c9ccd0', 0.18, 1, 0.2, 1),
  caliper: M('#b3121a', 0.3, 0, 0.6, 1),
  head: { color: [0.5, 0.5, 0.5], rough: 0.1, metal: 0, cc: 0.5, ao: 1, emit: [2.6, 2.75, 3.1] },
  tail: { color: [0.2, 0, 0], rough: 0.2, metal: 0, cc: 0.5, ao: 1, emit: [4.2, 0.12, 0.08] },
  amber: { color: [0.3, 0.1, 0], rough: 0.2, metal: 0, cc: 0.5, ao: 1, emit: [5, 1.9, 0.2] },
  cab: M('#16171a', 0.32, 0, 0.55, 0),
  cabLine: M('#050505', 0.8, 0, 0, 0),
  wood: M('#7a4f2c', 0.55, 0, 0.3, 0),
  steel: M('#b9bcc0', 0.25, 1, 0, 0),
  red: M('#9e0f14', 0.28, 0, 0.85, 0),
  door: M('#d9d9d6', 0.6, 0, 0, 0),
  led: { color: [0.8, 0.8, 0.8], rough: 0.5, metal: 0, cc: 0, ao: 0, emit: [5, 4.6, 3.9] },
};

/* --------------------------------------------------------------- vehicles */
function wheel(G, sx, cx, cz, R, wd, rim, spokes, caliper) {
  const ry = sx > 0 ? 0 : Math.PI, t = [cx, R, cz];
  const rimR = R * 0.64;
  G('rubber').merge(new Geo().lathe([
    [rimR * 0.98, -wd / 2], [R * 0.88, -wd / 2], [R * 0.975, -wd * 0.44], [R, -wd * 0.3],
    [R, wd * 0.3], [R * 0.975, wd * 0.44], [R * 0.88, wd / 2], [rimR * 0.98, wd / 2],
  ], 44), { ry, t });
  const ox = wd / 2 - 0.035;
  G(rim).merge(new Geo().lathe([[rimR, wd / 2 + 0.002], [rimR * 0.93, ox], [rimR * 0.93, -wd / 2 + 0.03]], 40), { ry, t });
  G('dark').merge(new Geo().disc(ox - 0.06, rimR * 0.94, 1), { ry, t });
  const sp = new Geo();
  for (let k = 0; k < spokes; k++) {
    const a = (k / spokes) * Math.PI * 2;
    sp.merge(new Geo().cbox(0, 0, rimR * 0.5, 0.035, rimR * 0.15, rimR * 0.92), { rx: a, t: [ox - 0.005, 0, 0] });
  }
  sp.merge(new Geo().lathe([[0.001, ox + 0.012], [rimR * 0.22, ox + 0.008], [rimR * 0.24, ox - 0.02]], 24));
  G(rim).merge(sp, { ry, t });
  if (caliper) G('caliper').merge(new Geo().cbox(ox - 0.075, rimR * 0.48, -rimR * 0.15, 0.05, rimR * 0.4, rimR * 0.55), { ry, t });
}
function arch(G, sx, x, cz, R) {
  G('dark').merge(new Geo().disc(0, R, sx, 32, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05), { t: [x, R / 1.12, cz] });
}

function buildCar(type) {
  const geos = {};
  const G = (m) => (geos[m] = geos[m] || new Geo());
  let info;
  if (type === 'sports') {
    const L = 4.55, R = 0.345, wd = 0.29, zf = 1.38, zr = -1.33;
    const body = prof({
      hw: [[0, 0.8], [0.04, 0.9], [0.16, 0.975], [0.3, 0.965], [0.5, 0.93], [0.72, 0.965], [0.88, 0.945], [0.97, 0.86], [1, 0.74]],
      bot: [[0, 0.36], [0.05, 0.23], [0.5, 0.17], [0.95, 0.18], [1, 0.28]],
      top: [[0, 0.72], [0.04, 0.86], [0.14, 0.93], [0.3, 0.945], [0.6, 0.915], [0.7, 0.86], [0.86, 0.75], [0.96, 0.645], [1, 0.5]],
      n: 3.8,
    });
    G('paint').loft(-L / 2, L / 2, 64, 56, body);
    G('glass').loft(-0.66, 1.02, 40, 48, prof({
      hw: [[0, 0.46], [0.25, 0.65], [0.6, 0.7], [0.85, 0.68], [1, 0.6]],
      bot: 0.8,
      top: [[0, 0.88], [0.12, 1.0], [0.45, 1.2], [0.62, 1.225], [0.75, 1.19], [0.97, 0.92], [1, 0.84]],
      n: 2.4,
    }));
    G('head').cbox(0.6, 0.57, 2.12, 0.3, 0.03, 0.2).cbox(-0.6, 0.57, 2.12, 0.3, 0.03, 0.2);
    G('tail').cbox(0, 0.715, -2.26, 1.45, 0.045, 0.1);
    G('trim').cbox(0, 0.3, 2.2, 1.3, 0.16, 0.14).cbox(0, 0.28, -2.22, 1.3, 0.14, 0.1);
    G('trim').cbox(0, 0.205, 0, 1.9, 0.07, 2.2);
    G('paint').cbox(0.93, 0.96, 0.88, 0.16, 0.08, 0.12).cbox(-0.93, 0.96, 0.88, 0.16, 0.08, 0.12);
    G('chrome').merge(new Geo().lathe([[0.045, 0], [0.045, 0.12]], 18), { ry: Math.PI / 2, t: [0.35, 0.3, -2.22] });
    G('chrome').merge(new Geo().lathe([[0.045, 0], [0.045, 0.12]], 18), { ry: Math.PI / 2, t: [-0.35, 0.3, -2.22] });
    for (const sx of [-1, 1]) for (const z of [zf, zr]) {
      const hw = body((z + L / 2) / L).hw;
      arch(G, sx, sx * (hw + 0.004), z, R * 1.12);
      wheel(G, sx, sx * (hw - wd / 2 + 0.025), z, R, wd, 'rimGun', 10, true);
    }
    info = { paint: M('#8c0a12', 0.38, 0, 1, 1), half: [0.98, L / 2], track: 0.98 - wd / 2 + 0.025, zf, zr, wd };
  } else if (type === 'truck') {
    const R = 0.46, wd = 0.34, zf = 1.95, zr = -1.75;
    const body = prof({ hw: [[0, 1.0], [0.96, 1.0], [1, 0.95]], bot: 0.68, top: [[0, 1.42], [0.42, 1.42], [0.5, 1.44], [0.62, 1.47], [0.96, 1.46], [1, 1.28]], n: 6 });
    G('paint').loft(-0.56, 2.95, 50, 48, body);
    G('glass').loft(-0.5, 1.25, 30, 44, prof({ hw: 0.9, bot: 1.38, top: [[0, 1.97], [0.55, 1.98], [0.64, 1.96], [1, 1.43]], n: 6 }));
    G('paint').loft(-0.53, 0.62, 16, 44, prof({ hw: 0.885, bot: 1.93, top: [[0, 2.005], [0.9, 2.005], [1, 1.97]], n: 8 }));
    // bed
    G('trim').box(-0.97, 0.68, -2.94, 0.97, 0.98, -0.62);
    G('paint').box(-1.0, 0.68, -2.95, -0.94, 1.42, -0.6).box(0.94, 0.68, -2.95, 1.0, 1.42, -0.6);
    G('paint').box(-1.0, 0.68, -2.95, 1.0, 1.42, -2.89).box(-1.0, 0.98, -0.66, 1.0, 1.42, -0.6);
    G('trim').box(-1.005, 1.42, -2.95, 1.005, 1.445, -0.6);
    // front
    G('trim').cbox(0, 1.17, 2.955, 1.42, 0.44, 0.06);
    G('chrome').cbox(0, 1.17, 2.94, 1.5, 0.5, 0.04);
    G('amber').cbox(-0.25, 1.33, 2.99, 0.06, 0.03, 0.02).cbox(0, 1.33, 2.99, 0.06, 0.03, 0.02).cbox(0.25, 1.33, 2.99, 0.06, 0.03, 0.02);
    G('head').cbox(0.79, 1.22, 2.945, 0.3, 0.15, 0.04).cbox(-0.79, 1.22, 2.945, 0.3, 0.15, 0.04);
    G('trim').cbox(0, 0.78, 3.02, 2.04, 0.26, 0.2);
    G('trim').cbox(0, 0.75, -3.0, 2.0, 0.2, 0.14);
    G('tail').cbox(0.97, 1.22, -2.955, 0.06, 0.3, 0.03).cbox(-0.97, 1.22, -2.955, 0.06, 0.3, 0.03);
    for (let k = -2; k <= 2; k++) G('amber').cbox(k * 0.2, 2.02, 0.58, 0.08, 0.025, 0.05);
    G('trim').cbox(1.08, 0.6, 0.35, 0.16, 0.05, 1.7).cbox(-1.08, 0.6, 0.35, 0.16, 0.05, 1.7);
    G('trim').cbox(1.05, 1.62, 1.12, 0.12, 0.2, 0.22).cbox(-1.05, 1.62, 1.12, 0.12, 0.2, 0.22);
    for (const sx of [-1, 1]) for (const z of [zf, zr]) {
      arch(G, sx, sx * 1.006, z, R * 1.2);
      wheel(G, sx, sx * (1.0 - wd / 2 + 0.05), z, R, wd, 'rimBlack', 6, false);
    }
    info = { paint: M('#2f3236', 0.32, 0.2, 1, 1), half: [1.04, 2.98], track: 1.0 - wd / 2 + 0.05, zf, zr, wd };
  } else {
    const L = 5.05, R = 0.4, wd = 0.3, zf = 1.55, zr = -1.5;
    const body = prof({
      hw: [[0, 0.92], [0.05, 0.98], [0.5, 0.99], [0.93, 0.98], [1, 0.9]],
      bot: [[0, 0.5], [0.06, 0.4], [0.94, 0.4], [1, 0.48]],
      top: [[0, 1.0], [0.05, 1.08], [0.62, 1.1], [0.7, 1.05], [0.9, 1.0], [1, 0.82]],
      n: 4,
    });
    G('paint').loft(-L / 2, L / 2, 60, 52, body);
    G('glass').loft(-2.36, 0.95, 40, 48, prof({ hw: [[0, 0.84], [0.5, 0.88], [1, 0.84]], bot: 1.0, top: [[0, 1.1], [0.035, 1.73], [0.7, 1.76], [1, 1.06]], n: 5 }));
    G('paint').loft(-2.3, 0.02, 30, 44, prof({ hw: 0.85, bot: 1.71, top: [[0, 1.775], [0.9, 1.785], [1, 1.76]], n: 7 }));
    G('chrome').cbox(0.68, 1.81, -1.1, 0.04, 0.035, 2.0).cbox(-0.68, 1.81, -1.1, 0.04, 0.035, 2.0);
    G('head').cbox(0.66, 0.9, 2.44, 0.32, 0.04, 0.16).cbox(-0.66, 0.9, 2.44, 0.32, 0.04, 0.16);
    G('trim').cbox(0, 0.72, 2.5, 0.95, 0.24, 0.08);
    G('chrome').cbox(0, 0.84, 2.53, 0.95, 0.025, 0.04);
    G('tail').cbox(0.78, 1.0, -2.52, 0.3, 0.09, 0.06).cbox(-0.78, 1.0, -2.52, 0.3, 0.09, 0.06);
    G('trim').cbox(0, 0.45, -2.5, 1.7, 0.16, 0.1).cbox(0, 0.42, 0, 2.0, 0.1, 2.3);
    G('paint').cbox(0.96, 1.15, 0.85, 0.14, 0.11, 0.18).cbox(-0.96, 1.15, 0.85, 0.14, 0.11, 0.18);
    for (const sx of [-1, 1]) for (const z of [zf, zr]) {
      arch(G, sx, sx * 0.995, z, R * 1.14);
      wheel(G, sx, sx * (0.99 - wd / 2 + 0.03), z, R, wd, 'rimSilver', 5, false);
    }
    info = { paint: M('#e9e8e3', 0.4, 0, 1, 1), half: [1.0, L / 2], track: 0.99 - wd / 2 + 0.03, zf, zr, wd };
  }
  return { geos, info };
}

const CAR_PLACEMENT = {
  sports: { x: -1.5, z: -0.35, yaw: 0.3 },
  truck: { x: -1.55, z: -0.42, yaw: 0.08 },
  suv: { x: -1.55, z: -0.3, yaw: 0.22 },
};

/* ---------------------------------------------------------------- shaders */
const COMMON = `#version 300 es
precision highp float; precision highp int;
uniform vec3 uRoom; uniform vec3 uCam; uniform float uMirror; uniform float uExposure;
uniform vec3 uL[6]; uniform float uLI; uniform vec3 uFloorEnv;
vec3 aces(vec3 x){return clamp((x*(2.51*x+.03))/(x*(2.43*x+.59)+.14),0.,1.);}
vec3 toOut(vec3 c){return pow(aces(c*uExposure),vec3(1./2.2));}
uint pcg(uint v){uint s=v*747796405u+2891336453u;uint w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
float hc(ivec2 c,uint s){return float(pcg(pcg(uint(c.x)*3u+s)+uint(c.y)))*(1./4294967295.);}
float vn(vec2 p){ivec2 i=ivec2(floor(p));vec2 f=fract(p);vec2 u=f*f*(3.-2.*f);
 return mix(mix(hc(i,7u),hc(i+ivec2(1,0),7u),u.x),mix(hc(i+ivec2(0,1),7u),hc(i+ivec2(1,1),7u),u.x),u.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(1.6,1.2,-1.2,1.6);for(int i=0;i<5;i++){s+=a*vn(p);p=m*p+vec2(17.1,9.3);a*=.5;}return s/.97;}
float hexEdge(vec2 p,float s){p/=s;const vec2 r=vec2(1.,1.7320508);vec2 h=r*.5;vec2 a=mod(p,r)-h;vec2 b=mod(p-h,r)-h;
 vec2 g=dot(a,a)<dot(b,b)?a:b;vec2 q=abs(g);return (.5-max(q.x,dot(q,vec2(.5,.8660254))))*s;}
float hexDist(vec2 p){vec2 q=abs(p-vec2(0.,-.1))-vec2(2.55,2.75);float box=max(q.x,q.y);if(box>0.)return box;
 return min(hexEdge(p+vec2(.46,.2),.92),-box);}
float hexLight(vec2 p,float w){return smoothstep(w,w*.35,hexDist(p));}
vec3 lightAt(vec3 P,vec3 N){vec3 d=vec3(0.);for(int i=0;i<6;i++){vec3 L=uL[i]-P;float d2=dot(L,L);L*=inversesqrt(d2);
 d+=max(dot(N,L),0.)/(1.+.22*d2);}return d*uLI;}
vec3 envRay(vec3 p,vec3 r,float rough){
 float t=1e9;int s=-1;float tt;
 if(r.y>1e-4){tt=(uRoom.y-p.y)/r.y;if(tt<t){t=tt;s=0;}}
 if(r.y<-1e-4){tt=-p.y/r.y;if(tt<t){t=tt;s=1;}}
 if(r.x>1e-4){tt=(uRoom.x-p.x)/r.x;if(tt<t){t=tt;s=2;}}
 if(r.x<-1e-4){tt=(-uRoom.x-p.x)/r.x;if(tt<t){t=tt;s=4;}}
 if(r.z>1e-4){tt=(uRoom.z-p.z)/r.z;if(tt<t){t=tt;s=3;}}
 if(r.z<-1e-4){tt=(-uRoom.z-p.z)/r.z;if(tt<t){t=tt;s=5;}}
 vec3 h=p+r*max(t,0.);
 if(s==0){float w=.03+rough*.3+t*.004;return vec3(.3)+vec3(1.,.98,.95)*hexLight(h.xz,w)*mix(8.,1.6,rough);}
 if(s==1)return uFloorEnv;
 if(s==3)return vec3(.55);
 if(s==4)return vec3(.16,.09,.05);
 if(s==5)return vec3(.08)+vec3(.5,.42,.32)*step(-.6,h.x)*step(.9,h.y)*step(h.y,1.5);
 return vec3(.32);
}
`;
const VS = `#version 300 es
layout(location=0) in vec3 aP; layout(location=1) in vec3 aN;
uniform mat4 uVP; uniform mat4 uM; uniform float uMirror;
out vec3 vW; out vec3 vN;
void main(){vec4 w=uM*vec4(aP,1.);vec3 n=mat3(uM)*aN;if(uMirror>.5){w.y=-w.y;n.y=-n.y;}vW=w.xyz;vN=n;gl_Position=uVP*w;}`;

const FS_MESH = COMMON + `
in vec3 vW; in vec3 vN; out vec4 o;
uniform vec3 uColor; uniform vec4 uMat; uniform vec3 uEmit;
void main(){
 vec3 P=vW,N=normalize(vN);
 if(uMirror>.5){if(P.y>.002)discard;P.y=-P.y;N.y=-N.y;}
 vec3 cam=uMirror>.5?vec3(uCam.x,-uCam.y,uCam.z):uCam;
 vec3 V=normalize(cam-P); if(dot(N,V)<0.)N=-N;
 float rough=uMat.x,metal=uMat.y,cc=uMat.z,aoF=uMat.w;
 float NV=max(dot(N,V),1e-3);
 float ao=mix(1.,mix(.28,1.,smoothstep(.02,.8,P.y)),aoF);
 vec3 dif=lightAt(P,N);
 vec3 amb=mix(uFloorEnv*.9+vec3(.025),vec3(.3,.3,.31),N.y*.5+.5)*ao;
 vec3 R=reflect(-V,N);
 float a=max(rough*rough,.004),a2=a*a; vec3 spec=vec3(0.); float specC=0.;
 for(int i=0;i<6;i++){vec3 L=uL[i]-P;float d2=dot(L,L);L*=inversesqrt(d2);vec3 H=normalize(L+V);float nh=max(dot(N,H),0.);
  float nl=max(dot(N,L),0.);float dn=nh*nh*(a2-1.)+1.;spec+=vec3(a2/(3.14159*dn*dn))*nl/(1.+.22*d2);
  float c2=.0016;float dc=nh*nh*(c2-1.)+1.;specC+=c2/(3.14159*dc*dc)*nl/(1.+.22*d2);}
 spec*=uLI*.06; specC*=uLI*.04;
 vec3 F0=mix(vec3(.04),uColor,metal);
 vec3 F=F0+(1.-F0)*pow(1.-NV,5.)*(1.-rough);
 vec3 env=envRay(P+N*.005,R,rough);
 vec3 col=uColor*(1.-metal)*(dif+amb)+(env*(1.-rough*.8)*ao+spec)*F;
 if(cc>0.){float Fc=.04+.96*pow(1.-NV,5.);vec3 envC=envRay(P+N*.005,R,.0)*ao;col=col*(1.-Fc*cc)+(envC*Fc+specC)*cc;}
 col+=uEmit;
 o=vec4(toOut(col),1.);
}`;

const FS_ROOM = COMMON + `
in vec3 vW; in vec3 vN; out vec4 o; uniform int uSurf;
void main(){
 vec3 P=vW,N=normalize(vN);
 if(uMirror>.5){if(P.y>.002)discard;P.y=-P.y;N.y=-N.y;}
 vec3 col;
 if(uSurf==4){
  float d=hexDist(P.xz);
  float line=smoothstep(.026,.01,d);
  vec3 em=vec3(1.,.985,.96)*(line*7.+exp(-max(d,0.)*20.)*.5);
  float edge=min(uRoom.x-abs(P.x),uRoom.z-abs(P.z));
  col=vec3(.5)*(vec3(.24)+vec3(.35)*exp(-max(d,0.)*2.5))*(.7+.3*smoothstep(0.,.8,edge))+em;
 } else {
  vec3 alb=vec3(.5); vec3 em=vec3(0.);
  if(uSurf==0){
   float sw=.145; float u=P.z/sw; float sid=floor(u); float f=fract(u);
   float groove=smoothstep(0.,.06,f)*smoothstep(1.,.94,f);
   float tint=hc(ivec2(int(sid),3),11u);
   float grain=fbm(vec2(P.z*35.,P.y*1.4+tint*40.));
   alb=mix(vec3(.08,.045,.022),vec3(.27,.15,.07),grain)*(.7+.6*tint)*mix(.22,1.,groove);
  } else if(uSurf==1){
   alb=vec3(.5,.51,.52)*(.96+.08*fbm(P.zy*4.)); if(P.y<.11)alb=vec3(.74);
  } else if(uSurf==2){
   alb=vec3(.07,.072,.078)*(.9+.2*fbm(P.xy*3.));
   if(P.x>-.6&&P.x<3.4&&P.y>.9&&P.y<1.5)em=vec3(1.,.88,.7)*.55*exp(-(1.5-P.y)*4.);
  } else {
   alb=vec3(.5);
   if(abs(P.x)<2.45&&P.y<2.3){vec2 g=vec2((P.x+2.45)/4.9*6.,P.y/2.3*4.);vec2 f=fract(g);
    float e=min(min(f.x,1.-f.x)*4.9/6.,min(f.y,1.-f.y)*2.3/4.);
    alb=vec3(.78)*(.86+.14*smoothstep(.0,.06,e))*(.55+.45*smoothstep(0.,.012,e));
    if(P.y>1.95&&P.y<2.2&&fract(g.x)>.12&&fract(g.x)<.88)alb=vec3(.25,.3,.34);}
  }
  vec3 dif=lightAt(P,N);
  float ao=(.5+.5*smoothstep(0.,.55,P.y))*(.78+.22*smoothstep(0.,.45,uRoom.y-P.y));
  float dc=abs(N.x)>.5?uRoom.z-abs(P.z):uRoom.x-abs(P.x);
  ao*=.68+.32*smoothstep(0.,.7,dc);
  col=alb*(dif+vec3(.2))*ao+em;
 }
 o=vec4(toOut(col),1.);
}`;

const FS_LOGO = COMMON + `
in vec3 vW; in vec3 vN; out vec4 o; uniform sampler2D uTex; uniform vec4 uRect;
void main(){vec3 P=vW;if(uMirror>.5){if(P.y>.002)discard;P.y=-P.y;}
 vec2 uv=vec2((P.x-uRect.x)/uRect.z,1.-(P.y-uRect.y)/uRect.w);
 vec3 t=texture(uTex,uv).rgb; o=vec4(t*1.05,1.);}`;

const FS_FLOOR = COMMON + `
in vec3 vW; in vec3 vN; out vec4 o;
uniform sampler2D uRefl; uniform vec2 uRes; uniform vec2 uReflSize; uniform float uSplit;
uniform vec3 uBase; uniform vec3 uChips[5]; uniform vec3 uChipAvg; uniform float uCover,uGap,uCoverEff,uFS;
uniform int uFinish; uniform vec3 uMetA,uMetB,uVein;
uniform vec4 uCar; uniform vec2 uCarHalf; uniform vec2 uWh[4]; uniform vec2 uWhS;

float sdBox(vec2 p,vec2 b){vec2 q=abs(p)-b;return length(max(q,0.))+min(max(q.x,q.y),0.);}
float carShadow(vec2 p){
 if(uCar.w<.5)return 1.;
 vec2 d=p-uCar.xy;float c=cos(uCar.z),s=sin(uCar.z);vec2 l=vec2(c*d.x-s*d.y,s*d.x+c*d.y);
 float sd=sdBox(l,uCarHalf*vec2(.9,.93));
 float sh=1.-.66*(1.-smoothstep(-.45,.55,sd));
 for(int i=0;i<4;i++){float w=sdBox(l-uWh[i],uWhS);sh*=1.-.6*exp(-max(w,0.)*15.);}
 return sh;
}
float wallAO(vec2 p){float d=min(min(uRoom.x-abs(p.x),uRoom.z-p.y),p.y+uRoom.z);
 if(p.x>-.6)d=min(d,p.y+uRoom.z-.6);
 if(p.x>2.95&&p.y>-2.4&&p.y<-1.15)d=min(d,max(3.0-p.x,0.));
 return 1.-.42*exp(-max(d,0.)*4.5);}

vec3 chipAt(vec2 p,out float gl){
 vec2 g=p*uFS; ivec2 ic=ivec2(floor(g)); vec2 f=fract(g);
 float d1=9.,d2=9.; ivec2 bc=ic;
 for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){ivec2 c=ic+ivec2(i,j);
  vec2 r=vec2(float(i),float(j))+vec2(hc(c,1u),hc(c,2u))-f;float d=dot(r,r);
  if(d<d1){d2=d1;d1=d;bc=c;}else if(d<d2)d2=d;}
 float edge=sqrt(d2)-sqrt(d1); gl=0.;
 if(hc(bc,3u)<uCover&&edge>uGap){int k=int(hc(bc,4u)*4.999);gl=step(.9,hc(bc,6u));
  return uChips[k]*(.86+.28*hc(bc,5u));}
 return uBase*(.93+.14*vn(p*35.));
}
vec3 metal(vec2 p,float fw,out float sp){
 vec2 q=p*.42;
 vec2 w=vec2(fbm(q+vec2(1.7,9.2)),fbm(q+vec2(8.3,2.8)));
 vec2 w2=vec2(fbm(q+2.6*w+vec2(4.1,1.3)),fbm(q+2.6*w+vec2(6.7,3.9)));
 float v=fbm(q+2.2*w2);
 vec3 c;
 if(uFinish==3){
  c=mix(uMetA,uMetB,smoothstep(.4,.88,v));
  c*=.78+.44*fbm(p*4.5+w2*7.);
  c=mix(c,uMetB*1.15,pow(smoothstep(.55,.9,v),3.)*.6);
 } else {
  c=mix(uMetA,mix(uMetA,uMetB,.38),smoothstep(.35,.95,v))*(.85+.3*fbm(p*5.+w2*3.));
  float s=abs(sin((v*6.+w2.y*2.5)*3.14159));
  float vein=smoothstep(.12,.0,s)*smoothstep(.3,.55,fbm(p*.7+3.));
  float hair=smoothstep(.04,.0,abs(sin((v*11.+w.x*4.)*3.14159)))*smoothstep(.45,.7,fbm(p*1.3+9.));
  c=mix(c,uVein,clamp(vein+hair*.55,0.,1.));
 }
 float fade=1.-smoothstep(.0012,.005,fw);
 sp=step(.987,hc(ivec2(floor(p*650.)),9u))*fade;
 return c;
}
vec3 concrete(vec2 p,float fw){
 float n=fbm(p*1.1)*.5+vn(p*9.)*.25+vn(p*45.)*.25*(1.-smoothstep(.004,.02,fw));
 vec3 c=vec3(.33,.32,.3)*(.68+.6*n);
 c*=1.-.32*smoothstep(.55,.8,fbm(p*.6+vec2(3.1,7.7)));
 c+=vec3(.05,.05,.045)*smoothstep(.62,.85,fbm(p*1.7+11.));
 c*=1.-.25*smoothstep(.45,.75,fbm(p*3.3+4.))*smoothstep(.4,.7,fbm(p*.5+1.));
 float o1=length((p-vec2(-1.3,1.2))*vec2(1.,1.35))+(fbm(p*3.5)-.5)*.5; c*=1.-.55*smoothstep(.6,.05,o1);
 float o2=length(p-vec2(1.7,.6))+(fbm(p*4.+2.)-.5)*.4; c*=1.-.45*smoothstep(.45,.0,o2);
 float o3=length(p-vec2(.4,-1.9))+(fbm(p*5.+7.)-.5)*.3; c*=1.-.3*smoothstep(.3,.0,o3);
 c*=1.-.16*smoothstep(.2,.0,abs(abs(p.x-1.75)-.8)-.06)*smoothstep(3.6,-1.5,p.y)*(.5+.5*vn(p*vec2(3.,.4)));
 float j=min(abs(p.x-.05),abs(p.y+.2)); c*=1.-.6*(1.-smoothstep(.004,.004+fw*1.5,j));
 vec2 cq=p*.8+.45*vec2(fbm(p*2.5),fbm(p*2.5+5.)); ivec2 ic=ivec2(floor(cq)); vec2 f=fract(cq); float d1=9.,d2=9.;
 for(int jj=-1;jj<=1;jj++)for(int ii=-1;ii<=1;ii++){ivec2 cc=ic+ivec2(ii,jj);vec2 r=vec2(float(ii),float(jj))+vec2(hc(cc,1u),hc(cc,2u))-f;float d=dot(r,r);if(d<d1){d2=d1;d1=d;}else if(d<d2)d2=d;}
 float crack=(1.-smoothstep(0.,.006+fw*1.2,sqrt(d2)-sqrt(d1)))*smoothstep(.52,.66,fbm(p*.9+21.));
 c*=1.-.65*crack;
 return c;
}
void main(){
 vec2 p=vW.xz; vec2 dx=dFdx(p),dy=dFdy(p); float fw=max(length(dx),length(dy));
 vec3 V=normalize(uCam-vW); float NV=clamp(V.y,0.,1.);
 vec2 suv=gl_FragCoord.xy/uRes;
 float sh=carShadow(p)*wallAO(p);
 vec3 lit=lightAt(vW,vec3(0.,1.,0.))*.62+vec3(.13);
 if(suv.x<uSplit){o=vec4(toOut(concrete(p,fw)*lit*sh),1.);return;}
 float gl=0.,sp=0.; vec3 alb;
 if(uFinish>=3){alb=metal(p,fw,sp);}
 else if(uCover<=0.){alb=uBase*(.94+.12*fbm(p*2.))*(.97+.06*vn(p*40.));}
 else{
  float cpp=fw*uFS;
  vec3 avg=mix(uBase,uChipAvg,uCoverEff)*(.93+.14*fbm(p*3.));
  float g1,g2,g3,g4;
  if(cpp<.45)alb=chipAt(p,gl);
  else if(cpp<2.4){alb=(chipAt(p+dx*.25+dy*.25,g1)+chipAt(p-dx*.25+dy*.25,g2)+chipAt(p+dx*.25-dy*.25,g3)+chipAt(p-dx*.25-dy*.25,g4))*.25;gl=(g1+g2+g3+g4)*.25;}
  else alb=avg;
  alb=mix(alb,avg,smoothstep(1.3,2.4,cpp));
 }
 vec3 base=toOut(alb*lit*sh);
 float k,lod;
 if(uFinish==0){k=.05;lod=6.;}else if(uFinish==1){k=.5;lod=3.2;}else if(uFinish==2){k=1.;lod=.35;}else{k=1.08;lod=.25;}
 float fres=.04+.96*pow(1.-NV,5.);
 vec3 rf;
 if(uFinish<=1){vec2 t=exp2(lod)/uReflSize;
  rf=(textureLod(uRefl,suv+vec2(t.x,0.),lod).rgb+textureLod(uRefl,suv-vec2(t.x,0.),lod).rgb+textureLod(uRefl,suv+vec2(0.,t.y),lod).rgb+textureLod(uRefl,suv-vec2(0.,t.y),lod).rgb)*.25;}
 else rf=textureLod(uRefl,suv,lod).rgb;
 float amt=k*(.16+.84*fres)*.8;
 vec3 col=base*(1.-amt*.55)+pow(rf,vec3(1.9))*amt+pow(rf,vec3(7.))*k*.5;
 float rl=max(rf.r,max(rf.g,rf.b));
 col+=(gl*.45+sp*1.2)*smoothstep(.4,.95,rl)*vec3(1.,.96,.88)*min(k,1.);
 o=vec4(col,1.);
}`;

/* ----------------------------------------------------------------- engine */
export class GarageEngine {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    this.room = [3.5, 3.0, 3.6];
    this.lights = [];
    for (const x of [-1.7, 1.7]) for (const z of [-2.2, 0, 2.0]) this.lights.push(x, 2.82, z);
    this.dirty = true;
    this.split = -1;
    this.carType = 'sports';
    this.showCar = true;
    this.floor = null;
    this.cam = { target: [0, 0, 0], yaw: 0, pitch: 0.5, dist: 4, fov: 55 };
    this.tween = null;

    this.pMesh = this.program(VS, FS_MESH);
    this.pRoom = this.program(VS, FS_ROOM);
    this.pFloor = this.program(VS, FS_FLOOR);
    this.pLogo = this.program(VS, FS_LOGO);

    this.buildRoom();
    this.cars = {};
    for (const t of ['sports', 'truck', 'suv']) this.cars[t] = this.uploadCar(buildCar(t));
    this.reflTex = null;
    this.loadLogo();
    this.resize();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  program(vs, fs) {
    const gl = this.gl;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aP'); gl.bindAttribLocation(p, 1, 'aN');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const cache = {};
    return { p, u: (n) => (n in cache ? cache[n] : (cache[n] = gl.getUniformLocation(p, n))) };
  }

  upload(g) {
    const gl = this.gl, vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vb = (data, loc) => {
      const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    };
    vb(g.p, 0); vb(g.n, 1);
    const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(g.i), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return { vao, count: g.i.length };
  }

  buildRoom() {
    const [W, H, D] = this.room;
    const q = (a, b, c, d, n) => { const g = new Geo(); g.quad(a, b, c, d, n); return this.upload(g); };
    this.surfaces = [
      { m: q([-W, 0, -D], [-W, 0, D], [-W, H, D], [-W, H, -D], [1, 0, 0]), id: 0 },
      { m: q([W, 0, D], [W, 0, -D], [W, H, -D], [W, H, D], [-1, 0, 0]), id: 1 },
      { m: q([-W, 0, -D], [W, 0, -D], [W, H, -D], [-W, H, -D], [0, 0, 1]), id: 2 },
      { m: q([W, 0, D], [-W, 0, D], [-W, H, D], [W, H, D], [0, 0, -1]), id: 3 },
      { m: q([-W, H, -D], [W, H, -D], [W, H, D], [-W, H, D], [0, -1, 0]), id: 4 },
    ];
    this.floorMesh = q([-W, 0, -D], [W, 0, -D], [W, 0, D], [-W, 0, D], [0, 1, 0]);
    this.logoRect = [-2.95, 1.72, 1.7, 1.0];
    const lr = this.logoRect, lz = -D + 0.012;
    this.logoMesh = q([lr[0], lr[1], lz], [lr[0] + lr[2], lr[1], lz], [lr[0] + lr[2], lr[1] + lr[3], lz], [lr[0], lr[1] + lr[3], lz], [0, 0, 1]);

    const geos = {}; const G = (m) => (geos[m] = geos[m] || new Geo());
    const bz0 = -D, bz1 = -D + 0.6, x0 = -0.6, x1 = 3.4;
    G('cabLine').box(x0 + 0.04, 0, bz1 - 0.06, x1, 0.1, bz1 - 0.04);
    G('cab').box(x0, 0.1, bz0, x1, 0.9, bz1);
    G('wood').box(x0 - 0.02, 0.9, bz0, x1 + 0.02, 0.945, bz1 + 0.03);
    G('cab').box(x0, 1.5, bz0, x1, 2.38, bz0 + 0.36);
    G('led').box(x0 + 0.05, 1.495, bz0 + 0.25, x1 - 0.05, 1.5, bz0 + 0.3);
    const n = 7, w = (x1 - x0) / n;
    for (let k = 0; k <= n; k++) {
      const x = x0 + k * w;
      if (k > 0 && k < n) { G('cabLine').cbox(x, 0.5, bz1 + 0.002, 0.008, 0.78, 0.006); G('cabLine').cbox(x, 1.94, bz0 + 0.362, 0.008, 0.86, 0.006); }
      if (k < n) {
        G('cabLine').cbox(x + w / 2, 0.72, bz1 + 0.002, w - 0.02, 0.006, 0.006);
        G('steel').cbox(x + w / 2, 0.81, bz1 + 0.018, w * 0.5, 0.018, 0.03);
        G('steel').cbox(x + w - 0.06, 1.62, bz0 + 0.378, 0.018, 0.22, 0.03);
      }
    }
    // red rolling tool chest on right wall
    const tx0 = 3.0, tx1 = 3.48, tz0 = -2.35, tz1 = -1.2;
    G('red').box(tx0, 0.14, tz0, tx1, 1.0, tz1);
    G('red').box(tx0 + 0.04, 1.02, tz0 + 0.03, tx1, 1.42, tz1 - 0.03);
    G('steel').box(tx0 - 0.01, 1.0, tz0 - 0.01, tx1, 1.025, tz1 + 0.01);
    for (const y of [0.32, 0.5, 0.66, 0.8, 0.92, 1.12, 1.26, 1.36]) {
      G('cabLine').cbox(tx0 - 0.002 + (y > 1 ? 0.04 : 0), y - 0.06, (tz0 + tz1) / 2, 0.006, 0.006, tz1 - tz0 - 0.06);
      G('steel').cbox(tx0 - 0.015 + (y > 1 ? 0.04 : 0), y - 0.02, (tz0 + tz1) / 2, 0.02, 0.018, (tz1 - tz0) * 0.7);
    }
    for (const z of [tz0 + 0.06, tz1 - 0.06]) G('cabLine').cbox(tx0 + 0.1, 0.07, z, 0.08, 0.14, 0.08).cbox(tx1 - 0.1, 0.07, z, 0.08, 0.14, 0.08);
    // house entry door on right wall
    G('door').box(W - 0.03, 0, 0.3, W, 2.05, 1.2);
    G('cabLine').box(W - 0.035, 0, 0.25, W - 0.01, 2.1, 0.3).box(W - 0.035, 0, 1.2, W - 0.01, 2.1, 1.25).box(W - 0.035, 2.05, 0.25, W - 0.01, 2.1, 1.25);
    G('steel').cbox(W - 0.06, 1.0, 0.4, 0.05, 0.04, 0.12);
    this.deco = Object.entries(geos).map(([m, g]) => ({ ...this.upload(g), mat: MAT[m] }));
  }

  uploadCar({ geos, info }) {
    const parts = Object.entries(geos).map(([m, g]) => ({ ...this.upload(g), mat: m === 'paint' ? info.paint : MAT[m] }));
    return { parts, info };
  }

  loadLogo() {
    const gl = this.gl, tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    this.logoTex = tex;
    const img = new Image();
    img.onload = () => {
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.dirty = true;
    };
    img.src = new URL('../assets/img/logo-mark.jpg', import.meta.url).href;
  }

  resize() {
    const gl = this.gl, c = this.canvas;
    const mobile = Math.min(window.innerWidth, window.innerHeight) < 700;
    const dpr = Math.min(window.devicePixelRatio || 1, mobile ? 1.6 : 1.75);
    const w = Math.max(2, Math.round(c.clientWidth * dpr)), h = Math.max(2, Math.round(c.clientHeight * dpr));
    if (c.width === w && c.height === h && this.reflTex) return;
    c.width = w; c.height = h;
    const rw = Math.max(2, Math.round(w * 0.55)), rh = Math.max(2, Math.round(h * 0.55));
    if (this.reflTex) { gl.deleteTexture(this.reflTex); gl.deleteFramebuffer(this.fbo); gl.deleteRenderbuffer(this.rbo); }
    this.reflTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.reflTex);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(rw, rh))) + 1, gl.RGBA8, rw, rh);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.rbo = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.rbo);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, rw, rh);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.reflTex, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.rbo);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.reflSize = [rw, rh];
    this.dirty = true;
  }

  /* -------------------------------------------------------------- camera */
  camPos() {
    const c = this.cam, cp = Math.cos(c.pitch);
    const p = [c.target[0] + c.dist * cp * Math.sin(c.yaw), c.target[1] + c.dist * Math.sin(c.pitch), c.target[2] + c.dist * cp * Math.cos(c.yaw)];
    const [W, H, D] = this.room;
    p[0] = Math.max(-W + 0.15, Math.min(W - 0.15, p[0]));
    p[1] = Math.max(0.12, Math.min(H - 0.1, p[1]));
    p[2] = Math.max(-D + 0.7, Math.min(D - 0.12, p[2]));
    return p;
  }
  static toSpherical(pos, target, fov) {
    const d = V3.sub(pos, target), dist = Math.hypot(d[0], d[1], d[2]);
    return { target: [...target], yaw: Math.atan2(d[0], d[2]), pitch: Math.asin(d[1] / dist), dist, fov };
  }
  flyTo(pos, target, fov, ms = 1000) {
    const to = GarageEngine.toSpherical(pos, target, fov), from = { ...this.cam, target: [...this.cam.target] };
    let dy = to.yaw - from.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    to.yaw = from.yaw + dy;
    if (ms <= 0) { this.cam = to; this.dirty = true; return; }
    this.tween = { from, to, t0: performance.now(), ms };
  }
  orbit(dx, dy) {
    this.tween = null;
    this.cam.yaw -= dx * 0.006;
    this.cam.pitch = Math.max(0.04, Math.min(1.553, this.cam.pitch + dy * 0.005));
    this.dirty = true;
  }
  zoom(f) {
    this.tween = null;
    this.cam.dist = Math.max(0.35, Math.min(7, this.cam.dist * f));
    this.dirty = true;
  }

  /* ------------------------------------------------------------ settings */
  setCar(type, show) { this.carType = type; this.showCar = show && type !== 'empty' && !!this.cars[type]; this.dirty = true; }
  setSplit(x) { this.split = x; this.dirty = true; }
  setFloor(f) { this.floor = f; this.dirty = true; }

  /* -------------------------------------------------------------- render */
  loop(now) {
    if (this.tween) {
      const { from, to, t0, ms } = this.tween;
      let u = Math.min(1, (now - t0) / ms); const e = u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
      const L = (a, b) => a + (b - a) * e;
      this.cam = { target: from.target.map((v, i) => L(v, to.target[i])), yaw: L(from.yaw, to.yaw), pitch: L(from.pitch, to.pitch), dist: L(from.dist, to.dist), fov: L(from.fov, to.fov) };
      if (u >= 1) this.tween = null;
      this.dirty = true;
    }
    if (this.dirty) { this.dirty = false; this.render(); }
    requestAnimationFrame(this.loop);
  }

  common(prog, mirror) {
    const gl = this.gl;
    gl.useProgram(prog.p);
    gl.uniformMatrix4fv(prog.u('uVP'), false, this.vp);
    gl.uniform3fv(prog.u('uRoom'), this.room);
    gl.uniform3fv(prog.u('uCam'), this.eye);
    gl.uniform1f(prog.u('uMirror'), mirror ? 1 : 0);
    gl.uniform1f(prog.u('uExposure'), 0.92);
    gl.uniform3fv(prog.u('uL[0]'), this.lights);
    gl.uniform1f(prog.u('uLI'), 1.2);
    gl.uniform3fv(prog.u('uFloorEnv'), this.floorEnv);
  }

  drawScene(mirror) {
    const gl = this.gl;
    // room
    this.common(this.pRoom, mirror);
    gl.uniformMatrix4fv(this.pRoom.u('uM'), false, IDENT);
    for (const s of this.surfaces) { gl.uniform1i(this.pRoom.u('uSurf'), s.id); gl.bindVertexArray(s.m.vao); gl.drawElements(gl.TRIANGLES, s.m.count, gl.UNSIGNED_INT, 0); }
    // meshes
    this.common(this.pMesh, mirror);
    const draw = (obj, model) => {
      const m = obj.mat;
      gl.uniformMatrix4fv(this.pMesh.u('uM'), false, model);
      gl.uniform3fv(this.pMesh.u('uColor'), m.color);
      gl.uniform4f(this.pMesh.u('uMat'), m.rough, m.metal, m.cc, m.ao);
      gl.uniform3fv(this.pMesh.u('uEmit'), m.emit);
      gl.bindVertexArray(obj.vao); gl.drawElements(gl.TRIANGLES, obj.count, gl.UNSIGNED_INT, 0);
    };
    for (const d of this.deco) draw(d, IDENT);
    if (this.showCar) {
      const pl = CAR_PLACEMENT[this.carType], model = trsY(pl.x, 0, pl.z, pl.yaw);
      for (const part of this.cars[this.carType].parts) draw(part, model);
    }
    // logo (additive)
    this.common(this.pLogo, mirror);
    gl.uniformMatrix4fv(this.pLogo.u('uM'), false, IDENT);
    gl.uniform4fv(this.pLogo.u('uRect'), this.logoRect);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.logoTex);
    gl.uniform1i(this.pLogo.u('uTex'), 0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE); gl.depthMask(false);
    gl.bindVertexArray(this.logoMesh.vao); gl.drawElements(gl.TRIANGLES, this.logoMesh.count, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }

  render() {
    const gl = this.gl, c = this.canvas, f = this.floor;
    if (!f) return;
    const asp = c.width / c.height;
    let fov = this.cam.fov; if (asp < 1) fov = Math.min(84, fov * (1 + (1 - asp) * 0.55));
    this.eye = this.camPos();
    const up = this.cam.pitch > 1.5 ? [-Math.sin(this.cam.yaw), 0, -Math.cos(this.cam.yaw)] : [0, 1, 0];
    this.vp = mul(perspective((fov * Math.PI) / 180, asp, 0.03, 40), lookAt(this.eye, this.cam.target, up));
    this.floorEnv = f.env;
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.CULL_FACE);

    // reflection pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.reflSize[0], this.reflSize[1]);
    gl.clearColor(0.05, 0.05, 0.05, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawScene(true);
    gl.bindTexture(gl.TEXTURE_2D, this.reflTex); gl.generateMipmap(gl.TEXTURE_2D);

    // main pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, c.width, c.height);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.drawScene(false);

    // floor
    const P = this.pFloor; this.common(P, false);
    gl.uniformMatrix4fv(P.u('uM'), false, IDENT);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.reflTex); gl.uniform1i(P.u('uRefl'), 0);
    gl.uniform2f(P.u('uRes'), c.width, c.height);
    gl.uniform2f(P.u('uReflSize'), this.reflSize[0], this.reflSize[1]);
    gl.uniform1f(P.u('uSplit'), this.split);
    gl.uniform3fv(P.u('uBase'), f.base);
    gl.uniform3fv(P.u('uChips[0]'), f.chips.flat());
    gl.uniform3fv(P.u('uChipAvg'), f.chipAvg);
    gl.uniform1f(P.u('uCover'), f.cover); gl.uniform1f(P.u('uGap'), f.gap); gl.uniform1f(P.u('uCoverEff'), f.coverEff); gl.uniform1f(P.u('uFS'), f.scale);
    gl.uniform1i(P.u('uFinish'), f.finish);
    gl.uniform3fv(P.u('uMetA'), f.metA); gl.uniform3fv(P.u('uMetB'), f.metB); gl.uniform3fv(P.u('uVein'), f.vein);
    if (this.showCar) {
      const pl = CAR_PLACEMENT[this.carType], inf = this.cars[this.carType].info;
      gl.uniform4f(P.u('uCar'), pl.x, pl.z, pl.yaw, 1);
      gl.uniform2fv(P.u('uCarHalf'), inf.half);
      gl.uniform2fv(P.u('uWh[0]'), [inf.track, inf.zf, -inf.track, inf.zf, inf.track, inf.zr, -inf.track, inf.zr]);
      gl.uniform2f(P.u('uWhS'), inf.wd / 2, 0.07);
    } else gl.uniform4f(P.u('uCar'), 0, 0, 0, 0);
    gl.bindVertexArray(this.floorMesh.vao); gl.drawElements(gl.TRIANGLES, this.floorMesh.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);
  }

  snapshot(type = 'image/jpeg', q = 0.92) { this.render(); return this.canvas.toDataURL(type, q); }
}
