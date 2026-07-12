/* Analytics — computes and renders the Stats tab from stored sessions.
 * Question tuple: [op, x, y, ms, err] with operands AS PRESENTED
 * (op: 0=add 1=sub 2=mul 3=div; sub is x−y, div is x÷y). */
(function () {
  const OP_NAME = ['Addition', 'Subtraction', 'Multiplication', 'Division'];
  const OP_SYM = ['+', '−', '×', '÷'];
  const OP_COLOR = ['#5b8cff', '#b48bff', '#34d0a6', '#ffb454'];

  let filters = { mode: 'all', window: 'all' };

  function median(arr) {
    if (!arr.length) return 0;
    const a = [...arr].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }
  function mean(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function fmtS(ms) { return (ms / 1000).toFixed(2) + 's'; }
  function fmtDate(ts) {
    const d = new Date(ts);
    return `${d.getDate()}/${d.getMonth() + 1}`;
  }

  function filteredSessions() {
    let ss = Store.loadSessions();
    if (filters.mode !== 'all') ss = ss.filter(s => s.mode === filters.mode);
    if (filters.window !== 'all') {
      const cutoff = Date.now() - Number(filters.window) * 86400e3;
      ss = ss.filter(s => s.ts >= cutoff);
    }
    return ss.sort((a, b) => a.ts - b.ts);
  }

  /* ---- feature extraction ---- */
  function addFeatures(x, y) { // x + y
    return { carry: (x % 10) + (y % 10) >= 10, size: sizeBucket(Math.max(x, y)) };
  }
  function subFeatures(x, y) { // x − y
    return { carry: (x % 10) < (y % 10), size: sizeBucket(x) };
  }
  function sizeBucket(v) { return v <= 20 ? '≤20' : v <= 50 ? '21–50' : v <= 100 ? '51–100' : '>100'; }
  function bigBucket(v) { return v <= 12 ? '2–12' : v <= 25 ? '13–25' : v <= 50 ? '26–50' : '51+'; }

  /* small factor of a mul/div question: mul = min operand; div = the divisor y */
  function mulSmall(q) { return q[0] === 2 ? Math.min(q[1], q[2]) : q[2]; }
  function mulBig(q) { return q[0] === 2 ? Math.max(q[1], q[2]) : q[1] / q[2]; }

  /* ---- render root ---- */
  function render() {
    const body = document.getElementById('stats-body');
    const ss = filteredSessions();
    const qs = ss.flatMap(s => s.qs.map(q => ({ q, ts: s.ts, sid: s.id })));

    if (!ss.length) {
      body.innerHTML = `<div class="empty-msg">No sessions yet${filters.mode !== 'all' || filters.window !== 'all' ? ' for this filter' : ''}.<br>Play a round and your analytics will appear here.</div>`;
      return;
    }

    body.innerHTML =
      overviewCards(ss, qs) +
      progressSection(ss) +
      highScoreSection(ss) +
      opSpeedSection(ss, qs) +
      mulHeatmapSection(qs) +
      addSubSection(qs) +
      weakSpotsSection(qs) +
      sessionsTable(ss) +
      dataSection();

    wireDataButtons();
  }

  /* ---- overview cards ---- */
  function paceOf(s) {
    const elapsedS = s.hitTargetMs !== null && s.hitTargetMs !== undefined ? s.hitTargetMs / 1000 : s.dur;
    return elapsedS > 0 ? s.qs.length / (elapsedS / 60) : 0;
  }

  function overviewCards(ss, qs) {
    const totalQ = qs.length;
    const bestSprint = Math.max(0, ...ss.filter(s => s.mode === 'sprint' && s.dur === 120).map(s => s.score));
    const eighties = ss.filter(s => s.mode === 'eighty');
    const bestEighty = eighties.length ? Math.max(...eighties.map(s => s.score)) : null;

    // improvement: median pace of last 5 sessions vs first 5 (needs >=6)
    let deltaHtml = '';
    if (ss.length >= 6) {
      const paces = ss.map(paceOf);
      const early = median(paces.slice(0, 5));
      const late = median(paces.slice(-5));
      if (early > 0) {
        const pct = ((late - early) / early) * 100;
        deltaHtml = `<span class="delta ${pct >= 0 ? 'up' : 'down'}">${pct >= 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(0)}%</span>`;
      }
    }
    const recentPace = median(ss.slice(-5).map(paceOf));

    return `<div class="cards-row">
      <div class="stat-card"><b>${ss.length}</b><small>sessions · ${totalQ} questions</small></div>
      <div class="stat-card"><b>${recentPace.toFixed(1)}${deltaHtml}</b><small>answers/min, last 5 sessions</small></div>
      <div class="stat-card"><b>${bestSprint || '–'}</b><small>best 120s sprint</small></div>
      <div class="stat-card"><b>${bestEighty === null ? '–' : bestEighty >= Game.EIGHTY_TARGET ? '80 ✓' : bestEighty + '/80'}</b><small>best 80-in-8</small></div>
    </div>`;
  }

  /* ---- progress over time ---- */
  function progressSection(ss) {
    const pts = ss.map((s, i) => [i, paceOf(s)]);
    const roll = pts.map((p, i) => {
      const w = pts.slice(Math.max(0, i - 4), i + 1).map(q => q[1]);
      return [p[0], mean(w)];
    });
    const svg = Charts.lineChart(
      [
        { pts, color: '#5b8cff' },
        { pts: roll, color: '#34d0a6', dashed: true },
      ],
      { yMin: 0, xLabelFn: x => fmtDate(ss[Math.round(x)] ? ss[Math.round(x)].ts : ss[ss.length - 1].ts), yFmt: v => v.toFixed(0) }
    );
    return `<div class="stat-section"><h3>Pace over time — answers per minute</h3>
      <div class="chart-wrap">${svg}</div>
      <div class="legend"><span><i style="background:#5b8cff"></i>per session</span><span><i style="background:#34d0a6"></i>5-session average</span></div>
      <div class="note">Pace normalises across durations and modes (a 40-score 120s sprint = 20/min = on track for 80-in-8 at 10/min).</div>
    </div>`;
  }

  /* ---- high score over time ----
   * Scores only compare within one (mode, duration) group, so plot the
   * group with the most sessions under the current filter. Partial
   * (end-&-save) sessions store their real played duration and therefore
   * drop out of the standard-duration groups automatically. */
  function highScoreSection(ss) {
    let group, label;
    if (filters.mode === 'eighty') {
      group = ss.filter(s => s.mode === 'eighty');
      label = '80 in 8 — questions answered';
    } else {
      const cands = ss.filter(s =>
        filters.mode === 'all' ? s.mode !== 'eighty' : s.mode === filters.mode);
      const counts = new Map();
      for (const s of cands) {
        const k = `${s.mode}|${s.dur}`;
        counts.set(k, (counts.get(k) || 0) + 1);
      }
      const bestKey = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!bestKey) return '';
      const [m, d] = bestKey[0].split('|');
      group = cands.filter(s => s.mode === m && s.dur === Number(d));
      label = `${m === 'target' ? 'targeted ' : ''}${d}s sprint`;
    }
    if (group.length < 2) return '';

    const pts = group.map((s, i) => [i, s.score]);
    let hi = -Infinity;
    const best = group.map((s, i) => { hi = Math.max(hi, s.score); return [i, hi]; });
    const svg = Charts.lineChart(
      [
        { pts, color: '#5b8cff' },
        { pts: best, color: '#34d0a6', dashed: true },
      ],
      { yMin: 0, xLabelFn: x => fmtDate(group[Math.round(x)] ? group[Math.round(x)].ts : group[group.length - 1].ts), yFmt: v => v.toFixed(0) }
    );
    return `<div class="stat-section"><h3>High score — ${esc(label)}</h3>
      <div class="chart-wrap">${svg}</div>
      <div class="legend"><span><i style="background:#5b8cff"></i>score per session</span><span><i style="background:#34d0a6"></i>running high score</span></div>
      <div class="note">Shows your most-played mode/duration under the current filter (${group.length} sessions) — scores across different durations aren't comparable.</div>
    </div>`;
  }

  /* ---- per-operation speed + accuracy ---- */
  function opSpeedSection(ss, qs) {
    const items = [];
    for (let op = 0; op < 4; op++) {
      const g = qs.filter(r => r.q[0] === op);
      if (!g.length) continue;
      const med = median(g.map(r => r.q[3]));
      const errRate = mean(g.map(r => (r.q[4] > 0 ? 1 : 0))) * 100;
      items.push({
        label: OP_SYM[op],
        value: med / 1000,
        color: OP_COLOR[op],
        sub: `${g.length} qs · ${errRate.toFixed(0)}% had a wrong entry`,
      });
    }
    const bars = Charts.barChart(items, { fmt: v => v.toFixed(2) + 's' });

    // trend: median s/q per op per session (last 20 sessions with data)
    const recent = ss.slice(-20);
    const series = [];
    for (let op = 0; op < 4; op++) {
      const pts = [];
      recent.forEach((s, i) => {
        const t = s.qs.filter(q => q[0] === op).map(q => q[3]);
        if (t.length >= 3) pts.push([i, median(t) / 1000]);
      });
      if (pts.length >= 2) series.push({ pts, color: OP_COLOR[op], label: OP_SYM[op] });
    }
    const trend = series.length
      ? `<h3 style="margin-top:16px">Speed trend by operation — median s/question</h3>
         <div class="chart-wrap">${Charts.lineChart(series, { yMin: 0, xLabelFn: x => fmtDate(recent[Math.round(x)] ? recent[Math.round(x)].ts : recent[recent.length - 1].ts), yFmt: v => v.toFixed(1) })}</div>
         <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.label}</span>`).join('')}</div>`
      : '';

    return `<div class="stat-section"><h3>Median time per question</h3>
      <div class="chart-wrap">${bars}</div>${trend}</div>`;
  }

  /* ---- multiplication / division heatmap ---- */
  function mulHeatmapSection(qs) {
    const mulQs = qs.filter(r => r.q[0] === 2 || r.q[0] === 3);
    if (mulQs.length < 30) return '';
    const cols = ['2–12', '13–25', '26–50', '51+'];
    const smalls = [...new Set(mulQs.map(r => mulSmall(r.q)))].filter(v => v >= 2 && v <= 12).sort((a, b) => a - b);
    if (!smalls.length) return '';
    const overallMed = median(mulQs.map(r => r.q[3]));

    let html = '';
    for (const opFilter of [2, 3]) {
      const sub = mulQs.filter(r => r.q[0] === opFilter);
      if (sub.length < 15) continue;
      let grid = `<div class="hm-label"></div>` + cols.map(c => `<div class="hm-label">${c}</div>`).join('');
      for (const sf of smalls) {
        grid += `<div class="hm-label">${OP_SYM[opFilter]}${sf}</div>`;
        for (const c of cols) {
          const cell = sub.filter(r => mulSmall(r.q) === sf && bigBucket(mulBig(r.q)) === c);
          if (cell.length < 3) {
            grid += `<div class="hm-cell hm-empty">·</div>`;
          } else {
            const m = median(cell.map(r => r.q[3]));
            grid += `<div class="hm-cell" style="background:${Charts.ratioColor(m / overallMed)}" title="${cell.length} qs">${(m / 1000).toFixed(1)}</div>`;
          }
        }
      }
      html += `<h3 ${opFilter === 3 ? 'style="margin-top:16px"' : ''}>${OP_NAME[opFilter]} table — median seconds</h3>
        <div class="heatmap" style="grid-template-columns:44px repeat(${cols.length},1fr)">${grid}</div>`;
    }
    if (!html) return '';
    return `<div class="stat-section">${html}
      <div class="note">Rows: the small factor (× row = either operand, ÷ row = divisor). Columns: size of the other number. Green = faster than your typical ×/÷ question, red = slower. Cells need ≥3 samples.</div></div>`;
  }

  /* ---- addition / subtraction carry-borrow breakdown ---- */
  function addSubSection(qs) {
    const rows = [];
    for (const [op, name, feat] of [[0, 'Addition', addFeatures], [1, 'Subtraction', subFeatures]]) {
      const g = qs.filter(r => r.q[0] === op);
      if (g.length < 20) continue;
      const base = median(g.map(r => r.q[3]));
      for (const carry of [false, true]) {
        const cell = g.filter(r => feat(r.q[1], r.q[2]).carry === carry);
        if (cell.length < 5) continue;
        const m = median(cell.map(r => r.q[3]));
        rows.push({
          label: `${name} ${carry ? (op === 0 ? 'with carrying' : 'with borrowing') : (op === 0 ? 'no carry' : 'no borrow')}`,
          value: m / 1000, color: Charts.ratioColor(m / base),
          sub: `${cell.length} qs`,
        });
      }
    }
    if (!rows.length) return '';
    return `<div class="stat-section"><h3>Carrying &amp; borrowing cost</h3>
      <div class="chart-wrap">${Charts.barChart(rows, { fmt: v => v.toFixed(2) + 's' })}</div>
      <div class="note">Carrying: units digits sum ≥ 10. Borrowing: top units digit smaller than the one subtracted. A big gap here means drilling complements-to-10 will pay off.</div></div>`;
  }

  /* ---- weak / strong archetypes ---- */
  function archetypeKey(q) {
    const [op, x, y] = q;
    if (op === 0) {
      const f = addFeatures(x, y);
      return `+ ${f.size}${f.carry ? ' w/ carry' : ''}`;
    }
    if (op === 1) {
      const f = subFeatures(x, y);
      return `− ${f.size}${f.carry ? ' w/ borrow' : ''}`;
    }
    if (op === 2) return `× ${mulSmall(q)}s`;
    return `÷ by ${mulSmall(q)}`;
  }

  function weakSpotsSection(qs) {
    if (qs.length < 40) {
      return `<div class="stat-section"><h3>Weak spots</h3>
        <div class="note">Need ~40+ questions to spot patterns — you have ${qs.length}. Keep playing.</div></div>`;
    }
    // baseline median per op
    const opMed = [0, 1, 2, 3].map(op => median(qs.filter(r => r.q[0] === op).map(r => r.q[3])) || 1);
    const groups = new Map();
    for (const r of qs) {
      const k = archetypeKey(r.q);
      if (!groups.has(k)) groups.set(k, { op: r.q[0], times: [], errs: 0 });
      const g = groups.get(k);
      g.times.push(r.q[3]);
      g.errs += r.q[4] > 0 ? 1 : 0;
    }
    const scored = [];
    for (const [k, g] of groups) {
      if (g.times.length < 6) continue;
      const m = median(g.times);
      scored.push({
        key: k, n: g.times.length, med: m,
        ratio: m / opMed[g.op],
        errPct: (g.errs / g.times.length) * 100,
      });
    }
    if (scored.length < 3) {
      return `<div class="stat-section"><h3>Weak spots</h3><div class="note">Not enough data per category yet — keep playing.</div></div>`;
    }
    scored.sort((a, b) => b.ratio - a.ratio);
    const worst = scored.slice(0, 5);
    const best = scored.slice(-3).reverse();

    const row = (s, cls) => `<div class="spot ${cls}">
      <div class="spot-name">${esc(s.key)}<span class="spot-meta">${s.n} qs · ${s.errPct.toFixed(0)}% wrong entries · ${s.ratio >= 1 ? '+' : '−'}${Math.abs((s.ratio - 1) * 100).toFixed(0)}% vs your ${OP_SYM[opForKey(s.key)]} median</span></div>
      <div class="spot-val">${fmtS(s.med)}</div></div>`;

    return `<div class="stat-section"><h3>Weak spots — slowest question types</h3>
      <div class="spot-list">${worst.map(s => row(s, 'bad')).join('')}</div>
      <h3 style="margin-top:16px">Strengths</h3>
      <div class="spot-list">${best.map(s => row(s, 'good')).join('')}</div>
      <div class="note">Grouped by structure (times table, operand size, carry/borrow). Ratio compares each group's median time to your overall median for that operation, so slow ops don't drown out patterns within fast ops. Groups need ≥6 samples.</div></div>`;
  }

  /* ---- weakness model for targeted-practice mode ----
   * Built from ALL history (ignores the stats filters). Returns null when
   * there isn't enough data (<40 questions). */
  function buildTargetModel() {
    const qs = Store.loadSessions().flatMap(s => s.qs);
    if (qs.length < 40) return null;
    const opMed = [0, 1, 2, 3].map(op => median(qs.filter(q => q[0] === op).map(q => q[3])) || 1);

    const groups = new Map();
    for (const q of qs) {
      const [op, x, y] = q;
      let key, spec;
      if (op === 0) { const f = addFeatures(x, y); key = `a${f.size}${f.carry}`; spec = { kind: 'add', size: f.size, carry: f.carry }; }
      else if (op === 1) { const f = subFeatures(x, y); key = `s${f.size}${f.carry}`; spec = { kind: 'sub', size: f.size, carry: f.carry }; }
      else if (op === 2) { key = `m${mulSmall(q)}`; spec = { kind: 'mul', sf: mulSmall(q) }; }
      else { key = `d${mulSmall(q)}`; spec = { kind: 'div', sf: mulSmall(q) }; }
      if (!groups.has(key)) groups.set(key, { op, spec, times: [], errs: 0 });
      const g = groups.get(key);
      g.times.push(q[3]);
      g.errs += q[4] > 0 ? 1 : 0;
    }

    const archetypes = [];
    for (const g of groups.values()) {
      if (g.times.length < 6) continue;
      const ratio = median(g.times) / opMed[g.op];
      const errRate = g.errs / g.times.length;
      // slow-and-sloppy archetypes dominate; everything keeps a small floor
      const weight = 0.03 + Math.pow(Math.max(0.05, ratio - 0.75), 2) * (1 + 2 * errRate);
      archetypes.push({ op: g.op, spec: g.spec, weight, ratio });
    }

    // literal replays: questions you got wrong entries on or answered slowly
    const seen = new Set();
    const replays = [];
    for (let i = qs.length - 1; i >= 0 && replays.length < 200; i--) {
      const q = qs[i];
      if (q[4] === 0 && q[3] < 1.4 * opMed[q[0]]) continue;
      const k = `${q[0]},${q[1]},${q[2]}`;
      if (seen.has(k)) continue;
      seen.add(k);
      replays.push([q[0], q[1], q[2]]);
    }

    return archetypes.length
      ? { archetypes, replays, nQs: qs.length, addF: addFeatures, subF: subFeatures }
      : null;
  }

  function opForKey(k) {
    return k[0] === '+' ? 0 : k[0] === '−' ? 1 : k[0] === '×' ? 2 : 3;
  }

  /* ---- recent sessions table ---- */
  function sessionsTable(ss) {
    const recent = [...ss].sort((a, b) => b.ts - a.ts).slice(0, 12);
    const rows = recent.map(s => {
      const d = new Date(s.ts);
      const when = `${d.getDate()}/${d.getMonth() + 1} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      const med = s.qs.length ? median(s.qs.map(q => q[3])) : 0;
      const tag = s.mode === 'eighty'
        ? `<span class="mode-tag eighty">80in8</span>`
        : s.mode === 'target'
        ? `<span class="mode-tag target">target ${s.dur}s</span>`
        : `<span class="mode-tag">${s.dur}s</span>`;
      const score = s.mode === 'eighty' && s.hitTargetMs
        ? `80 ✓ ${(s.hitTargetMs / 60000).toFixed(1)}m`
        : s.score;
      return `<tr><td>${when}</td><td>${tag}</td><td><b>${score}</b></td><td>${paceOf(s).toFixed(1)}/m</td><td>${fmtS(med)}</td><td><button class="sess-del" data-sid="${s.id}" aria-label="delete session">×</button></td></tr>`;
    }).join('');
    return `<div class="stat-section"><h3>Recent sessions</h3>
      <table class="sess-table"><thead><tr><th>When</th><th>Mode</th><th>Score</th><th>Pace</th><th>Med q</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table>
      <div class="note">× removes a session and all its questions from every chart (e.g. one where you got interrupted).</div></div>`;
  }

  /* ---- data management ---- */
  function dataSection() {
    return `<div class="stat-section"><h3>Data</h3>
      <div class="data-buttons">
        <button id="btn-export">Export JSON</button>
        <button id="btn-import">Import</button>
        <button id="btn-wipe" class="danger">Delete all data</button>
      </div>
      <div class="note">Everything lives in this browser's storage — export occasionally as a backup (iOS can evict PWA storage if unused for weeks). App v${window.APP_VERSION || '?'}.</div></div>`;
  }

  function wireDataButtons() {
    document.querySelectorAll('.sess-del').forEach(b => {
      b.onclick = () => {
        if (confirm('Remove this session and its questions from all analytics?')) {
          Store.deleteSession(b.dataset.sid);
          render();
        }
      };
    });
    document.getElementById('btn-export').onclick = () => {
      const blob = new Blob([Store.exportData()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `arithmetic-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    document.getElementById('btn-import').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = 'application/json,.json';
      inp.onchange = () => {
        const f = inp.files[0];
        if (!f) return;
        const rd = new FileReader();
        rd.onload = () => {
          try {
            const added = Store.importData(rd.result);
            alert(`Imported ${added} new sessions.`);
            render();
          } catch (e) {
            alert('Import failed: ' + e.message);
          }
        };
        rd.readAsText(f);
      };
      inp.click();
    };
    document.getElementById('btn-wipe').onclick = () => {
      if (confirm('Delete ALL session history on this device? Export first if you want a backup.')) {
        Store.resetAll();
        render();
      }
    };
  }

  function setFilter(kind, value) {
    filters[kind] = value;
    render();
  }

  window.Analytics = { render, setFilter, buildTargetModel };
})();
