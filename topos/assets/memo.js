/* The scratchpad saves text independently of manuscript rendering. */
function createMemoSync({storage, request, changed = () => {}}) {
  const key = 'topos-ag-final:memo:v1';
  let state = {text: '', revision: 0, dirty: false};
  let loaded = false, running = null, conflict = false, remote = null;
  let cacheOK = true;
  try {
    const cached = JSON.parse(storage.getItem(key) || 'null');
    if (cached && typeof cached.text === 'string' && Number.isInteger(cached.revision)) state = cached;
  } catch (_) { cacheOK = false; }
  function emit(message) { changed({...state, conflict, message, cacheOK}); }
  function cache() {
    try { storage.setItem(key, JSON.stringify(state)); cacheOK = true; }
    catch (_) { cacheOK = false; }
  }
  function edit(text) {
    state = {...state, text, dirty: true};
    cache();
    emit(cacheOK ? '入力を保存中…' : '保存中… この画面を閉じずに待って');
  }
  async function exchange() {
    try {
      if (!loaded) {
        const response = await request('/api/memo', {cache: 'no-store'});
        if (!response.ok) throw new Error('offline');
        remote = await response.json();
        loaded = true;
        if (!state.dirty) { state = {...remote, dirty: false}; cache(); }
        else if (state.text === remote.text) { state = {...remote, dirty: false}; cache(); }
        else if (state.revision !== remote.revision) { conflict = true; }
      }
      if (conflict) { emit('別の画面で変更あり。入力内容は保持している'); return; }
      while (state.dirty) {
        const sent = {text: state.text, revision: state.revision};
        const response = await request('/api/memo', {
          method: 'POST', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify(sent), keepalive: true
        });
        if (response.status === 409) {
          remote = await response.json(); conflict = true;
          emit('別の画面で変更あり。入力内容は保持している'); return;
        }
        if (!response.ok) throw new Error('offline');
        remote = await response.json();
        state = {...state, revision: remote.revision, dirty: state.text !== sent.text};
        cache();
      }
      emit('保存済み');
    } catch (_) {
      loaded = false;
      emit(state.dirty ? (cacheOK ? 'このブラウザーに保存済み。接続後に再保存' : '未保存。接続を確認して再保存') : 'サーバーに接続できない');
    }
  }
  function sync() {
    if (running) return running;
    running = exchange().finally(() => { running = null; });
    return running;
  }
  function overwrite() {
    if (conflict && remote) { state.revision = remote.revision; conflict = false; cache(); }
    return sync();
  }
  function refresh() { if (!running) loaded = false; return sync(); }
  return {edit, sync, overwrite, refresh, snapshot: () => ({...state, conflict})};
}

if (typeof module !== 'undefined') module.exports = {createMemoSync};
if (typeof document !== 'undefined') (() => {
  const edge = document.getElementById('memo-open');
  const panel = document.getElementById('memo-panel');
  if (!edge || !panel) return;
  const input = document.getElementById('memo-text');
  const status = document.getElementById('memo-status');
  const retry = document.getElementById('memo-retry');
  const close = document.getElementById('memo-close');
  let saveTimer, closeTimer, composing = false, pinned = false;
  const sync = createMemoSync({
    storage: {getItem: k => localStorage.getItem(k), setItem: (k, v) => localStorage.setItem(k, v)},
    request: (...args) => fetch(...args),
    changed: state => {
      if (input.value !== state.text) input.value = state.text;
      status.textContent = state.message;
      retry.hidden = !state.dirty && !state.conflict;
      retry.textContent = state.conflict ? 'この内容で上書き保存' : '再保存';
    }
  });
  input.value = sync.snapshot().text;
  function open(focus = false) {
    clearTimeout(closeTimer);
    panel.inert = false;
    panel.classList.add('is-open');
    edge.setAttribute('aria-expanded', 'true');
    void sync.refresh();
    if (focus) { pinned = true; input.focus(); }
  }
  function hide(restoreFocus = false) {
    clearTimeout(closeTimer);
    pinned = false;
    if (panel.contains(document.activeElement)) document.activeElement.blur();
    panel.inert = true;
    panel.classList.remove('is-open');
    edge.setAttribute('aria-expanded', 'false');
    if (restoreFocus) edge.focus();
    void sync.sync();
  }
  function leave() {
    clearTimeout(closeTimer);
    if (!pinned && !panel.contains(document.activeElement)) closeTimer = setTimeout(() => hide(), 220);
  }
  edge.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') open(); });
  edge.addEventListener('pointerleave', leave);
  edge.addEventListener('click', () => open(true));
  panel.addEventListener('pointerenter', () => clearTimeout(closeTimer));
  panel.addEventListener('pointerleave', leave);
  panel.addEventListener('focusin', () => clearTimeout(closeTimer));
  panel.addEventListener('focusout', leave);
  close.addEventListener('click', () => hide(true));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !event.isComposing && panel.classList.contains('is-open')) {
      hide(panel.contains(document.activeElement));
    }
  });
  function schedule() {
    clearTimeout(saveTimer);
    if (!composing) saveTimer = setTimeout(() => { void sync.sync(); }, 250);
  }
  input.addEventListener('input', () => { sync.edit(input.value); schedule(); });
  input.addEventListener('compositionstart', () => { composing = true; clearTimeout(saveTimer); });
  input.addEventListener('compositionend', () => { composing = false; sync.edit(input.value); schedule(); });
  input.addEventListener('blur', () => { clearTimeout(saveTimer); void sync.sync(); });
  retry.addEventListener('click', () => { void sync.overwrite(); });
  addEventListener('online', () => { void sync.refresh(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void sync.sync(); });
  void sync.sync();
})();
