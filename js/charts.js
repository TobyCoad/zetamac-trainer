/* Tiny dependency-free SVG chart builders. Each returns an SVG string. */
(function () {
  const W = 640, H = 280;
  const PAD = { l: 44, r: 14, t: 14, b: 30 };

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function niceTicks(min, max, n) {
    if (min === max) { max = min + 1; }
    const span = max - min;
    const step0 = span / Math.max(1, n);
    const mag = Math.pow(10, Math.floor(Math.log10(step0)));
    let step = mag;
    for (const m of [1, 2, 2.5, 5, 10]) {
      if (step0 <= m * mag) { step = m * mag; break; }
    }
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
      ticks.push(Math.round(v * 1000) / 1000);
    }
    return ticks;
  }

  /* series: [{pts: [[x, y], ...], color, label, dashed}], xLabels: fn(x)->string */
  function lineChart(series, opts) {
    opts = opts || {};
    const all = series.flatMap(s => s.pts);
    if (!all.length) return '';
    const xs = all.map(p => p[0]), ys = all.map(p => p[1]);
    const xmin = Math.min(...xs), xmax = Math.max(...xs);
    let ymin = opts.yMin !== undefined ? opts.yMin : Math.min(...ys);
    let ymax = Math.max(...ys);
    if (ymin === ymax) { ymax = ymin + 1; }
    const yPadFrac = 0.08;
    const yr = ymax - ymin;
    ymax += yr * yPadFrac;
    if (opts.yMin === undefined) ymin -= yr * yPadFrac;

    const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
    const X = x => xmin === xmax ? PAD.l + iw / 2 : PAD.l + ((x - xmin) / (xmax - xmin)) * iw;
    const Y = y => PAD.t + (1 - (y - ymin) / (ymax - ymin)) * ih;

    let g = '';
    for (const t of niceTicks(ymin, ymax, 4)) {
      const y = Y(t);
      if (y < PAD.t - 1 || y > H - PAD.b + 1) continue;
      g += `<line x1="${PAD.l}" y1="${y}" x2="${W - PAD.r}" y2="${y}" stroke="#2c3344" stroke-width="1"/>`;
      g += `<text x="${PAD.l - 7}" y="${y + 4}" text-anchor="end" font-size="12" fill="#8b93a7">${opts.yFmt ? opts.yFmt(t) : t}</text>`;
    }
    if (opts.xLabelFn) {
      const shown = xmin === xmax ? [xmin] : [xmin, xmin + (xmax - xmin) / 2, xmax];
      for (const x of shown) {
        g += `<text x="${X(x)}" y="${H - 8}" text-anchor="middle" font-size="12" fill="#8b93a7">${esc(opts.xLabelFn(x))}</text>`;
      }
    }

    let paths = '';
    for (const s of series) {
      if (!s.pts.length) continue;
      const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
      paths += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linejoin="round" ${s.dashed ? 'stroke-dasharray="5,5" opacity="0.75"' : ''}/>`;
      if (!s.dashed && s.pts.length <= 60) {
        for (const p of s.pts) {
          paths += `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3.2" fill="${s.color}"/>`;
        }
      }
    }
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${g}${paths}</svg>`;
  }

  /* items: [{label, value, color, sub}] — horizontal bars */
  function barChart(items, opts) {
    opts = opts || {};
    if (!items.length) return '';
    const rowH = 46, labelW = 56;
    const h = items.length * rowH + 8;
    const w = W;
    const maxV = Math.max(...items.map(i => i.value), 1e-9);
    let g = '';
    items.forEach((it, i) => {
      const y = 8 + i * rowH;
      const bw = Math.max(4, (it.value / maxV) * (w - labelW - 120));
      g += `<text x="${labelW - 10}" y="${y + 20}" text-anchor="end" font-size="17" font-weight="700" fill="#e8ebf2">${esc(it.label)}</text>`;
      g += `<rect x="${labelW}" y="${y + 6}" width="${bw}" height="20" rx="6" fill="${it.color}"/>`;
      g += `<text x="${labelW + bw + 10}" y="${y + 21}" font-size="14" font-weight="600" fill="#e8ebf2">${esc(opts.fmt ? opts.fmt(it.value) : it.value)}</text>`;
      if (it.sub) g += `<text x="${labelW}" y="${y + 41}" font-size="11" fill="#8b93a7">${esc(it.sub)}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${h}" xmlns="http://www.w3.org/2000/svg">${g}</svg>`;
  }

  /* Colour for a ratio (grouped median / baseline): 0.75 = green, 1 = amber-ish mid, 1.5+ = red */
  function ratioColor(ratio) {
    const t = Math.max(0, Math.min(1, (ratio - 0.72) / (1.5 - 0.72)));
    // interpolate green (52,208,166) -> amber (255,180,84) -> red (255,93,115)
    let r, g, b;
    if (t < 0.5) {
      const u = t / 0.5;
      r = 52 + (255 - 52) * u; g = 208 + (180 - 208) * u; b = 166 + (84 - 166) * u;
    } else {
      const u = (t - 0.5) / 0.5;
      r = 255; g = 180 + (93 - 180) * u; b = 84 + (115 - 84) * u;
    }
    return `rgb(${r | 0},${g | 0},${b | 0})`;
  }

  window.Charts = { lineChart, barChart, ratioColor };
})();
