import { envelopeDbi, envelopeStartDeg, gainDbi, peakGainDbi } from './antenna.js';

const M = { l: 62, r: 14, t: 12, b: 26 };
const C = { bg: '#0a0f14', grid: '#1e2a33', axis: '#8fa3b0', trace: '#4fe0c0', hold: '#e8a33d', marker: '#ffffff', env: '#e8a33d' };
const FONT = '11px ui-monospace, Consolas, monospace';

function prepare(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, w, h);
  ctx.font = FONT;
  return { ctx, w, h, pw: w - M.l - M.r, ph: h - M.t - M.b };
}

export function formatMHz(hz, spanHz) {
  const decimals = spanHz >= 50e6 ? 1 : spanHz >= 5e6 ? 2 : spanHz >= 500e3 ? 3 : spanHz >= 50e3 ? 4 : 5;
  return (hz / 1e6).toFixed(decimals);
}

function freqAxis(p, centerHz, spanHz) {
  const { ctx, pw, h } = p;
  ctx.fillStyle = C.axis;
  ctx.textAlign = 'center';
  for (let i = 0; i <= 4; i++) {
    const f = centerHz - spanHz / 2 + (spanHz * i) / 4;
    ctx.textAlign = i === 0 ? 'left' : i === 4 ? 'right' : 'center';
    ctx.fillText(formatMHz(f, spanHz), M.l + (pw * i) / 4, h - 9);
  }
}

export function drawSpectrum(canvas, { trace, hold, centerHz, spanHz, topDbm, bottomDbm, marker }) {
  const p = prepare(canvas);
  const { ctx, pw, ph } = p;
  const y = (db) => M.t + ((topDbm - db) / (topDbm - bottomDbm)) * ph;
  const x = (i, n) => M.l + (i / (n - 1)) * pw;

  ctx.strokeStyle = C.grid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i <= 10; i++) { const gx = Math.round(M.l + (pw * i) / 10) + 0.5; ctx.moveTo(gx, M.t); ctx.lineTo(gx, M.t + ph); }
  ctx.stroke();
  ctx.fillStyle = C.axis;
  ctx.textAlign = 'right';
  const stepDb = topDbm - bottomDbm > 80 ? 20 : 10;
  ctx.beginPath();
  for (let db = Math.ceil(bottomDbm / stepDb) * stepDb; db <= topDbm; db += stepDb) {
    const gy = Math.round(y(db)) + 0.5;
    ctx.moveTo(M.l, gy); ctx.lineTo(M.l + pw, gy);
    ctx.fillText(`${db}`, M.l - 6, gy + 4);
  }
  ctx.stroke();
  ctx.save();
  ctx.translate(13, M.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillText('Amplitude (dBm)', 0, 0);
  ctx.restore();
  freqAxis(p, centerHz, spanHz);

  ctx.save();
  ctx.beginPath();
  ctx.rect(M.l, M.t, pw, ph);
  ctx.clip();
  const line = (data, color) => {
    ctx.strokeStyle = color;
    ctx.beginPath();
    data.forEach((v, i) => (i ? ctx.lineTo(x(i, data.length), y(v)) : ctx.moveTo(x(i, data.length), y(v))));
    ctx.stroke();
  };
  if (hold) line(hold, C.hold);
  if (trace) line(trace, C.trace);
  ctx.restore();

  if (marker && Number.isFinite(marker.dbm)) {
    const mx = M.l + ((marker.freqHz - (centerHz - spanHz / 2)) / spanHz) * pw;
    const my = Math.max(M.t, Math.min(M.t + ph, y(marker.dbm)));
    if (mx >= M.l && mx <= M.l + pw) {
      ctx.fillStyle = C.marker;
      ctx.beginPath();
      ctx.moveTo(mx, my - 2); ctx.lineTo(mx - 5, my - 10); ctx.lineTo(mx + 5, my - 10);
      ctx.fill();
      const text = `${(marker.freqHz / 1e6).toFixed(4)} MHz  ${marker.dbm.toFixed(1)} dBm`;
      const tw = ctx.measureText(text).width;
      ctx.textAlign = 'left';
      ctx.fillText(text, Math.max(M.l + 4, Math.min(M.l + pw - tw - 4, mx - tw / 2)), Math.max(M.t + 12, my - 15));
    }
  }
}

// Stops sampled from a perceptually ordered dark-to-bright ramp.
const STOPS = [[8, 12, 30], [32, 28, 92], [82, 34, 124], [150, 48, 104], [214, 88, 62], [245, 158, 36], [250, 230, 130]];
const LUT = Array.from({ length: 256 }, (_, i) => {
  const t = (i / 255) * (STOPS.length - 1), a = Math.floor(t), b = Math.min(a + 1, STOPS.length - 1), k = t - a;
  return STOPS[a].map((c, n) => Math.round(c + (STOPS[b][n] - c) * k));
});

export function createWaterfall(canvas, bins, rows = 320) {
  const off = document.createElement('canvas');
  off.width = bins; off.height = rows;
  const octx = off.getContext('2d');
  octx.fillStyle = `rgb(${LUT[0]})`;
  octx.fillRect(0, 0, bins, rows);
  const line = octx.createImageData(bins, 1);
  return {
    push(trace, lowDbm, highDbm) {
      octx.drawImage(off, 0, 1);
      for (let i = 0; i < bins; i++) {
        const v = Math.max(0, Math.min(255, Math.round(((trace[i] - lowDbm) / (highDbm - lowDbm)) * 255)));
        const [r, g, b] = LUT[v];
        line.data.set([r, g, b, 255], i * 4);
      }
      octx.putImageData(line, 0, 0);
    },
    draw(centerHz, spanHz) {
      const p = prepare(canvas);
      p.ctx.imageSmoothingEnabled = false;
      p.ctx.drawImage(off, M.l, M.t, p.pw, p.ph);
      freqAxis(p, centerHz, spanHz);
      p.ctx.save();
      p.ctx.translate(13, M.t + p.ph / 2);
      p.ctx.rotate(-Math.PI / 2);
      p.ctx.textAlign = 'center';
      p.ctx.fillStyle = C.axis;
      p.ctx.fillText('Time (newest at top)', 0, 0);
      p.ctx.restore();
    },
  };
}

export function drawPattern(canvas, { diameterM, freqHz, beamwidth, offAxis }) {
  const p = prepare(canvas);
  const { ctx, pw, ph } = p;
  const peak = peakGainDbi(diameterM, freqHz);
  const maxDeg = beamwidth * 8;
  const top = Math.ceil(peak / 10) * 10, bottom = Math.min(-20, top - 80);
  const x = (t) => M.l + ((t + maxDeg) / (2 * maxDeg)) * pw;
  const y = (g) => M.t + ((top - g) / (top - bottom)) * ph;

  ctx.strokeStyle = C.grid;
  ctx.fillStyle = C.axis;
  ctx.textAlign = 'right';
  ctx.beginPath();
  for (let g = bottom; g <= top; g += 20) { ctx.moveTo(M.l, y(g)); ctx.lineTo(M.l + pw, y(g)); ctx.fillText(`${g}`, M.l - 6, y(g) + 4); }
  ctx.stroke();
  ctx.textAlign = 'center';
  for (const t of [-maxDeg, -maxDeg / 2, 0, maxDeg / 2, maxDeg]) ctx.fillText(`${t.toFixed(2)}°`, Math.max(M.l + 18, Math.min(M.l + pw - 18, x(t))), p.h - 9);
  ctx.save();
  ctx.translate(13, M.t + ph / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Gain (dBi)', 0, 0);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(M.l, M.t, pw, ph);
  ctx.clip();
  ctx.strokeStyle = C.trace;
  ctx.beginPath();
  for (let i = 0; i <= pw; i++) {
    const t = -maxDeg + (2 * maxDeg * i) / pw;
    const py = y(gainDbi(t, diameterM, freqHz));
    if (i) ctx.lineTo(M.l + i, py); else ctx.moveTo(M.l, py);
  }
  ctx.stroke();
  const start = envelopeStartDeg(diameterM, freqHz);
  if (start < maxDeg) {
    ctx.strokeStyle = C.env;
    ctx.setLineDash([4, 3]);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      for (let t = start; t <= maxDeg; t += maxDeg / 150) {
        if (t === start) ctx.moveTo(x(side * t), y(envelopeDbi(t))); else ctx.lineTo(x(side * t), y(envelopeDbi(t)));
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (offAxis !== null) {
    ctx.fillStyle = C.marker;
    ctx.beginPath();
    ctx.arc(x(Math.min(offAxis, maxDeg)), y(gainDbi(offAxis, diameterM, freqHz)), 4, 0, 2 * Math.PI);
    ctx.fill();
  }
  ctx.restore();
}
