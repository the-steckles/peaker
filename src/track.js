// Pointing controllers. They see only measured power and their own commanded az/el.
// Call update(powerDbm) once per sweep after the antenna reaches the last returned target.

const toLinear = (db) => 10 ** (db / 10);
const toDb = (p) => 10 * Math.log10(p);
const wrapAz = (az) => ((az % 360) + 360) % 360;
const cosEl = (el) => Math.max(0.05, Math.cos((el * Math.PI) / 180));
const offset = (c, x, y) => ({ az: wrapAz(c.az + x / cosEl(c.el)), el: Math.min(90, Math.max(0, c.el + y)) });

// Vertex of a parabola through three dB samples. The main beam is close to parabolic in dB.
export function parabolicOffset(minus, center, plus, step) {
  const curve = minus - 2 * center + plus;
  if (curve >= -1e-6) return plus > minus ? step : minus > plus ? -step : 0;
  return Math.max(-step, Math.min(step, (step * (minus - plus)) / (2 * curve)));
}

// Averages power over `dwell` sweeps at each point.
function averager(dwell) {
  let sum = 0, n = 0;
  return (db) => {
    sum += toLinear(db);
    if (++n < dwell) return null;
    const avg = toDb(sum / n);
    sum = 0; n = 0;
    return avg;
  };
}

export function spiralPoints(radiusDeg, spacingDeg) {
  const pts = [{ x: 0, y: 0 }];
  const b = spacingDeg / (2 * Math.PI);
  for (let t = spacingDeg / b; b * t <= radiusDeg;) {
    pts.push({ x: b * t * Math.cos(t), y: b * t * Math.sin(t) });
    t += spacingDeg / (b * t);
  }
  return pts;
}

// Three-point az then el measurement around a center. Returns the corrected center per cycle.
function crossScan(start, step, dwell) {
  const avg = averager(dwell);
  let center = { ...start }, axis = 0, idx = 0, samples = [];
  const pattern = [0, -1, 1];
  const point = () => {
    const d = pattern[idx] * step;
    return axis === 0 ? offset(center, d, 0) : offset(center, 0, d);
  };
  return {
    target: point,
    center: () => center,
    feed(db) {
      const v = avg(db);
      if (v === null) return null;
      samples.push(v);
      if (++idx < 3) return null;
      const delta = parabolicOffset(samples[1], samples[0], samples[2], step);
      center = axis === 0 ? offset(center, delta, 0) : offset(center, 0, delta);
      const level = samples[0];
      idx = 0; samples = [];
      axis = 1 - axis;
      return { level, delta, axisDone: axis === 0 };
    },
  };
}

export function createAutoPeak({ az, el, beamwidthDeg, radiusDeg, noiseDbm, dwell = 2, marginDb = 6 }) {
  const origin = { az, el };
  const points = spiralPoints(radiusDeg, beamwidthDeg * 0.5).map((p) => offset(origin, p.x, p.y));
  const avg = averager(dwell);
  let i = 0, best = { db: -Infinity, ...origin }, phase = 'search', scan = null, cycles = 0;

  return {
    get phase() { return phase; },
    get progress() { return phase === 'search' ? i / points.length : 1; },
    target: () => (phase === 'search' ? points[Math.min(i, points.length - 1)] : phase === 'refine' ? scan.target() : { az: best.az, el: best.el }),
    update(db) {
      if (phase === 'search') {
        const v = avg(db);
        if (v === null) return;
        if (v > best.db) best = { db: v, ...points[i] };
        if (++i < points.length) return;
        if (best.db < noiseDbm + marginDb) { phase = 'notfound'; best = { ...best, ...origin }; return; }
        phase = 'refine';
        scan = crossScan(best, beamwidthDeg / 3, dwell + 1);
      } else if (phase === 'refine') {
        const r = scan.feed(db);
        if (r?.axisDone && ++cycles >= 3) {
          const c = scan.center();
          best = { ...best, az: c.az, el: c.el };
          phase = 'done';
        }
      }
    },
  };
}

export function createStepTrack({ az, el, beamwidthDeg, noiseDbm, dwell = 2, lossMarginDb = 4 }) {
  const scan = crossScan({ az, el }, beamwidthDeg / 4, dwell);
  let phase = 'tracking', level = null;
  return {
    get phase() { return phase; },
    get level() { return level; },
    target: () => scan.target(),
    update(db) {
      const r = scan.feed(db);
      if (!r) return;
      level = r.level;
      phase = r.level < noiseDbm + lossMarginDb ? 'lost' : 'tracking';
    },
  };
}
