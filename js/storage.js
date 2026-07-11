/* Storage layer — everything persists in localStorage on this device.
 * Session record (compact to keep localStorage small):
 * { id, ts, mode: 'sprint'|'eighty', dur, cfg, score, hitTargetMs|null,
 *   qs: [[op, x, y, ms, err], ...] }
 *   op: 0=add 1=sub 2=mul 3=div — x,y are the operands AS PRESENTED
 *   (sub: x-y, div: x/y), ms = time to answer, err = wrong-entry count.
 */
(function () {
  const KEY_SESSIONS = 'zmt.sessions.v1';
  const KEY_SETTINGS = 'zmt.settings.v1';

  const DEFAULT_SETTINGS = {
    dur: 120,
    ops: { add: true, sub: true, mul: true, div: true },
    addA: [2, 100], addB: [2, 100],
    mulA: [2, 12], mulB: [2, 100],
  };

  function loadSessions() {
    try {
      return JSON.parse(localStorage.getItem(KEY_SESSIONS)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveSessions(sessions) {
    localStorage.setItem(KEY_SESSIONS, JSON.stringify(sessions));
  }

  function addSession(session) {
    const sessions = loadSessions();
    sessions.push(session);
    try {
      saveSessions(sessions);
    } catch (e) {
      // localStorage full — drop per-question detail on the oldest third, keep scores
      for (let i = 0; i < Math.floor(sessions.length / 3); i++) sessions[i].qs = [];
      saveSessions(sessions);
    }
  }

  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY_SETTINGS));
      if (!s) return structuredClone(DEFAULT_SETTINGS);
      return Object.assign(structuredClone(DEFAULT_SETTINGS), s);
    } catch (e) {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(KEY_SETTINGS, JSON.stringify(settings));
  }

  function exportData() {
    return JSON.stringify({
      exported: new Date().toISOString(),
      settings: loadSettings(),
      sessions: loadSessions(),
    });
  }

  function importData(json) {
    const data = JSON.parse(json);
    if (!Array.isArray(data.sessions)) throw new Error('no sessions array');
    const existing = loadSessions();
    const seen = new Set(existing.map(s => s.id));
    let added = 0;
    for (const s of data.sessions) {
      if (!seen.has(s.id)) { existing.push(s); added++; }
    }
    existing.sort((a, b) => a.ts - b.ts);
    saveSessions(existing);
    return added;
  }

  function deleteSession(id) {
    saveSessions(loadSessions().filter(s => s.id !== id));
  }

  function resetAll() {
    localStorage.removeItem(KEY_SESSIONS);
  }

  window.Store = {
    DEFAULT_SETTINGS,
    loadSessions, addSession, deleteSession,
    loadSettings, saveSettings,
    exportData, importData, resetAll,
  };
})();
