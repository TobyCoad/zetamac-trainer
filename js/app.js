/* App shell — screen switching, settings UI, keyboard, SW registration. */
(function () {
  function el(id) { return document.getElementById(id); }
  const screens = ['home', 'game', 'results', 'progress', 'stats'];
  let settings = Store.loadSettings();

  /* Bump APP_VERSION together with version.json and the sw.js cache name. */
  const APP_VERSION = 16;
  window.APP_VERSION = APP_VERSION;

  function showScreen(name) {
    for (const s of screens) el(`screen-${s}`).classList.toggle('active', s === name);
    el('tabbar').classList.toggle('hidden', name === 'game');
    const tab = name === 'stats' ? 'stats' : name === 'progress' ? 'progress' : 'home';
    document.querySelectorAll('#tabbar button').forEach(b =>
      b.classList.toggle('on', b.dataset.tab === tab));
    if (name === 'stats') Analytics.render();
    if (name === 'progress') Progress.render();
    if (name === 'home') refreshBests();
    maybeShowUpdateBanner();
    window.scrollTo(0, 0);
  }

  /* ---- in-app updates: poll version.json (network-only), offer a reload ---- */
  let updateReady = false;

  function maybeShowUpdateBanner() {
    el('update-banner').hidden =
      !(updateReady && !el('screen-game').classList.contains('active'));
  }

  async function checkForUpdate() {
    try {
      const r = await fetch('./version.json', { cache: 'no-store' });
      const j = await r.json();
      if (j.v && j.v !== APP_VERSION) {
        updateReady = true;
        maybeShowUpdateBanner();
      }
    } catch (e) { /* offline — try again next foreground */ }
  }

  function applyUpdate() {
    const banner = el('update-banner');
    banner.textContent = 'Updating…';
    let done = false;
    const finish = () => { if (!done) { done = true; location.reload(); } };
    if (!('serviceWorker' in navigator)) return finish();
    navigator.serviceWorker.getRegistration().then(reg => {
      if (!reg) return finish();
      // a new sw.js re-downloads every asset into a fresh cache on install;
      // reload once it activates (or after a timeout as a fallback)
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        if (w) w.addEventListener('statechange', () => { if (w.state === 'activated') finish(); });
      });
      reg.update().catch(finish);
      setTimeout(finish, 8000);
    }).catch(finish);
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
      ? `${model.pool.length} hardest questions in the deck`
      : `needs ~40 answered questions (${ss.reduce((a, s) => a + s.qs.length, 0)} so far)`;

    const drills = ss.filter(s => s.mode === 'drill');
    el('drill-best').textContent = drills.length
      ? `${Math.round(drills.reduce((a, s) => a + s.dur, 0) / 60)} min drilled total`
      : '';

    const fracs = ss.filter(s => s.mode === 'frac' && s.dur === settings.dur);
    el('frac-best').textContent = fracs.length
      ? `best ${Math.max(...fracs.map(s => s.score))} at ${settings.dur}s`
      : '';
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
    frac0: ['frac', 0], frac1: ['frac', 1],
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
    el('btn-start-drill').addEventListener('click', () =>
      Game.start('drill', settings, Analytics.buildTargetModel())); // model optional — drill adapts live
    el('btn-start-frac').addEventListener('click', () => Game.start('frac', settings));

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
    // nearest-key hit testing: every touch registers the nearest key (up to
    // 24px past its edge), like the iOS keyboard. Key geometry is cached
    // OUTSIDE the hot path — recomputed on game start/resize/scroll, never
    // per tap — so the touchstart handler does zero layout work.
    let keyRects = [], bottomRow = [], padBounds = null;
    const computeKeyRects = () => {
      keyRects = [...keypad.querySelectorAll('button')].map(b => {
        const r = b.getBoundingClientRect();
        return { b, cx: r.left + r.width / 2, cy: r.top + r.height / 2, hw: r.width / 2, hh: r.height / 2 };
      });
      const maxCy = Math.max(...keyRects.map(k => k.cy));
      bottomRow = keyRects.filter(k => k.cy > maxCy - 5);
      padBounds = {
        left: Math.min(...keyRects.map(k => k.cx - k.hw)),
        right: Math.max(...keyRects.map(k => k.cx + k.hw)),
        bottom: maxCy,
      };
    };
    window.addEventListener('resize', computeKeyRects);
    window.addEventListener('scroll', computeKeyRects, { passive: true });
    window.addEventListener('orientationchange', () => setTimeout(computeKeyRects, 300));
    window.__computeKeyRects = computeKeyRects; // called by Game.start via App

    const keyAt = (x, y) => {
      let best = null, bestD = Infinity;
      for (const k of keyRects) {
        const dx = Math.max(Math.abs(x - k.cx) - k.hw, 0);
        const dy = Math.max(Math.abs(y - k.cy) - k.hh, 0);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = k.b; }
      }
      if (bestD <= 24 * 24) return best;
      // below the keypad there is nothing else to hit — a stretched thumb
      // contacts lower than aimed, so any touch under the bottom row (down to
      // the screen edge) snaps to the nearest bottom-row key by column
      if (padBounds && y > padBounds.bottom &&
          x > padBounds.left - 24 && x < padBounds.right + 24) {
        let bb = null, bd = Infinity;
        for (const k of bottomRow) {
          const d = Math.abs(x - k.cx);
          if (d < bd) { bd = d; bb = k.b; }
        }
        return bb;
      }
      return null;
    };

    // capture on the whole game screen: taps in the margins beside/below the
    // keypad element used to miss the listener entirely — another dead zone
    const gameScreen = el('screen-game');
    gameScreen.addEventListener('touchstart', e => {
      if (!el('quit-overlay').hidden) return; // pause menu needs its clicks
      if (!keyRects.length) computeKeyRects();
      let hit = false;
      for (const t of e.changedTouches) {
        const btn = keyAt(t.clientX, t.clientY);
        if (btn) { hit = true; pressKey(btn.dataset.k); flash(btn); }
        else if (padBounds && t.clientY > padBounds.bottom - 200) {
          // near-keypad touch that resolved to nothing — count it so the
          // stats page can show whether taps are still getting lost
          try {
            localStorage.setItem('zmt.missedTaps',
              String((Number(localStorage.getItem('zmt.missedTaps')) || 0) + 1));
          } catch (err) {}
        }
      }
      if (hit) e.preventDefault(); // quit-button taps (no key nearby) keep their click
    }, { passive: false });
    const touchDone = e => {
      const stillOnB = [...e.touches].some(t => {
        const btn = keyAt(t.clientX, t.clientY);
        return btn && btn.dataset.k === 'B';
      });
      if (!stillOnB) stopRepeat();
    };
    gameScreen.addEventListener('touchend', touchDone);
    gameScreen.addEventListener('touchcancel', touchDone);
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
      else if (last && last.mode === 'drill') Game.start('drill', settings, Analytics.buildTargetModel());
      else if (last && last.mode === 'frac') Game.start('frac', settings);
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
      showScreen(b.dataset.tab === 'home' ? 'home' : b.dataset.tab);
    });
  }

  /* ---- boot ---- */
  window.App = { showScreen, getSettings: () => settings };
  wireSettings();
  wireGame();
  wireStats();
  syncSettingsUI();
  showScreen('home');

  el('update-banner').addEventListener('click', applyUpdate);
  checkForUpdate();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForUpdate();
  });

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
})();
