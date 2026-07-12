/* App shell — screen switching, settings UI, keyboard, SW registration. */
(function () {
  function el(id) { return document.getElementById(id); }
  const screens = ['home', 'game', 'results', 'stats'];
  let settings = Store.loadSettings();

  function showScreen(name) {
    for (const s of screens) el(`screen-${s}`).classList.toggle('active', s === name);
    el('tabbar').classList.toggle('hidden', name === 'game');
    document.querySelectorAll('#tabbar button').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === (name === 'stats' ? 'stats' : 'home')));
    if (name === 'stats') Analytics.render();
    if (name === 'home') refreshBests();
    window.scrollTo(0, 0);
  }

  function refreshBests() {
    const ss = Store.loadSessions();
    const sprint = ss.filter(s => s.mode === 'sprint' && s.dur === settings.dur);
    el('sprint-best').textContent = sprint.length ? `best ${Math.max(...sprint.map(s => s.score))}` : '';
    el('sprint-desc').textContent = `${settings.dur}s · configurable below`;
    const done = ss.filter(s => s.mode === 'eighty' && s.hitTargetMs);
    const tried = ss.filter(s => s.mode === 'eighty');
    el('eighty-best').textContent = done.length
      ? `best ${(Math.min(...done.map(s => s.hitTargetMs)) / 60000).toFixed(1)} min ✓`
      : tried.length ? `best ${Math.max(...tried.map(s => s.score))}/80` : '';

    const model = Analytics.buildTargetModel();
    el('btn-start-target').classList.toggle('disabled', !model);
    el('target-best').textContent = model
      ? `${model.archetypes.length} archetypes · ${model.replays.length} replays queued`
      : `needs ~40 answered questions (${ss.reduce((a, s) => a + s.qs.length, 0)} so far)`;
  }

  /* ---- settings UI ---- */
  function syncSettingsUI() {
    document.querySelectorAll('#seg-duration button').forEach(b =>
      b.classList.toggle('on', Number(b.dataset.dur) === settings.dur));
    document.querySelectorAll('#seg-ops button').forEach(b =>
      b.classList.toggle('on', !!settings.ops[b.dataset.op]));
    for (const [id, path] of Object.entries(RANGE_IDS)) {
      el(id).value = settings[path[0]][path[1]];
    }
    refreshBests();
  }

  const RANGE_IDS = {
    addA0: ['addA', 0], addA1: ['addA', 1], addB0: ['addB', 0], addB1: ['addB', 1],
    mulA0: ['mulA', 0], mulA1: ['mulA', 1], mulB0: ['mulB', 0], mulB1: ['mulB', 1],
  };

  function wireSettings() {
    el('seg-duration').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      settings.dur = Number(b.dataset.dur);
      Store.saveSettings(settings);
      syncSettingsUI();
    });
    el('seg-ops').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const op = b.dataset.op;
      const next = !settings.ops[op];
      if (!next && Object.values(settings.ops).filter(Boolean).length === 1) return; // keep ≥1
      settings.ops[op] = next;
      Store.saveSettings(settings);
      syncSettingsUI();
    });
    for (const [id, path] of Object.entries(RANGE_IDS)) {
      el(id).addEventListener('change', () => {
        const v = Math.max(0, Math.min(999, Math.round(Number(el(id).value) || 0)));
        settings[path[0]][path[1]] = v;
        Store.saveSettings(settings);
        el(id).value = v;
      });
    }
    el('btn-reset-defaults').addEventListener('click', () => {
      settings = structuredClone(Store.DEFAULT_SETTINGS);
      Store.saveSettings(settings);
      syncSettingsUI();
    });
  }

  /* ---- game wiring ---- */
  function wireGame() {
    el('btn-start-sprint').addEventListener('click', () => Game.start('sprint', settings));
    el('btn-start-eighty').addEventListener('click', () => Game.start('eighty', settings));
    el('btn-start-target').addEventListener('click', () => startTarget());

    // quit button = pause menu (resume / save / discard), never an instant kill
    el('btn-quit').addEventListener('click', () => {
      Game.pause();
      el('quit-overlay').hidden = false;
    });
    el('btn-resume').addEventListener('click', () => {
      el('quit-overlay').hidden = true;
      Game.resume();
    });
    el('btn-save-quit').addEventListener('click', () => {
      el('quit-overlay').hidden = true;
      Game.finishEarly();
    });
    el('btn-discard').addEventListener('click', () => {
      el('quit-overlay').hidden = true;
      Game.quit();
    });

    // keypad: raw touch events, one Game.key per touch point — two fingers
    // landing together (digit + backspace) both register, and touch-action:
    // none stops iOS from eating them as pinch/pan gestures. Backspace
    // auto-repeats while held.
    const keypad = el('keypad');
    let repeatDelay = null, repeatTick = null;
    const stopRepeat = () => {
      clearTimeout(repeatDelay); clearInterval(repeatTick);
      repeatDelay = repeatTick = null;
    };
    const pressKey = k => {
      Game.key(k);
      if (k === 'B') {
        stopRepeat();
        repeatDelay = setTimeout(() => {
          repeatTick = setInterval(() => Game.key('B'), 90);
        }, 350);
      }
    };
    const flash = b => {
      b.classList.add('pressed');
      setTimeout(() => b.classList.remove('pressed'), 90);
    };
    keypad.addEventListener('touchstart', e => {
      e.preventDefault();
      for (const t of e.changedTouches) {
        const b = document.elementFromPoint(t.clientX, t.clientY);
        const btn = b && b.closest('#keypad button');
        if (btn) { pressKey(btn.dataset.k); flash(btn); }
      }
    }, { passive: false });
    const touchDone = e => {
      const stillOnB = [...e.touches].some(t => {
        const b = document.elementFromPoint(t.clientX, t.clientY);
        const btn = b && b.closest('#keypad button');
        return btn && btn.dataset.k === 'B';
      });
      if (!stillOnB) stopRepeat();
    };
    keypad.addEventListener('touchend', touchDone);
    keypad.addEventListener('touchcancel', touchDone);
    // mouse/pen (desktop) — touch is fully handled above
    keypad.addEventListener('pointerdown', e => {
      if (e.pointerType === 'touch') return;
      const btn = e.target.closest('button');
      if (!btn) return;
      e.preventDefault();
      pressKey(btn.dataset.k);
      flash(btn);
    });
    keypad.addEventListener('pointerup', e => { if (e.pointerType !== 'touch') stopRepeat(); });
    keypad.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') stopRepeat(); });

    // hardware keyboard (desktop practice)
    document.addEventListener('keydown', e => {
      if (!el('screen-game').classList.contains('active')) return;
      if (e.key >= '0' && e.key <= '9') Game.key(e.key);
      else if (e.key === 'Backspace') Game.key('B');
      else if (e.key === 'Escape') { Game.pause(); el('quit-overlay').hidden = false; }
    });

    el('btn-again').addEventListener('click', () => {
      const last = Store.loadSessions().slice(-1)[0];
      if (last && last.mode === 'target') startTarget();
      else Game.start(last && last.mode === 'eighty' ? 'eighty' : 'sprint', settings);
    });
    el('btn-results-stats').addEventListener('click', () => showScreen('stats'));
    el('btn-results-home').addEventListener('click', () => showScreen('home'));
  }

  function startTarget() {
    const model = Analytics.buildTargetModel();
    if (!model) {
      alert('Targeted practice needs ~40 answered questions of history first — play a sprint or two.');
      return;
    }
    Game.start('target', settings, model);
  }

  /* ---- stats filters + tabs ---- */
  function wireStats() {
    el('seg-stat-mode').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      document.querySelectorAll('#seg-stat-mode button').forEach(x => x.classList.toggle('on', x === b));
      Analytics.setFilter('mode', b.dataset.m);
    });
    el('seg-stat-window').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      document.querySelectorAll('#seg-stat-window button').forEach(x => x.classList.toggle('on', x === b));
      Analytics.setFilter('window', b.dataset.w);
    });
    el('tabbar').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      showScreen(b.dataset.tab === 'stats' ? 'stats' : 'home');
    });
  }

  /* ---- boot ---- */
  window.App = { showScreen };
  wireSettings();
  wireGame();
  wireStats();
  syncSettingsUI();
  showScreen('home');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
