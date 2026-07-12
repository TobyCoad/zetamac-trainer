/* Progress tab — daily training quota, goals, streaks, and a calendar.
 * A "completed attempt" = a 120s sprint that ran the full clock
 * (early-quit sessions store a shorter dur, so they drop out naturally).
 * Goal philosophy: quant assessments reward showing up on demand, so the
 * goals are volume (attempts/day), a rolling average, and a consistency
 * floor — your WORST recent attempt matters as much as your best. */
(function () {
  let monthOffset = 0; // 0 = current month, -1 = previous, ...

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function completedSprints() {
    return Store.loadSessions()
      .filter(s => s.mode === 'sprint' && s.dur === 120)
      .sort((a, b) => a.ts - b.ts);
  }

  function byDay(sprints) {
    const m = new Map();
    for (const s of sprints) {
      const k = dayKey(s.ts);
      if (!m.has(k)) m.set(k, { count: 0, total: 0 });
      const d = m.get(k);
      d.count++;
      d.total += s.score;
    }
    return m;
  }

  function goals() {
    const s = App.getSettings();
    if (!s.goals) s.goals = { daily: 15, score: 50 };
    return s.goals;
  }

  function render() {
    const body = el('progress-body');
    const sprints = completedSprints();
    const days = byDay(sprints);
    const g = goals();

    body.innerHTML =
      heroCards(sprints, days, g) +
      goalsSection(sprints, g) +
      calendarSection(days, g) +
      dailyChartSection(sprints, days) +
      `<div class="stat-section"><div class="note">Only fully-completed 120s sprints count here — ended-early sessions and other modes don't. That's deliberate: assessments are 2 minutes, start to finish.</div></div>`;

    wire();
  }

  /* ---- hero: today / streak / 7-day form ---- */
  function heroCards(sprints, days, g) {
    const today = days.get(dayKey(Date.now())) || { count: 0, total: 0 };
    const todayAvg = today.count ? (today.total / today.count).toFixed(1) : '–';

    // streak of consecutive days hitting the volume goal, counting back
    // from today (today only counts once it's actually hit)
    let streak = 0;
    const dayMs = 86400e3;
    let cursor = Date.now();
    if ((days.get(dayKey(cursor)) || { count: 0 }).count < g.daily) cursor -= dayMs;
    while ((days.get(dayKey(cursor)) || { count: 0 }).count >= g.daily) {
      streak++;
      cursor -= dayMs;
    }

    const week = sprints.filter(s => s.ts > Date.now() - 7 * dayMs);
    const weekAvg = week.length ? (week.reduce((a, s) => a + s.score, 0) / week.length).toFixed(1) : '–';

    const frac = Math.min(1, today.count / g.daily);
    return `<div class="today-hero stat-section">
      <div class="today-top">
        <div><b class="today-count">${today.count}<span class="today-goal">/${g.daily}</span></b><small>completed today</small></div>
        <div class="today-right"><b>${todayAvg}</b><small>today's avg</small></div>
      </div>
      <div class="goal-bar big"><div style="width:${(frac * 100).toFixed(0)}%"></div></div>
    </div>
    <div class="cards-row">
      <div class="stat-card"><b>${streak}${streak >= 3 ? ' 🔥' : ''}</b><small>day streak at ${g.daily}/day</small></div>
      <div class="stat-card"><b>${weekAvg}</b><small>avg score, last 7 days (${week.length} attempts)</small></div>
    </div>`;
  }

  /* ---- goals with editable targets ---- */
  function goalsSection(sprints, g) {
    const last10 = sprints.slice(-10).map(s => s.score);
    const avg10 = last10.length ? last10.reduce((a, b) => a + b, 0) / last10.length : 0;
    const worst10 = last10.length ? Math.min(...last10) : 0;
    const floor = Math.round(g.score * 0.8);
    const today = (byDay(sprints).get(dayKey(Date.now())) || { count: 0 }).count;

    const row = (label, valText, frac, met) => `
      <div class="goal-row">
        <div class="goal-label">${label}<span class="goal-val ${met ? 'met' : ''}">${valText}${met ? ' ✓' : ''}</span></div>
        <div class="goal-bar"><div style="width:${(Math.min(1, frac) * 100).toFixed(0)}%"></div></div>
      </div>`;

    const enough = last10.length >= 10;
    const allMet = enough && today >= g.daily && avg10 >= g.score && worst10 >= floor;

    return `<div class="stat-section">
      <h3>Assessment readiness</h3>
      ${allMet ? '<div class="ready-banner">🎯 All goals met — assessment ready</div>' : ''}
      ${row(`Volume — ${g.daily} completed today`, `${today}/${g.daily}`, today / g.daily, today >= g.daily)}
      ${row(`Average — last 10 attempts ≥ ${g.score}`, enough ? avg10.toFixed(1) : `${last10.length}/10 attempts`, enough ? avg10 / g.score : last10.length / 10, enough && avg10 >= g.score)}
      ${row(`Consistency — worst of last 10 ≥ ${floor}`, enough ? String(worst10) : `${last10.length}/10 attempts`, enough ? worst10 / floor : last10.length / 10, enough && worst10 >= floor)}
      <div class="goal-edit">
        <label>Daily attempts <input type="number" id="goal-daily" min="1" max="50" value="${g.daily}"></label>
        <label>Target score <input type="number" id="goal-score" min="10" max="150" value="${g.score}"></label>
      </div>
      <div class="note">The consistency floor (80% of target) is the assessment-day metric: firms see one attempt, not your best of fifteen. Raise the target as the goals turn green.</div>
    </div>`;
  }

  /* ---- calendar ---- */
  function calendarSection(days, g) {
    const now = new Date();
    const view = new Date(now.getFullYear(), now.getMonth() + monthOffset, 1);
    const year = view.getFullYear(), month = view.getMonth();
    const monthName = view.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Monday-start
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const todayK = dayKey(Date.now());

    let cells = ['M', 'T', 'W', 'T', 'F', 'S', 'S'].map(d => `<div class="cal-head">${d}</div>`).join('');
    for (let i = 0; i < firstWeekday; i++) cells += '<div></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const k = `${year}-${month}-${d}`;
      const rec = days.get(k);
      const count = rec ? rec.count : 0;
      const avg = rec ? (rec.total / rec.count).toFixed(0) : '';
      const lvl = count === 0 ? 0 : count >= g.daily ? 4 : count >= g.daily * 0.66 ? 3 : count >= g.daily * 0.33 ? 2 : 1;
      const future = new Date(year, month, d) > now;
      cells += `<div class="cal-day lvl${lvl}${k === todayK ? ' cal-today' : ''}${future ? ' cal-future' : ''}">
        <span class="cal-num">${d}</span>
        ${count ? `<b>${count}</b><span class="cal-avg">${avg}</span>` : ''}
      </div>`;
    }

    return `<div class="stat-section">
      <div class="cal-nav">
        <button id="cal-prev">&#8249;</button>
        <h3>${esc(monthName)}</h3>
        <button id="cal-next" ${monthOffset >= 0 ? 'disabled' : ''}>&#8250;</button>
      </div>
      <div class="calendar">${cells}</div>
      <div class="note">Big number = completed attempts (greener = closer to ${g.daily}); small = that day's average score.</div>
    </div>`;
  }

  /* ---- daily average chart ---- */
  function dailyChartSection(sprints, days) {
    // one point per day with data, chronological
    const seen = new Set();
    const daily = [];
    for (const s of sprints) {
      const k = dayKey(s.ts);
      if (seen.has(k)) continue;
      seen.add(k);
      const rec = days.get(k);
      daily.push({ ts: s.ts, avg: rec.total / rec.count });
    }
    if (daily.length < 2) {
      return `<div class="stat-section"><h3>Daily average</h3>
        <div class="note">Complete 120s sprints on two different days and your trend appears here.</div></div>`;
    }
    const pts = daily.map((d, i) => [i, d.avg]);
    const roll = pts.map((p, i) => {
      const w = pts.slice(Math.max(0, i - 6), i + 1).map(q => q[1]);
      return [p[0], w.reduce((a, b) => a + b, 0) / w.length];
    });
    const g = goals();
    const goalLine = [[0, g.score], [pts.length - 1, g.score]];
    const svg = Charts.lineChart(
      [
        { pts, color: '#5b8cff' },
        { pts: roll, color: '#34d0a6', dashed: true },
        { pts: goalLine, color: '#ffb454', dashed: true },
      ],
      { yMin: 0, xLabelFn: x => { const d = new Date(daily[Math.round(x)] ? daily[Math.round(x)].ts : daily[daily.length - 1].ts); return `${d.getDate()}/${d.getMonth() + 1}`; }, yFmt: v => v.toFixed(0) }
    );
    return `<div class="stat-section"><h3>Daily average score — 120s sprints</h3>
      <div class="chart-wrap">${svg}</div>
      <div class="legend"><span><i style="background:#5b8cff"></i>daily avg</span><span><i style="background:#34d0a6"></i>7-day trend</span><span><i style="background:#ffb454"></i>target</span></div>
    </div>`;
  }

  /* ---- wiring ---- */
  function wire() {
    const prev = el('cal-prev'), next = el('cal-next');
    if (prev) prev.onclick = () => { monthOffset--; render(); };
    if (next) next.onclick = () => { if (monthOffset < 0) { monthOffset++; render(); } };

    const save = () => {
      const s = App.getSettings();
      const d = Math.max(1, Math.min(50, Math.round(Number(el('goal-daily').value) || 15)));
      const sc = Math.max(10, Math.min(150, Math.round(Number(el('goal-score').value) || 50)));
      s.goals = { daily: d, score: sc };
      Store.saveSettings(s);
      render();
    };
    el('goal-daily').onchange = save;
    el('goal-score').onchange = save;
  }

  window.Progress = { render };
})();
