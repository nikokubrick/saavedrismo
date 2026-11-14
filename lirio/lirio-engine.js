// LIRIO · motor de audio para el navegador (AudioWorklet).
// Traducción directa de Engine.h (el motor del plugin VST3/AU), para que suene igual.
'use strict';
const kTwoPi = Math.PI * 2;
const kMaxVoices = 32, kMaxEvents = 512, kMaxHeld = 16;
const CB_Maj = 1, CB_Min = 2, CB_Dim = 4, CB_Sus2 = 8, CB_Sus4 = 16, CB_Six = 32, CB_Seven = 64, CB_Maj7 = 128, CB_Nine = 256, kThirdBits = 7;
const P_Chord = 0, P_Strum = 1, P_Slop = 2, P_Arp = 3, P_Harp = 4, P_Pattern = 5;
const RHYTHMS = ['X---x---x---x---', 'X-x-x-x-X-x-x-x-', 'X-----x---------', 'X--x--x-X--x--x-', '..x-..x-..x-..x-', 'X--x--x---x-x---',
  'X--x--x---x--x--', 'X.xx.x.xX.x..xx.', 'X.xxX.xxX.xxX.xx', 'X-.x-.x-.x-.xx-.', 'X-------x--x-x--'];
const E_Analog = 0, E_FM = 1, E_Reed = 2;

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
function polyblep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}
class Rng {
  constructor(s) { this.s = (s >>> 0) || 0x12345678; }
  step() { let s = this.s; s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; this.s = s >>> 0; return this.s; }
  next() { return (this.step() & 0xffffff) / 8388608 - 1; }
  uni() { return 0.5 * (this.next() + 1); }
}
const Idle = 0, Att = 1, Dec = 2, Sus = 3, Rel = 4;
class Adsr {
  constructor() { this.st = Idle; this.v = 0; this.a = 0.01; this.d = 0.5; this.s = 0.6; this.r = 0.4; this.sr = 48000; this.dCo = 0; this.rCo = 0; }
  set(A, D, S, R, SR) { this.a = Math.max(A, 0.0005); this.d = Math.max(D, 0.005); this.s = S; this.r = Math.max(R, 0.005); this.sr = SR;
    this.dCo = Math.exp(-1 / (this.d * 0.3 * SR)); this.rCo = Math.exp(-1 / (this.r * 0.3 * SR)); }
  on() { this.st = Att; }
  off() { if (this.st !== Idle) this.st = Rel; }
  next() {
    switch (this.st) {
      case Att: this.v += 1 / (this.a * this.sr); if (this.v >= 1) { this.v = 1; this.st = Dec; } break;
      case Dec: this.v = this.s + (this.v - this.s) * this.dCo; if (Math.abs(this.v - this.s) < 1e-4) this.st = Sus; break;
      case Sus: this.v = this.s; break;
      case Rel: this.v *= this.rCo; if (this.v < 1e-5) { this.v = 0; this.st = Idle; } break;
      default: this.v = 0;
    }
    return this.v;
  }
}
class Svf {
  constructor() { this.ic1 = 0; this.ic2 = 0; this.a1 = 0; this.a2 = 0; this.a3 = 0; }
  set(fc, res, sr) {
    fc = Math.min(Math.max(fc, 20), sr * 0.45);
    const g = Math.tan(Math.PI * fc / sr), k = 2 - 1.9 * Math.min(Math.max(res, 0), 1);
    this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  lp(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2; return v2;
  }
  reset() { this.ic1 = this.ic2 = 0; }
}
const RATIOS = [0.5, 1, 2, 3, 3.5, 4, 5, 7];
class Voice {
  constructor(i) { this.active = false; this.released = false; this.note = 60; this.vel = 1; this.tag = 0; this.age = 0; this.gainMul = 1; this.freq = 261.6;
    this.ph = new Float64Array(5); this.fmPh = 0; this.fmPh2 = 0; this.amp = new Adsr(); this.fenv = new Adsr(); this.f1 = new Svf(); this.f2 = new Svf();
    this.rng = new Rng(0x12345678); this.noiseEnv = 0; this.relThump = 0; this.lp1 = 0; this.ctr = 0; this.idxEnv = 0; this.lastOut = 0; this.declick = 0; }
  start(n, v, t, a, p, sr) {
    this.declick = this.active ? this.lastOut : 0;
    this.active = true; this.released = false; this.note = n; this.vel = v; this.tag = t; this.age = a;
    this.freq = mtof(n);
    for (let i = 0; i < 5; i++) this.ph[i] = this.rng.uni();
    this.fmPh = this.fmPh2 = 0;
    if (p.engine === E_Analog) this.amp.set(p.attack, p.decay, p.sustain, p.release, sr);
    else this.amp.set(Math.min(p.attack, 0.5), p.decay * 1.6, p.sustain, p.release, sr);
    this.fenv.set(0.002, p.decay * 0.6 + 0.05, 0, p.release, sr);
    this.amp.v = 0; this.amp.on(); this.fenv.v = 0; this.fenv.on(); this.f1.reset(); this.f2.reset();
    this.noiseEnv = 1; this.relThump = 0; this.idxEnv = 1; this.ctr = 0; this.lp1 = 0;
    this.rng.s = (this.rng.s ^ ((Math.imul(n, 2654435761) + t) >>> 0)) >>> 0 || 1;
  }
  stop() { if (!this.released) { this.released = true; this.amp.off(); this.fenv.off(); this.relThump = 1; } }
  render(p, sr, bend, lfo, lfoSlow) {
    if (!this.active) return 0;
    const e = this.amp.next();
    if (this.amp.st === Idle) { this.active = false; this.lastOut = 0; this.declick = 0; return 0; }
    const velG = (1 - p.velSens) + p.velSens * this.vel;
    let out = 0;
    const f = this.freq * bend * (1 + lfo), ph = this.ph;
    if (p.engine === E_Analog) {
      const det = 1 + p.movement * 0.012;
      const dt0 = f / sr, dt1 = f * det / sr, dt2 = f * 0.5 / sr;
      const s0 = 2 * ph[0] - 1 - polyblep(ph[0], dt0);
      const s1 = 2 * ph[1] - 1 - polyblep(ph[1], dt1);
      const pw = 0.5 + 0.35 * p.movement * lfoSlow;
      let t2 = ph[2] + pw; if (t2 >= 1) t2 -= 1;
      const pu = (ph[2] < pw ? 1 : -1) + polyblep(ph[2], dt0) - polyblep(t2, dt0);
      const sub = (ph[3] < 0.5 ? 1 : -1) + polyblep(ph[3], dt2) - polyblep((ph[3] + 0.5) % 1, dt2);
      ph[0] += dt0; if (ph[0] >= 1) ph[0] -= 1;
      ph[1] += dt1; if (ph[1] >= 1) ph[1] -= 1;
      ph[2] += dt0; if (ph[2] >= 1) ph[2] -= 1;
      ph[3] += dt2; if (ph[3] >= 1) ph[3] -= 1;
      const x = 0.42 * s0 + 0.3 * s1 + 0.22 * pu + 0.28 * sub;
      const fe = this.fenv.next();
      if ((this.ctr++ & 7) === 0) {
        const base = 60 * Math.pow(250, p.bright);
        const kt = Math.pow(f / 261.6, 0.5);
        const env = Math.pow(2, fe * p.character * 6 * (0.4 + 0.6 * this.vel));
        const fc = base * kt * env;
        this.f1.set(fc, p.tone2, sr); this.f2.set(fc, p.tone2 * 0.3, sr);
      }
      out = this.f2.lp(this.f1.lp(x)) * 0.55;
    } else if (p.engine === E_FM) {
      const ratio = RATIOS[Math.min(7, Math.floor(p.tone2 * 7.99))];
      this.idxEnv *= Math.exp(-1 / (sr * (0.08 + p.decay * 0.35)));
      const I = (0.4 + p.character * 6) * (0.35 + 0.65 * this.vel) * (0.25 + 0.75 * this.idxEnv) * (0.5 + p.bright);
      const m = Math.sin(kTwoPi * this.fmPh) * I;
      const ie = this.idxEnv;
      const tine = Math.sin(kTwoPi * this.fmPh2) * 1.6 * this.vel * ie * ie * ie;
      out = Math.sin(kTwoPi * ph[0] + m + (f * 14 < sr * 0.4 ? tine : 0)) * 0.5;
      ph[0] += f / sr; if (ph[0] >= 1) ph[0] -= 1;
      this.fmPh += f * ratio / sr; if (this.fmPh >= 1) this.fmPh -= 1;
      this.fmPh2 += f * 14 / sr; if (this.fmPh2 >= 1) this.fmPh2 -= 1;
      out *= 1 + 0.5 * p.movement * lfoSlow;
    } else {
      this.idxEnv *= Math.exp(-1 / (sr * 0.25));
      const I = (0.3 + 1.2 * this.vel) * (0.3 + 0.7 * this.idxEnv);
      const m = Math.sin(kTwoPi * this.fmPh) * I;
      let x = Math.sin(kTwoPi * ph[0] + m) + (0.25 + 0.25 * this.vel) * Math.sin(2 * kTwoPi * ph[0]) + 0.08 * this.vel * Math.sin(3 * kTwoPi * ph[0]);
      ph[0] += f / sr; if (ph[0] >= 1) ph[0] -= 1;
      this.fmPh += f / sr; if (this.fmPh >= 1) this.fmPh -= 1;
      const drive = 1 + p.character * 4 * this.vel;
      x = Math.tanh(x * drive) / Math.tanh(drive);
      this.noiseEnv *= 0.9965; this.relThump *= 0.993;
      const n = this.rng.next();
      this.lp1 += 0.08 * (n - this.lp1);
      const mech = p.tone2 * (this.noiseEnv * this.vel * 0.5 * (n - this.lp1) + this.relThump * 0.25 * this.lp1);
      out = x * 0.45 + mech * 0.6;
      if ((this.ctr++ & 7) === 0) this.f1.set(900 * Math.pow(14, p.bright) * (0.6 + 0.4 * this.vel), 0.1, sr);
      out = this.f1.lp(out);
      out *= 1 + 0.6 * p.movement * lfoSlow;
    }
    this.declick *= 0.96;
    this.lastOut = out * e * velG * this.gainMul + this.declick;
    return this.lastOut;
  }
}
class Bass {
  constructor() { this.active = false; this.note = 36; this.vel = 1; this.amp = new Adsr(); this.ph = 0; this.ph2 = 0; this.lp = 0; this.fenv = 0; this.tag = 0; this.flt = new Svf(); }
  start(n, v, t, sr, sound) {
    this.note = n; this.vel = v; this.tag = t; this.active = true; this.fenv = 1;
    if (sound === 4) this.amp.set(0.002, 0.9, 0.35, 0.15, sr);
    else if (sound === 5) this.amp.set(0.002, 0.35, 0.55, 0.12, sr);
    else this.amp.set(0.004, 0.6, 0.75, 0.18, sr);
    this.amp.on();
  }
  glide(n, t) { this.note = n; this.tag = t; }
  stop() { this.amp.off(); }
  render(p, sr, bend) {
    if (!this.active) return 0;
    const e = this.amp.next(); if (this.amp.st === Idle) { this.active = false; return 0; }
    const f = mtof(this.note) * bend, dt = f / sr, tn = p.bassTone, ph = this.ph, ph2 = this.ph2;
    let out = 0;
    this.fenv *= Math.exp(-1 / (sr * (p.bassSound === 5 ? 0.12 : 0.25)));
    switch (p.bassSound) {
      case 1: { const saw = 2 * ph2 - 1 - polyblep(ph2, dt); this.flt.set(90 + 2600 * tn * tn * (0.35 + 0.65 * this.fenv) + f * 1.5, 0.25, sr); out = this.flt.lp(saw) * 0.75; break; }
      case 2: { const sq = (ph2 < 0.5 ? 1 : -1) + polyblep(ph2, dt) - polyblep((ph2 + 0.5) % 1, dt); this.flt.set(120 + 2200 * tn * tn, 0.15, sr); out = this.flt.lp(sq) * 0.3 + 0.28 * Math.sin(kTwoPi * ph); break; }
      case 3: { const x = Math.sin(kTwoPi * ph) + 0.15 * Math.sin(2 * kTwoPi * ph); const g = 1 + 3 * tn; out = Math.tanh(x * g) / Math.tanh(g) * 0.5; break; }
      case 4: { const I = (0.5 + 4 * tn) * (0.2 + 0.8 * this.fenv); out = Math.sin(kTwoPi * ph + I * Math.sin(kTwoPi * ph2)) * 0.7; break; }
      case 5: { const saw = 2 * ph2 - 1 - polyblep(ph2, dt); this.flt.set(110 + 3800 * (0.15 + 0.85 * tn) * this.fenv * this.fenv + f, 0.86, sr); out = Math.tanh(this.flt.lp(saw) * 1.6) * 0.6; break; }
      default: {
        const sine = Math.sin(kTwoPi * ph), saw = 2 * ph2 - 1 - polyblep(ph2, dt);
        const c = 1 - Math.exp(-kTwoPi * (120 + 1800 * tn * tn) / sr);
        this.lp += c * (saw - this.lp);
        out = 0.75 * sine + 0.5 * tn * this.lp + 0.15 * this.lp;
      }
    }
    this.ph += dt; if (this.ph >= 1) this.ph -= 1; this.ph2 += dt; if (this.ph2 >= 1) this.ph2 -= 1;
    return out * e * (0.6 + 0.4 * this.vel) * p.bassLevel * 0.55;
  }
}
class DelayLine {
  init(n) { this.b = new Float32Array(Math.max(n, 4)); this.w = 0; }
  push(x) { this.b[this.w] = x; if (++this.w >= this.b.length) this.w = 0; }
  tap(d) { const L = this.b.length; let r = this.w - d - 1; while (r < 0) r += L; const i = Math.floor(r), fr = r - i; let j = i + 1; if (j >= L) j = 0; return this.b[i] + fr * (this.b[j] - this.b[i]); }
}
class Comb { init(n) { this.b = new Float32Array(n); this.i = 0; this.store = 0; }
  process(x, fb, damp) { const o = this.b[this.i]; this.store = o * (1 - damp) + this.store * damp; this.b[this.i] = x + this.store * fb; if (++this.i >= this.b.length) this.i = 0; return o; } }
class Allp { init(n) { this.b = new Float32Array(n); this.i = 0; }
  process(x) { const o = this.b[this.i]; this.b[this.i] = x + o * 0.5; if (++this.i >= this.b.length) this.i = 0; return o - x; } }
class Reverb {
  init(sr) {
    const ct = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617], at = [556, 441, 341, 225], k = sr / 44100;
    this.cl = ct.map(c => { const x = new Comb(); x.init(Math.floor(c * k)); return x; });
    this.cr = ct.map(c => { const x = new Comb(); x.init(Math.floor((c + 23) * k)); return x; });
    this.al = at.map(c => { const x = new Allp(); x.init(Math.floor(c * k)); return x; });
    this.ar = at.map(c => { const x = new Allp(); x.init(Math.floor((c + 23) * k)); return x; });
  }
  process(inL, inR, size, o) {
    const fb = 0.7 + 0.28 * size, damp = 0.35 - 0.15 * size, inp = (inL + inR) * 0.015;
    let l = 0, r = 0;
    for (let n = 0; n < 8; n++) { l += this.cl[n].process(inp, fb, damp); r += this.cr[n].process(inp, fb, damp); }
    for (let n = 0; n < 4; n++) { l = this.al[n].process(l); r = this.ar[n].process(r); }
    o[0] = l; o[1] = r;
  }
}
const D_Kick = 0, D_Hat = 1, D_Snare = 2, D_TomHi = 3, D_TomMid = 4, D_TomLo = 5, D_Count = 6;
const HAT_R = [205.3, 304.4, 369.6, 522.7, 540, 800];
class DrumVoice {
  constructor(i) { this.active = false; this.type = 0; this.t = 0; this.vel = 1; this.ph = 0; this.ph2 = 0; this.hp = 0; this.prevN = 0; this.lp = 0; this.rng = new Rng(0x12345678); this.mph = new Float64Array(6); }
  trigger(ty, v) { this.active = true; this.type = ty; this.t = 0; this.vel = v; this.ph = this.ph2 = 0; this.hp = this.prevN = this.lp = 0; for (let k = 0; k < 6; k++) this.mph[k] = this.rng.uni(); }
  render(sr, tone) {
    if (!this.active) return 0;
    const ts = this.t / sr; this.t += 1; let out = 0;
    const n = this.rng.next();
    switch (this.type) {
      case D_Kick: {
        const f = 48 + 120 * Math.exp(-ts / 0.035);
        this.ph += f / sr; if (this.ph >= 1) this.ph -= 1;
        const body = Math.sin(kTwoPi * this.ph) * Math.exp(-ts / 0.32);
        const click = n * Math.exp(-ts / 0.0015) * 0.35;
        out = Math.tanh((body + click) * 1.8) * 0.95;
        if (ts > 1.2) this.active = false; break;
      }
      case D_Snare: {
        const f = 175 + 90 * Math.exp(-ts / 0.02);
        this.ph += f / sr; if (this.ph >= 1) this.ph -= 1; this.ph2 += f * 1.87 / sr; if (this.ph2 >= 1) this.ph2 -= 1;
        const body = (Math.sin(kTwoPi * this.ph) + 0.4 * Math.sin(kTwoPi * this.ph2)) * Math.exp(-ts / 0.07) * 0.55;
        this.hp = n - this.prevN + 0.6 * this.hp; this.prevN = n;
        this.lp += (0.25 + 0.5 * tone) * (this.hp - this.lp);
        const noise = this.lp * (Math.exp(-ts / 0.16) + 0.45 * Math.exp(-Math.abs(ts - 0.012) / 0.006)) * 0.75;
        out = Math.tanh((body + noise) * 2.2) * 0.75;
        if (ts > 0.8) this.active = false; break;
      }
      case D_Hat: {
        let m = 0; for (let k = 0; k < 6; k++) { this.mph[k] += HAT_R[k] * 2.4 / sr; if (this.mph[k] >= 1) this.mph[k] -= 1; m += this.mph[k] < 0.5 ? 1 : -1; }
        const x = m * 0.12 + n * 0.5;
        this.hp = x - this.prevN + 0.2 * this.hp; this.prevN = x;
        out = this.hp * Math.exp(-ts / (0.025 + 0.03 * tone)) * 0.45;
        if (ts > 0.4) this.active = false; break;
      }
      default: {
        const base = this.type === D_TomHi ? 196 : this.type === D_TomMid ? 138 : 92;
        const dec = this.type === D_TomHi ? 0.32 : this.type === D_TomMid ? 0.42 : 0.55;
        const f = base * (1 + 0.45 * Math.exp(-ts / 0.05));
        this.ph += f / sr; if (this.ph >= 1) this.ph -= 1;
        const body = Math.sin(kTwoPi * this.ph) * Math.exp(-ts / dec);
        this.lp += 0.2 * (n - this.lp);
        const stick = this.lp * Math.exp(-ts / 0.008) * 0.6;
        out = Math.tanh((body + stick) * 2) * 0.8;
        if (ts > 2) this.active = false; break;
      }
    }
    return out * this.vel;
  }
}
class DrumKit {
  prepare(s) {
    this.sr = s; this.v = []; for (let i = 0; i < 12; i++) this.v.push(new DrumVoice(i)); this.nextV = 0;
    this.env = 0; this.atk = 1 - Math.exp(-1 / (0.002 * s)); this.rel = 1 - Math.exp(-1 / (0.12 * s));
    this.apL = new Float64Array(4); this.apR = new Float64Array(4); this.phLfo = 0; this.fbL = 0; this.fbR = 0; this.warm = 0; this.warmR = 0;
    this.nextK = 0; this.freeT = 0; this.expectQ = -1; this.running = false; this.uiStep = -1;
  }
  hit(lane, vel) { const d = this.v[this.nextV]; this.nextV = (this.nextV + 1) % 12; d.trigger(lane, vel); }
  triggerStep(k, p) {
    const s16 = ((k % 16) + 16) % 16; this.uiStep = s16;
    const acc = (s16 % 4 === 0) ? 1 : (s16 % 2 === 0 ? 0.85 : 0.72);
    for (let lane = 0; lane < D_Count; lane++) if ((p.lanes[lane] >> s16) & 1) this.hit(lane, acc);
  }
  static stepPos(k, swing) { return k + ((k & 1) ? swing * 0.5 : 0); }
  clock(p, bpm) {
    if (!p.drumsOn) { this.running = false; this.uiStep = -1; return; }
    if (!this.running) this.freeT = 0;
    const q = this.freeT * bpm / 60 * 4 / this.sr; this.freeT += 1;
    if (!this.running || Math.abs(q - this.expectQ) > 0.5) {
      let k = Math.floor(q) - 1; while (DrumKit.stepPos(k, p.swing) < q - 1e-9) ++k; this.nextK = k;
      this.running = true;
    }
    while (q >= DrumKit.stepPos(this.nextK, p.swing)) { this.triggerStep(this.nextK, p); ++this.nextK; }
    this.expectQ = q + bpm / 60 * 4 / this.sr;
  }
  render(p, o) {
    let m = 0, side = 0;
    for (const d of this.v) if (d.active) {
      const x = d.render(this.sr, p.drumTone);
      m += x;
      if (d.type === D_Hat) side += x * 0.35; else if (d.type === D_TomHi) side -= x * 0.4; else if (d.type === D_TomLo) side += x * 0.4;
    }
    const dg = 1.3 * (1 + 4 * p.drumDrive), dc = 1 / (1 + 0.8 * p.drumDrive);
    let l = Math.tanh((m - side) * dg) * dc, r = Math.tanh((m + side) * dg) * dc;
    const c = 0.35 + 0.6 * p.drumTone; this.warm += c * (l - this.warm); this.warmR += c * (r - this.warmR); l = this.warm; r = this.warmR;
    const pk = Math.max(Math.abs(l), Math.abs(r));
    this.env += (pk > this.env ? this.atk : this.rel) * (pk - this.env);
    const thr = 0.12, ratio = 6;
    const g = this.env > thr ? Math.pow(this.env / thr, 1 / ratio - 1) : 1;
    const cmp = g * 2.6;
    l = l * (1 - p.drumComp) + l * cmp * p.drumComp; r = r * (1 - p.drumComp) + r * cmp * p.drumComp;
    this.phLfo += 0.22 / this.sr; if (this.phLfo >= 1) this.phLfo -= 1;
    const sweep = 0.5 + 0.5 * Math.sin(kTwoPi * this.phLfo);
    const a = 0.55 + 0.4 * sweep, aR = 0.55 + 0.4 * (1 - sweep);
    let xl = l + this.fbL * 0.55, xr = r + this.fbR * 0.55;
    for (let k = 0; k < 4; k++) { const yl = -a * xl + this.apL[k]; this.apL[k] = xl + a * yl; xl = yl; const yr = -aR * xr + this.apR[k]; this.apR[k] = xr + aR * yr; xr = yr; }
    this.fbL = xl; this.fbR = xr;
    l = l * (1 - 0.5 * p.drumPhase) + xl * 0.5 * p.drumPhase * 2;
    r = r * (1 - 0.5 * p.drumPhase) + xr * 0.5 * p.drumPhase * 2;
    const vol = p.drumVol * p.drumVol * 0.9;
    o[0] = l * vol; o[1] = r * vol;
  }
}
const SCL = [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10]];
const RATES = [1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125];
const DTIMES = [1, 0.75, 0.5, 0.25, 2 / 3];
const popcount = m => { let c = 0; while (m) { m &= m - 1; ++c; } return c; };

// intervalos del acorde (bits 0..23) — igual que chordIntervals() de Engine.h
function chordIntervals(pc, mask, key, scale, complexity) {
  let third = 4, fifth = 7, dSev = 10;
  const hasThird = (mask & kThirdBits) !== 0;
  if (mask & CB_Maj) { third = 4; fifth = 7; }
  else if (mask & CB_Min) { third = 3; fifth = 7; }
  else if (mask & CB_Dim) { third = 3; fifth = 6; }
  else {
    const sc = SCL[scale ? 1 : 0], rel = ((pc - key) % 12 + 12) % 12;
    let d = -1; for (let k = 0; k < 7; k++) if (sc[k] === rel) d = k;
    if (d >= 0) {
      third = (sc[(d + 2) % 7] - rel + 12) % 12; fifth = (sc[(d + 4) % 7] - rel + 12) % 12; dSev = (sc[(d + 6) % 7] - rel + 12) % 12;
      if (dSev !== 10 && dSev !== 11) dSev = 10;
    }
  }
  const s2 = (mask & CB_Sus2) !== 0, s4 = (mask & CB_Sus4) !== 0;
  let six = (mask & CB_Six) !== 0, sev = (mask & CB_Seven) !== 0, maj7 = (mask & CB_Maj7) !== 0, nine = (mask & CB_Nine) !== 0;
  let m = 1;
  if ((s2 || s4) && !hasThird) { if (s2) m |= 1 << 2; if (s4) m |= 1 << 5; }
  else { m |= 1 << third; if (s2) m |= 1 << 2; if (s4) m |= 1 << 5; }
  m |= 1 << fifth;
  const sevIv = hasThird ? 10 : dSev;
  if (complexity === 0) { if (maj7) { sev = six = nine = false; } else if (sev) { six = nine = false; } else if (six) nine = false; }
  if (complexity === 1 && maj7 && sev) sev = false;
  if (six) m |= 1 << ((complexity === 1 && (sev || maj7)) ? 21 : 9);
  if (sev) m |= 1 << sevIv;
  if (maj7) m |= 1 << 11;
  if (nine) m |= 1 << 14;
  const lim = complexity === 0 ? 4 : complexity === 1 ? 6 : 99;
  if (popcount(m) > lim && (m & (1 << 7))) m &= ~(1 << 7);
  return m;
}
function chordSuffix(m) {
  const has = i => ((m >> i) & 1) !== 0;
  const t4 = has(4), t3 = has(3), b5 = has(6) && !has(7), sev = has(10), maj7 = has(11), six = has(9), thir = has(21), nine = has(14), s2 = has(2), s4 = has(5);
  let s;
  if (t3 && b5 && !t4) { s = sev ? 'm7b5' : six ? 'dim7' : 'dim'; if (maj7) s += '(maj7)'; if (nine) s += '(add9)'; }
  else {
    const q = t3 && !t4 ? 'm' : '';
    if (sev || maj7) {
      const ext = thir ? '13' : nine ? '9' : '7';
      if (maj7 && sev) s = q + ext + '(maj7)'; else if (maj7) s = q === '' ? 'maj' + ext : 'm(maj' + ext + ')'; else s = q + ext;
      if (six && !thir) s += '(add6)';
    } else if (six || thir) s = q + (nine ? '6/9' : '6');
    else { s = q; if (nine) s += 'add9'; }
  }
  if (!t3 && !t4) s += s4 ? (s2 ? 'sus2sus4' : 'sus4') : (s2 ? 'sus2' : '5');
  else { if (s2) s += '(add2)'; if (s4) s += '(add4)'; }
  const n = popcount(m);
  const tag = (sev && maj7) || (t3 && t4) || n >= 7 ? 2 : (n >= 5 ? 1 : 0);
  return { s, tag };
}
function rotate(arr, v) {
  while (v > 0) { arr.push(arr.shift() + 12); --v; }
  while (v < 0) { arr.unshift(arr.pop() - 12); ++v; }
  return arr;
}
const L_Empty = 0, L_Armed = 1, L_Rec = 2, L_Play = 3, L_Dub = 4, L_Stop = 5;

class Engine {
  constructor(sr) {
    this.sr = sr; this.voices = []; for (let i = 0; i < kMaxVoices; i++) this.voices.push(new Voice(i));
    this.bass = new Bass();
    this.chL = new DelayLine(); this.chL.init(Math.floor(sr * 0.05)); this.chR = new DelayLine(); this.chR.init(Math.floor(sr * 0.05));
    this.dlL = new DelayLine(); this.dlL.init(Math.floor(sr * 2.6)); this.dlR = new DelayLine(); this.dlR.init(Math.floor(sr * 2.6));
    this.flDl = new DelayLine(); this.flDl.init(Math.floor(sr * 0.02));
    this.rev = new Reverb(); this.rev.init(sr); this.drumRev = new Reverb(); this.drumRev.init(sr); this.drums = new DrumKit(); this.drums.prepare(sr);
    this.evs = []; this.held = []; this.nowS = 0; this.tagCounter = 1; this.ageCtr = 0; this.arpOn = false; this.dlLp = 0; this.dlRp = 0;
    this.smK = 1 - Math.exp(-1 / (0.03 * sr)); this.smKd = 1 - Math.exp(-1 / (0.15 * sr));
    this.limRel = 1 - Math.exp(-1 / (0.15 * sr)); this.limGain = 1; this.smInit = false;
    this.bend = 1; this.mod = 0; this.lfoPh = 0; this.lfo2 = 0; this.chPh = 0; this.sustainPedal = false; this.strumDown = false;
    this.arpNext = 0; this.arpOffAt = 0; this.arpIdx = 0; this.arpVoiceTag = 0; this.rng = new Rng(0x12345678);
    this.patOn = false; this.patNext = 0; this.patStep = 0; this.patTag = 0;
    this.prev = []; this.ksHeld = 0; this.ksThird = 0;
    this.cutF1 = new Svf(); this.cutF2 = new Svf(); this.apS = new Float64Array(6); this.phLfo = 0; this.phFb = 0; this.flLfo = 0; this.flFb = 0;
    this.ui = { root: -1, iv: 0, act: 0, ks: 0, patStep: -1 };
    this.revOut = [0, 0]; this.drumOut = [0, 0]; this.drumRevOut = [0, 0];
    // looper
    this.loopState = L_Empty; this.loopEv = []; this.loopLen = 0; this.loopPos = 0; this.loopIdx = 0; this.loopLayer = 0; this.loopLayers = 0; this.loopBpm = 120;
    this.playOn = new Uint8Array(128); this.userOn = new Int32Array(128);
  }
  isKeySwitch(key, p) { return p.keySwitch && p.mode === 0 && key >= 24 && key <= 32; }
  effMask(p) { let m = p.chordMask; if (this.ksHeld & kThirdBits) m &= ~kThirdBits; m |= this.ksHeld & ~kThirdBits; m |= this.ksThird; return m; }
  bassNote(key, p) { let bn = (p.followOct ? key : 48 + key % 12) + 12 * p.octave - 12 * (p.bassOct + 1); while (bn < 28) bn += 12; return bn; }
  baseNotes(key, p, mask) {
    const m = chordIntervals(key % 12, mask, p.key, p.scale, p.complexity);
    const root = (p.followOct ? key : 48 + key % 12) + 12 * p.octave;
    const arr = []; for (let i = 0; i < 24; i++) if ((m >> i) & 1) arr.push(root + i);
    return arr.slice(0, 8);
  }
  voiceChord(key, p, mask) {
    let arr = this.baseNotes(key, p, mask); const n = arr.length, prev = this.prev;
    if (p.voiceLead && prev.length) {
      let best = null, bestCost = Infinity;
      for (let inv = -n; inv <= n; inv++) {
        const c = rotate(arr.slice(), inv);
        if (c[0] < 28 || c[n - 1] > 100) continue;
        let cost = 0;
        for (const a of c) { let d = 999; for (const b of prev) d = Math.min(d, Math.abs(a - b)); cost += d; }
        for (const b of prev) { let d = 999; for (const a of c) d = Math.min(d, Math.abs(a - b)); cost += d; }
        cost = cost * 4 + Math.abs(inv);
        if (cost < bestCost) { bestCost = cost; best = c; }
      }
      if (best) arr = best;
    }
    this.prev = arr.slice();
    return rotate(arr, p.voicing).map(x => Math.min(120, Math.max(12, x)));
  }
  userNoteOn(key, vel, p) {
    if (this.isKeySwitch(key, p)) { this.noteOn(key, vel, p); return; }
    if (this.loopState === L_Armed) this.startLoopRec(p);
    const mask = this.effMask(p);
    if (this.loopState === L_Rec || this.loopState === L_Dub) { this.recordEv(key, vel, true, mask, p); this.userOn[key & 127] = mask + 1; }
    this.noteOn(key, vel, p);
  }
  userNoteOff(key, p) {
    if (!this.isKeySwitch(key, p) && (this.loopState === L_Rec || this.loopState === L_Dub) && this.userOn[key & 127]) this.recordEv(key, 0, false, 0, p);
    this.userOn[key & 127] = 0;
    this.noteOff(key, p);
  }
  noteOn(key, vel, p, maskOverride = -1) {
    if (this.isKeySwitch(key, p)) { const bit = 1 << (key - 24); this.ksHeld |= bit; if (bit & kThirdBits) this.ksThird = bit; this.ui.ks = this.ksHeld; this.ui.act++; return; }
    this.ui.act++;
    const mask = maskOverride >= 0 ? maskOverride : this.effMask(p);
    const solo = p.mode === 0 && p.bassOn && p.bassMode === 1;
    if (p.hold && p.mode === 0 && !solo) {
      const same = this.held.length > 0 && this.held[this.held.length - 1].key === key;
      for (const h of this.held) this.releaseHeld(h);
      this.held = [];
      if (same) { this.stopPerf(); this.ui.root = -1; return; }
    }
    this.removeHeld(key);
    if (this.held.length >= kMaxHeld) { this.releaseHeld(this.held[0]); this.held.shift(); }
    const H = { key, vel, tag: this.tagCounter++, pedalHeld: false, notes: [] };
    this.held.push(H);
    const t0 = this.nowS, sr = this.sr;
    if (solo) { this.pushEv(t0, 2, this.bassNote(key, p), vel, H.tag); this.ui.root = key; this.ui.iv = -1; return; }
    H.notes = p.mode === 0 ? this.voiceChord(key, p, mask) : [key + 12 * p.octave];
    const n = H.notes.length;
    if (p.perf === P_Arp) { if (!this.arpOn) { this.arpOn = true; this.arpNext = t0; this.arpIdx = 0; } }
    else if (p.perf === P_Pattern) {
      if (!this.patOn) { this.patOn = true; this.patNext = t0; this.patStep = 0; }
      else { if (this.patTag) this.stopTag(this.patTag); this.patTag = this.tagCounter++; for (let i = 0; i < n; i++) this.pushEv(t0, 1, H.notes[i], vel, this.patTag); }
    }
    else if (p.perf === P_Strum) {
      const down = this.strumDown; this.strumDown = !this.strumDown;
      for (let i = 0; i < n; i++) this.pushEv(t0 + Math.floor(i * p.strumMs * 0.001 * sr), 1, H.notes[down ? n - 1 - i : i], vel, H.tag);
    } else if (p.perf === P_Slop) {
      for (let i = 0; i < n; i++) {
        const d = this.rng.uni() * (0.012 + 0.09 * p.slop);
        const v = Math.min(1, Math.max(0.05, vel * (1 + this.rng.next() * 0.3 * p.slop)));
        this.pushEv(t0 + Math.floor(d * sr), 1, H.notes[i], v, H.tag);
      }
    } else if (p.perf === P_Harp) {
      const step = 0.025 + p.strumMs * 0.0009; let k = 0;
      for (let o = 0; o < 3; o++) for (let i = 0; i < n; i++, k++) this.pushEv(t0 + Math.floor(k * step * sr), 1, H.notes[i] + 12 * o, vel * (1 - 0.02 * k), H.tag);
    } else for (let i = 0; i < n; i++) this.pushEv(t0, 1, H.notes[i], vel, H.tag);
    if (p.bassOn && p.mode === 0) this.pushEv(t0, 2, this.bassNote(key, p), vel, H.tag);
    this.publishChord(key, p, mask);
  }
  noteOff(key, p) {
    if (this.isKeySwitch(key, p)) {
      const bit = 1 << (key - 24); this.ksHeld &= ~bit;
      if (this.ksThird === bit) this.ksThird = this.ksHeld & kThirdBits ? (this.ksHeld & CB_Dim ? CB_Dim : this.ksHeld & CB_Min ? CB_Min : CB_Maj) : 0;
      this.ui.ks = this.ksHeld; return;
    }
    if (this.sustainPedal) { for (const h of this.held) if (h.key === key) h.pedalHeld = true; return; }
    const solo = p.mode === 0 && p.bassOn && p.bassMode === 1;
    if (p.hold && p.mode === 0 && !solo) return;
    const top = this.held[this.held.length - 1];
    if (solo && this.held.length > 1 && top.key === key && this.bass.active && this.bass.tag === top.tag) {
      this.removeHeld(key); const nt = this.held[this.held.length - 1];
      this.bass.glide(this.bassNote(nt.key, p), nt.tag); this.ui.root = nt.key; return;
    }
    for (const h of this.held) if (h.key === key) this.releaseHeld(h);
    this.removeHeld(key);
    if (this.held.length === 0) this.stopPerf();
  }
  sustain(on, p) {
    this.sustainPedal = on;
    if (!on) {
      this.held = this.held.filter(h => { if (h.pedalHeld) { this.releaseHeld(h); return false; } return true; });
      if (this.held.length === 0 && !p.hold) this.stopPerf();
    }
  }
  allOff() { for (const v of this.voices) v.stop(); this.bass.stop(); this.held = []; this.evs = []; this.arpOn = false; this.patOn = false; this.ui.root = -1; }
  stopPerf() {
    this.arpOn = false; if (this.arpVoiceTag) { this.stopTag(this.arpVoiceTag); this.arpVoiceTag = 0; }
    this.patOn = false; if (this.patTag) { this.stopTag(this.patTag); this.patTag = 0; } this.ui.patStep = -1;
  }
  pushEv(t, type, note, vel, tag) { if (this.evs.length < kMaxEvents) this.evs.push({ t, type, note, vel, tag }); }
  processEvents(t, p) {
    if (!this.evs.length) return;
    for (let k = 0; k < this.evs.length;) {
      const e = this.evs[k];
      if (e.t <= t) { this.evs[k] = this.evs[this.evs.length - 1]; this.evs.pop();
        if (e.type === 1) this.startVoice(e.note, e.vel, e.tag, p); else if (e.type === 2) this.bass.start(e.note, e.vel, e.tag, this.sr, p.bassSound); }
      else ++k;
    }
  }
  startVoice(note, vel, tag, p) {
    let best = null;
    for (const v of this.voices) if (v.active && v.note === note && v.tag === tag) { best = v; break; }
    if (!best) for (const v of this.voices) if (!v.active) { best = v; break; }
    if (!best) { let lo = 1e9; for (const v of this.voices) if (v.released && v.amp.v < lo) { lo = v.amp.v; best = v; } }
    if (!best) { let lo = 1e9; for (const v of this.voices) if (v.amp.v < lo) { lo = v.amp.v; best = v; } }
    best.gainMul = 0.3;
    best.start(note, vel, tag, ++this.ageCtr, p, this.sr);
  }
  stopTag(tag) { for (const v of this.voices) if (v.active && v.tag === tag) v.stop(); if (this.bass.active && this.bass.tag === tag) this.bass.stop(); }
  releaseHeld(h) { this.stopTag(h.tag); this.evs = this.evs.filter(e => e.tag !== h.tag); }
  removeHeld(key) { this.held = this.held.filter(h => h.key !== key); }
  arpTick(t, p, bpm) {
    if (this.arpVoiceTag && t >= this.arpOffAt) { this.stopTag(this.arpVoiceTag); this.arpVoiceTag = 0; }
    if (t < this.arpNext) return;
    const has = new Uint8Array(128);
    for (const h of this.held) for (const m of h.notes) has[m & 127] = 1;
    const pool = []; for (let m = 0; m < 128; m++) if (has[m]) pool.push(m);
    const pc = pool.length;
    if (pc === 0) { this.arpOn = false; return; }
    const oct = Math.max(1, Math.min(4, p.arpOct)), n = pc * oct;
    let idx = 0;
    switch (p.arpPattern) {
      case 1: idx = (n - 1) - (this.arpIdx % n); ++this.arpIdx; break;
      case 2: { if (n < 2) { idx = 0; break; } const per = 2 * n - 2, k = this.arpIdx % per; idx = k < n ? k : per - k; ++this.arpIdx; break; }
      case 3: idx = Math.floor(this.rng.uni() * n) % n; break;
      default: idx = this.arpIdx % n; ++this.arpIdx;
    }
    const note = Math.min(120, pool[idx % pc] + 12 * Math.floor(idx / pc));
    const stepS = 60 / bpm * RATES[Math.min(5, Math.max(0, p.arpRate))];
    const tag = this.tagCounter++;
    this.startVoice(note, this.held.length ? this.held[this.held.length - 1].vel : 0.8, tag, p);
    this.arpVoiceTag = tag;
    this.arpOffAt = t + Math.floor(stepS * p.arpGate * this.sr);
    this.arpNext = t + Math.floor(stepS * this.sr);
  }
  patTick(t, p, bpm) {
    if (t < this.patNext) return;
    if (!this.held.length) { this.stopPerf(); return; }
    const c = RHYTHMS[((p.rhythm % 11) + 11) % 11][this.patStep & 15];
    this.ui.patStep = this.patStep & 15;
    if (c === 'X' || c === 'x' || c === '.') {
      if (this.patTag) { this.stopTag(this.patTag); this.patTag = 0; }
      if (c !== '.') {
        const H = this.held[this.held.length - 1], tag = this.tagCounter++, v = H.vel * (c === 'X' ? 1 : 0.78);
        for (const nt of H.notes) this.startVoice(nt, v, tag, p);
        this.patTag = tag;
      }
    }
    this.patStep = (this.patStep + 1) & 15;
    this.patNext = t + Math.floor(60 / bpm * 0.25 * this.sr);
  }
  publishChord(key, p, mask) {
    if (p.mode !== 0) { this.ui.root = key; this.ui.iv = 0; return; }
    this.ui.root = key % 12; this.ui.iv = chordIntervals(key % 12, mask, p.key, p.scale, p.complexity);
  }
  // ---- looper ----
  loopCmd(c, p) {
    if (c === 1) {
      if (this.loopState === L_Empty) this.loopState = L_Armed;
      else if (this.loopState === L_Armed) this.loopState = L_Empty;
      else if (this.loopState === L_Rec) { this.finishPassHeld(); this.loopState = L_Play; }
      else if (this.loopState === L_Play) { this.loopLayer = ++this.loopLayers; this.loopState = L_Dub; }
      else if (this.loopState === L_Dub) { this.finishPassHeld(); this.clearFresh(); this.loopState = L_Play; }
      else if (this.loopState === L_Stop) { this.loopLayer = ++this.loopLayers; this.loopPos = 0; this.loopIdx = 0; this.loopState = L_Dub; }
    } else if (c === 2) {
      if (this.loopState === L_Play || this.loopState === L_Dub || this.loopState === L_Rec) { if (this.loopState !== L_Play) { this.finishPassHeld(); this.clearFresh(); } this.releasePlayback(p); this.loopState = L_Stop; }
      else if (this.loopState === L_Stop) { this.loopPos = 0; this.loopIdx = 0; this.loopState = L_Play; }
      else if (this.loopState === L_Armed) this.loopState = L_Empty;
    } else if (c === 3) {
      if (!this.loopEv.length) return;
      let top = 0; for (const e of this.loopEv) top = Math.max(top, e.layer);
      this.releasePlayback(p);
      this.loopEv = this.loopEv.filter(e => e.layer !== top); this.loopLayers = Math.max(0, top - 1);
      if (this.loopState === L_Dub) this.loopLayer = ++this.loopLayers;
      this.loopIdx = 0; while (this.loopIdx < this.loopEv.length && this.loopEv[this.loopIdx].pos < this.loopPos) ++this.loopIdx;
      if (!this.loopEv.length && this.loopState !== L_Dub) { this.loopState = L_Empty; this.loopLen = 0; this.loopPos = 0; }
    } else if (c === 4) {
      this.releasePlayback(p); this.loopEv = []; this.loopLayers = 0; this.loopState = L_Empty; this.loopLen = 0; this.loopPos = 0; this.loopIdx = 0;
    }
  }
  startLoopRec(p) {
    const bpm = p.tempo, bars = Math.max(1, Math.min(16, p.loopBars));
    this.loopBpm = bpm; this.loopLen = Math.floor(bars * 4 * 60 / bpm * this.sr);
    this.loopEv = []; this.loopLayers = 0; this.loopLayer = 0; this.loopPos = 0; this.loopIdx = 0; this.loopState = L_Rec;
  }
  recordEv(key, vel, on, mask, p) {
    if (this.loopEv.length >= 4096 || !this.loopLen) return;
    let pos = this.loopPos;
    if (on && p.loopQuant) { const step = 60 / this.loopBpm * 0.25 * this.sr; pos = Math.floor(Math.floor(pos / step + 0.5) * step); if (pos >= this.loopLen) pos = 0; }
    this.insertEv({ pos, key: key & 127, vel: Math.max(1, Math.floor(vel * 127)), on, fresh: true, mask, layer: this.loopLayer });
  }
  insertEv(e) {
    const a = this.loopEv; let i = a.length; while (i > 0 && a[i - 1].pos > e.pos) --i;
    a.splice(i, 0, e); if (i < this.loopIdx) ++this.loopIdx;
  }
  finishPassHeld() { for (let k = 0; k < 128; k++) if (this.userOn[k]) { this.insertEv({ pos: this.loopLen ? this.loopLen - 1 : 0, key: k, vel: 0, on: false, fresh: true, mask: 0, layer: this.loopLayer }); this.userOn[k] = 0; } }
  clearFresh() { for (const e of this.loopEv) e.fresh = false; }
  releasePlayback(p) { const pp = Object.assign({}, p, { hold: false, keySwitch: false }); for (let k = 0; k < 128; k++) if (this.playOn[k]) { this.playOn[k] = 0; this.noteOff(k, pp); } }
  loopTick(p) {
    const st = this.loopState;
    if (st !== L_Rec && st !== L_Play && st !== L_Dub) return;
    if (st !== L_Rec) {
      const a = this.loopEv;
      while (this.loopIdx < a.length && a[this.loopIdx].pos <= this.loopPos) {
        const e = a[this.loopIdx++];
        if (e.fresh) continue;
        const pp = this._pp || (this._pp = {}); Object.assign(pp, p); pp.hold = false; pp.keySwitch = false;
        if (e.on) { if (this.playOn[e.key]) this.noteOff(e.key, pp); this.playOn[e.key] = 1; this.noteOn(e.key, e.vel / 127, pp, e.mask); }
        else if (this.playOn[e.key]) { this.playOn[e.key] = 0; this.noteOff(e.key, pp); }
      }
    }
    if (++this.loopPos >= this.loopLen) {
      this.loopPos = 0; this.loopIdx = 0;
      if (st === L_Rec || st === L_Dub) {
        const keep = st === L_Dub;
        for (let k = 0; k < 128; k++) if (this.userOn[k]) {
          const m = this.userOn[k] - 1;
          this.insertEv({ pos: this.loopLen - 1, key: k, vel: 0, on: false, fresh: true, mask: 0, layer: this.loopLayer });
          if (keep) this.insertEv({ pos: 0, key: k, vel: 100, on: true, fresh: true, mask: m, layer: this.loopLayer }); else this.userOn[k] = 0;
        }
        this.clearFresh();
        if (keep) for (const e of this.loopEv) if (e.pos === 0 && e.layer === this.loopLayer && this.userOn[e.key]) e.fresh = true;
        if (st === L_Rec) this.loopState = L_Play;
      }
      this.releasePlayback(p);
    }
  }
  render(L, R, n, p) {
    const sr = this.sr, bpm = p.tempo;
    const dTarget = Math.min(2.5, 60 / bpm * DTIMES[Math.min(4, Math.max(0, p.delayTime))]) * sr;
    const volTarget = p.volume * p.volume * 1.4;
    if (!this.smInit) { this.smVol = volTarget; this.smDel = dTarget; this.smCh = p.chorus; this.smDm = p.delayMix; this.smRm = p.reverbMix;
      this.smCut = p.cutoff; this.smDrv = p.drive; this.smPh = p.phaser; this.smFl = p.flanger; this.smInit = true; }
    const thr = 0.89, ro = this.revOut, dro = this.drumOut, drr = this.drumRevOut, voices = this.voices, apS = this.apS;
    for (let i = 0; i < n; i++) {
      const t = this.nowS + i;
      this.drums.clock(p, bpm);
      this.loopTick(p);
      this.processEvents(t, p);
      if (this.arpOn) this.arpTick(t, p, bpm);
      if (this.patOn) this.patTick(t, p, bpm);
      const K = this.smK;
      this.smVol += K * (volTarget - this.smVol); this.smCh += K * (p.chorus - this.smCh);
      this.smDm += K * (p.delayMix - this.smDm); this.smRm += K * (p.reverbMix - this.smRm); this.smDel += this.smKd * (dTarget - this.smDel);
      this.smCut += K * (p.cutoff - this.smCut); this.smDrv += K * (p.drive - this.smDrv); this.smPh += K * (p.phaser - this.smPh); this.smFl += K * (p.flanger - this.smFl);
      this.lfoPh += 5.6 / sr; if (this.lfoPh >= 1) this.lfoPh -= 1;
      this.lfo2 += (0.35 + 3.5 * p.movement) / sr; if (this.lfo2 >= 1) this.lfo2 -= 1;
      const vib = Math.sin(kTwoPi * this.lfoPh) * this.mod * 0.012;
      const ls = Math.sin(kTwoPi * this.lfo2);
      let s = 0;
      for (let k = 0; k < kMaxVoices; k++) { const v = voices[k]; if (v.active) s += v.render(p, sr, this.bend, vib, ls); }
      const b = this.bass.render(p, sr, this.bend);
      if (this.smDrv > 0.002) { const g = 1 + 12 * this.smDrv; s = s * (1 - this.smDrv) + Math.tanh(s * g) / Math.pow(g, 0.7) * this.smDrv; }
      if (this.smCut < 0.995) {
        if ((i & 7) === 0) { const fc = 30 * Math.pow(600, this.smCut); this.cutF1.set(fc, 0.25, sr); this.cutF2.set(fc, 0.05, sr); }
        s = this.cutF2.lp(this.cutF1.lp(s));
      } else { this.cutF1.reset(); this.cutF2.reset(); }
      if (this.smPh > 0.002) {
        this.phLfo += 0.28 / sr; if (this.phLfo >= 1) this.phLfo -= 1;
        const a = 0.5 + 0.45 * Math.sin(kTwoPi * this.phLfo);
        let x = s + this.phFb * 0.6;
        for (let k = 0; k < 6; k++) { const y = -a * x + apS[k]; apS[k] = x + a * y; x = y; }
        this.phFb = x;
        s = s * (1 - 0.5 * this.smPh) + x * this.smPh * 0.7;
      }
      this.flDl.push(s + this.flFb * 0.65 * this.smFl);
      if (this.smFl > 0.002) {
        this.flLfo += 0.12 / sr; if (this.flLfo >= 1) this.flLfo -= 1;
        const d = (0.0012 + 0.0045 * (0.5 + 0.5 * Math.sin(kTwoPi * this.flLfo))) * sr;
        const w = this.flDl.tap(d); this.flFb = w;
        s = s * (1 - 0.4 * this.smFl) + w * 0.6 * this.smFl;
      }
      this.chPh += 0.52 / sr; if (this.chPh >= 1) this.chPh -= 1;
      this.chL.push(s); this.chR.push(s);
      const dl = (0.0068 + 0.0019 * Math.sin(kTwoPi * this.chPh)) * sr;
      const dr = (0.0074 + 0.0019 * Math.sin(kTwoPi * (this.chPh + 0.37))) * sr;
      let l = s * (1 - 0.35 * this.smCh) + this.chL.tap(dl) * 0.8 * this.smCh;
      let r = s * (1 - 0.35 * this.smCh) + this.chR.tap(dr) * 0.8 * this.smCh;
      const dIn = (l + r) * 0.5;
      const tapL = this.dlL.tap(this.smDel), tapR = this.dlR.tap(this.smDel);
      this.dlLp += 0.35 * (tapL - this.dlLp); this.dlRp += 0.35 * (tapR - this.dlRp);
      this.dlL.push(dIn + this.dlRp * p.delayFb); this.dlR.push(this.dlLp * p.delayFb);
      l += tapL * this.smDm * 1.2; r += tapR * this.smDm * 1.2;
      this.rev.process(l, r, p.reverbSize, ro);
      this.drums.render(p, dro);
      if (p.drumVerb > 0.002) { this.drumRev.process(dro[0], dro[1], 0.55, drr); dro[0] += drr[0] * p.drumVerb * 1.6; dro[1] += drr[1] * p.drumVerb * 1.6; }
      l = (l * (1 - 0.4 * this.smRm) + ro[0] * this.smRm * 1.3 + b) * this.smVol + dro[0];
      r = (r * (1 - 0.4 * this.smRm) + ro[1] * this.smRm * 1.3 + b) * this.smVol + dro[1];
      const pk = Math.max(Math.abs(l), Math.abs(r));
      const target = pk > thr ? thr / pk : 1;
      if (target < this.limGain) this.limGain = target; else this.limGain += this.limRel * (target - this.limGain);
      L[i] = Math.max(-1, Math.min(1, l * this.limGain));
      R[i] = Math.max(-1, Math.min(1, r * this.limGain));
    }
    this.nowS += n;
  }
  activeNotes() { const a = []; for (const v of this.voices) if (v.active && !v.released) a.push(v.note); return a; }
  // loop a MIDI: devuelve [{t (en negras), on, notes, vel}]
  loopForExport(p) {
    const pp = Object.assign({}, p, { voiceLead: false }), out = [];
    for (const e of this.loopEv) {
      const t = e.pos / this.sr * this.loopBpm / 60;
      if (e.on) out.push({ t, on: true, key: e.key, vel: e.vel, notes: pp.mode === 0 ? rotate(this.baseNotes(e.key, pp, e.mask), pp.voicing) : [e.key + 12 * pp.octave] });
      else out.push({ t, on: false, key: e.key });
    }
    return { ev: out, len: this.loopLen / this.sr * this.loopBpm / 60, bpm: this.loopBpm };
  }
}

class LirioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.e = new Engine(sampleRate); this.p = null; this.rec = false; this.blk = 0;
    this.port.onmessage = ev => {
      const m = ev.data, p = this.p;
      switch (m.t) {
        case 'p': this.p = m.p; break;
        case 'on': if (p) this.e.userNoteOn(m.k, m.v, p); break;
        case 'off': if (p) this.e.userNoteOff(m.k, p); break;
        case 'sus': if (p) this.e.sustain(m.on, p); break;
        case 'bend': this.e.bend = Math.pow(2, m.s / 12); break;
        case 'mod': this.e.mod = m.v; break;
        case 'all': this.e.allOff(); break;
        case 'loop': if (p) this.e.loopCmd(m.c, p); break;
        case 'export': if (p) this.port.postMessage(Object.assign({ t: 'loopmidi' }, this.e.loopForExport(p))); break;
        case 'rec': this.rec = m.on; break;
      }
    };
  }
  process(inputs, outputs) {
    const out = outputs[0]; if (!out || !out[0]) return true;
    const L = out[0], R = out[1] || out[0], n = L.length;
    if (!this.p) { L.fill(0); if (out[1]) R.fill(0); return true; }
    this.e.render(L, R, n, this.p);
    if (this.rec) this.port.postMessage({ t: 'pcm', l: L.slice(0), r: R.slice(0) });
    if (++this.blk % 8 === 0) {
      const u = this.e.ui, e = this.e;
      let name = '', tag = 0;
      if (u.root >= 0 && u.iv > 0) { const c = chordSuffix(u.iv); name = c.s; tag = c.tag; }
      this.port.postMessage({ t: 'ui', root: u.root, iv: u.iv, name, tag, act: u.act, ks: u.ks, step: e.drums.uiStep, pat: u.patStep, notes: e.activeNotes(), lim: e.limGain,
        loop: e.loopState, loopPos: e.loopLen ? e.loopPos / e.loopLen : 0, loopN: e.loopEv.length });
    }
    return true;
  }
}
registerProcessor('lirio', LirioProcessor);
