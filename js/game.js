/* Game engine — zetamac mechanics: answer auto-accepts the instant the typed
 * value equals the answer (no submit). Subtraction/division are inverses of
 * addition/multiplication so answers are always small non-negative integers. */
(function () {
  const OP = { add: 0, sub: 1, mul: 2, div: 3 };
  const OP_SYM = ['+', '−', '×', '÷'];

  const EIGHTY_TARGET = 80;
  const EIGHTY_DUR = 480;

  let state = null; // active game

  function randInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

  function normRange(r, fallback) {
    let [a, b] = [Number(r[0]), Number(r[1])];
    if (!Number.isFinite(a) || !Number.isFinite(b)) return fallback.slice();
    a = Math.max(0, Math.min(999, Math.round(a)));
    b = Math.max(0, Math.min(999, Math.round(b)));
    return a <= b ? [a, b] : [b, a];
  }

  function makeQuestion(cfg) {
    const ops = ['add', 'sub', 'mul', 'div'].filter(o => cfg.ops[o]);
    const op = OP[ops[randInt(0, ops.length - 1)]];
    let x, y, answer;
    if (op === OP.add || op === OP.sub) {
      const a = randInt(cfg.addA[0], cfg.addA[1]);
      const b = randInt(cfg.addB[0], cfg.addB[1]);
      if (op === OP.add) { x = a; y = b; answer = a + b; }
      else { x = a + b; y = a; answer = b; } // (a+b) - a = b
    } else {
      const a = randInt(cfg.mulA[0], cfg.mulA[1]);
      const b = randInt(cfg.mulB[0], cfg.mulB[1]);
      if (op === OP.mul) { x = a; y = b; answer = a * b; }
      else { x = a * b; y = a || 1; answer = y === 0 ? 0 : x / y; } // guard a=0
    }
    // division by zero guard: if a can be 0 in mul range, re-roll divisor
    if (op === OP.div && y === 0) return makeQuestion(cfg);
    return { op, x, y, answer };
  }

  /* Targeted mode: ~45% literal replays of past slow/fumbled questions,
   * the rest generated to match weak archetypes (sampled by weight). */
  function makeTargetQuestion(cfg, model, prev) {
    const enabled = op => cfg.ops[['add', 'sub', 'mul', 'div'][op]];
    for (let attempt = 0; attempt < 2; attempt++) {
      const q = pickTargetQuestion(cfg, model, enabled);
      if (!prev || q.x !== prev.x || q.y !== prev.y || q.op !== prev.op) return q;
    }
    return makeQuestion(cfg); // couldn't avoid a repeat — plain random
  }

  function pickTargetQuestion(cfg, model, enabled) {
    const replays = model.replays.filter(r => enabled(r[0]));
    if (replays.length >= 10 && Math.random() < 0.45) {
      const [op, x, y] = replays[randInt(0, replays.length - 1)];
      const answer = op === OP.add ? x + y : op === OP.sub ? x - y : op === OP.mul ? x * y : x / y;
      return { op, x, y, answer };
    }
    const cands = model.archetypes.filter(a =>
      enabled(a.op) &&
      (a.spec.sf === undefined || (a.spec.sf >= cfg.mulA[0] && a.spec.sf <= cfg.mulA[1])));
    if (!cands.length) return makeQuestion(cfg);
    let r = Math.random() * cands.reduce((s, a) => s + a.weight, 0);
    let arch = cands[cands.length - 1];
    for (const a of cands) { r -= a.weight; if (r <= 0) { arch = a; break; } }

    for (let i = 0; i < 40; i++) {
      const q = genForSpec(cfg, arch.spec, model);
      if (q) return q;
    }
    return makeQuestion(cfg);
  }

  function genForSpec(cfg, spec, model) {
    if (spec.kind === 'add' || spec.kind === 'sub') {
      const a = randInt(cfg.addA[0], cfg.addA[1]);
      const b = randInt(cfg.addB[0], cfg.addB[1]);
      if (spec.kind === 'add') {
        const f = model.addF(a, b);
        return f.carry === spec.carry && f.size === spec.size
          ? { op: OP.add, x: a, y: b, answer: a + b } : null;
      }
      const x = a + b, y = a;
      const f = model.subF(x, y);
      return f.carry === spec.carry && f.size === spec.size
        ? { op: OP.sub, x, y, answer: b } : null;
    }
    const sf = spec.sf, b = randInt(cfg.mulB[0], cfg.mulB[1]);
    if (spec.kind === 'mul') return { op: OP.mul, x: sf, y: b, answer: sf * b };
    return sf === 0 ? null : { op: OP.div, x: sf * b, y: sf, answer: b };
  }

  function el(id) { return document.getElementById(id); }

  function fmtTime(s) {
    const m = Math.floor(s / 60), r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  function start(mode, settings, model) {
    const cfg = mode === 'eighty'
      ? {
          ops: { add: true, sub: true, mul: true, div: true },
          addA: [2, 100], addB: [2, 100], mulA: [2, 12], mulB: [2, 100],
        }
      : {
          ops: Object.assign({}, settings.ops),
          addA: normRange(settings.addA, [2, 100]),
          addB: normRange(settings.addB, [2, 100]),
          mulA: normRange(settings.mulA, [2, 12]),
          mulB: normRange(settings.mulB, [2, 100]),
        };
    if (!Object.values(cfg.ops).some(Boolean)) cfg.ops.add = true;

    const dur = mode === 'eighty' ? EIGHTY_DUR : settings.dur;
    state = {
      mode, cfg, dur,
      model: mode === 'target' ? model : null,
      paused: false,
      score: 0,
      qs: [],
      q: null,
      input: '',
      qStart: 0,
      qErr: 0,
      wasWrong: false,
      startedAt: Date.now(),
      endsAt: Date.now() + dur * 1000,
      hitTargetMs: null,
      timerId: null,
      done: false,
    };

    el('game-score').textContent = '0';
    el('game-score-label').textContent = mode === 'eighty' ? `of ${EIGHTY_TARGET}` : 'score';
    el('eighty-progress').hidden = mode !== 'eighty';
    el('eighty-fill').style.width = '0%';
    el('game-timer').textContent = fmtTime(dur);
    el('quit-overlay').hidden = true;

    App.showScreen('game');
    nextQuestion();
    state.timerId = setInterval(tick, 200);
  }

  function tick() {
    if (!state || state.done) return;
    const left = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
    el('game-timer').textContent = fmtTime(left);
    if (Date.now() >= state.endsAt) finish(false);
  }

  function nextQuestion() {
    state.q = state.model
      ? makeTargetQuestion(state.cfg, state.model, state.q)
      : makeQuestion(state.cfg);
    state.input = '';
    state.qErr = 0;
    state.wasWrong = false;
    state.qStart = performance.now();
    render();
  }

  function render() {
    const q = state.q;
    el('question').textContent = `${q.x} ${OP_SYM[q.op]} ${q.y} =`;
    const box = el('answer-box');
    box.textContent = state.input || ' ';
    // no wrong-input styling: the box gives zero feedback on whether the
    // digits typed so far are correct (wasWrong is still tracked for stats)
  }

  function key(k) {
    if (!state || state.done || state.paused) return;
    if (k === 'B') {
      state.input = state.input.slice(0, -1);
    } else if (k === 'C') {
      state.input = '';
    } else {
      if (state.input.length >= 6) return;
      state.input += k;
    }
    const ansStr = String(state.q.answer);
    if (state.input === ansStr) {
      correct();
      return;
    }
    // wrong entry: current text is no longer a prefix of the answer
    if (state.input.length > 0 && !ansStr.startsWith(state.input)) {
      if (!state.wasWrong) state.qErr++;
      state.wasWrong = true;
    } else {
      state.wasWrong = false;
    }
    render();
  }

  function correct() {
    const ms = Math.round(performance.now() - state.qStart);
    state.qs.push([state.q.op, state.q.x, state.q.y, ms, state.qErr]);
    state.score++;
    el('game-score').textContent = String(state.score);
    if (state.mode === 'eighty') {
      el('eighty-fill').style.width = `${Math.min(100, (state.score / EIGHTY_TARGET) * 100)}%`;
      if (state.score >= EIGHTY_TARGET && state.hitTargetMs === null) {
        state.hitTargetMs = Date.now() - state.startedAt;
        finish(true);
        return;
      }
    }
    nextQuestion();
  }

  function pause() {
    if (!state || state.done || state.paused) return;
    state.paused = true;
    state.pausedAt = Date.now();
    clearInterval(state.timerId);
  }

  function resume() {
    if (!state || state.done || !state.paused) return;
    const d = Date.now() - state.pausedAt;
    state.endsAt += d;
    state.qStart += d;
    state.paused = false;
    state.timerId = setInterval(tick, 200);
    tick();
  }

  function finishEarly() {
    if (!state || state.done) return;
    state.paused = false;
    finish(false);
  }

  function finish(hitTarget) {
    if (state.done) return;
    state.done = true;
    clearInterval(state.timerId);

    // active seconds actually played — full duration on a natural finish,
    // less if ended early via the pause menu (keeps pace stats honest)
    const remaining = Math.max(0, Math.ceil((state.endsAt - Date.now()) / 1000));
    const playedDur = Math.max(1, state.dur - remaining);

    const session = {
      id: `${state.startedAt.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      ts: state.startedAt,
      mode: state.mode,
      dur: playedDur,
      cfg: state.cfg,
      score: state.score,
      hitTargetMs: state.hitTargetMs,
      qs: state.qs,
    };
    if (state.score > 0) Store.addSession(session);
    showResults(session, hitTarget);
    state = null;
  }

  function quit() {
    if (!state) return;
    clearInterval(state.timerId);
    state.done = true;
    state = null;
    App.showScreen('home');
  }

  function showResults(s, hitTarget) {
    const n = s.qs.length;
    const times = s.qs.map(q => q[3]);
    const med = n ? median(times) : 0;
    const errs = s.qs.reduce((a, q) => a + q[4], 0);
    const elapsedS = s.hitTargetMs !== null ? s.hitTargetMs / 1000 : s.dur;
    const pace = elapsedS > 0 ? (n / (elapsedS / 60)) : 0;

    el('results-title').textContent =
      hitTarget ? `\u{1F3AF} 80 in ${fmtTime(Math.round(elapsedS))}!` :
      s.mode === 'eighty' ? 'Time — 80 in 8' : 'Time!';
    el('results-score').textContent = String(s.score);
    el('results-sub').textContent =
      s.mode === 'eighty'
        ? (hitTarget ? `finished with ${fmtTime(Math.round(s.dur - elapsedS))} to spare` : `of ${EIGHTY_TARGET} target`)
        : `${s.dur}s sprint`;

    const perOp = [0, 1, 2, 3].map(op => s.qs.filter(q => q[0] === op).length);
    el('results-grid').innerHTML = `
      <div class="rcell"><b>${pace.toFixed(1)}</b><small>answers / min</small></div>
      <div class="rcell"><b>${(med / 1000).toFixed(2)}s</b><small>median per question</small></div>
      <div class="rcell"><b>${errs}</b><small>wrong entries</small></div>
      <div class="rcell"><b>${perOp.map((c, i) => `${OP_SYM[i]}${c}`).join(' ')}</b><small>mix</small></div>`;

    App.showScreen('results');
  }

  function median(arr) {
    const a = [...arr].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  window.Game = { start, key, quit, pause, resume, finishEarly, OP_SYM, EIGHTY_TARGET };
})();
