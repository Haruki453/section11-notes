/* A durable, serial outbox: keystrokes during a request remain pending. */
(function (root) {
  function createCommentAutosave({storage, send, changed = () => {}, delay = 600}) {
    const key = 'topos-ag-final:comment-outbox:v1';
    let entries = {}, running = null, timer;
    try { entries = JSON.parse(storage.getItem(key) || '{}'); } catch (_) {}
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) entries = {};
    for (const [id, e] of Object.entries(entries)) {
      if (!e || e.id !== id || !e.anchor || typeof e.text !== 'string') delete entries[id];
      else {
        e.saving = false;
        e.category ||= 'unclassified'; e.savedCategory ||= 'unclassified';
      }
    }
    const dirty = e => e.created ? e.text.trim() !== e.savedText || e.category !== e.savedCategory : !!e.text.trim();
    function persist() {
      const pending = Object.fromEntries(Object.entries(entries).filter(([, e]) => dirty(e) || e.creation || e.update || e.deleting));
      try { storage.setItem(key, JSON.stringify(pending)); } catch (_) {}
    }
    function notify() { persist(); changed(); }
    function schedule() { clearTimeout(timer); timer = setTimeout(flush, delay); }
    function edit(id, anchor, text, remote, category) {
      if (entries[id]?.deleting) return;
      const e = entries[id] ||= {id, anchor, text: '', created: !!remote,
        savedText: remote?.text || '', textRevision: remote?.textRevision || 0,
        category: remote?.category || 'unclassified', savedCategory: remote?.category || 'unclassified'};
      if (category !== undefined) e.category = category;
      e.text = text; e.error = ''; notify(); schedule();
    }
    function get(id) { return entries[id]; }
    function adopt(remote) {
      const e = entries[remote.id];
      if (e && (dirty(e) || e.creation || e.update || e.saving || e.deleting)) return;
      entries[remote.id] = {id: remote.id, anchor: remote.anchor, text: remote.text,
        created: true, savedText: remote.text, textRevision: remote.textRevision || 0,
        category: remote.category || 'unclassified', savedCategory: remote.category || 'unclassified',
        number: remote.number};
      notify();
    }
    function flush() {
      clearTimeout(timer);
      if (running) return running;
      running = (async () => {
        for (const e of Object.values(entries)) {
          if (e.conflict && !e.deleting) continue;
          while (dirty(e) || e.creation || e.update || e.deleting) {
            let payload;
            if (e.deleting) {
              payload = {action: 'delete', id: e.id};
            } else if (!e.created) {
              // Keep this payload unchanged until its response arrives, including retries.
              payload = e.creation ||= {action: 'create', id: e.id, anchor: e.anchor, text: e.text.trim(), category: e.category};
            } else {
              payload = e.update ||= {action: 'edit', id: e.id, text: e.text.trim(), category: e.category, expectedRevision: e.textRevision};
            }
            e.saving = true; e.error = ''; notify();
            try {
              const data = await send(payload);
              if (payload.action === 'delete') {
                delete entries[e.id];
                break;
              }
              const saved = data.comments.find(c => c.id === e.id);
              if (!saved) throw new Error('Missing saved comment');
              e.created = true; e.savedText = saved.text; e.textRevision = saved.textRevision || 0;
              e.savedCategory = saved.category || 'unclassified';
              e.number = saved.number; delete e.creation; delete e.update;
            } catch (error) {
              e.error = payload.action === 'delete' ? '削除できない · 接続後に再送する'
                : error.conflict ? '別の場所で編集されたため未保存. 最新の内容を確認して.' : '未保存 · 接続後に再送する';
              e.conflict = !!error.conflict;
              break;
            } finally { e.saving = false; notify(); }
          }
        }
      })().finally(() => {
        running = null;
        if (Object.values(entries).some(e => (dirty(e) || e.deleting) && !e.error && !e.conflict)) schedule();
      });
      return running;
    }
    function useLatest(id, remote) {
      const e = entries[id]; if (!e || !remote) return;
      e.created = true; e.savedText = remote.text; e.textRevision = remote.textRevision || 0;
      e.savedCategory = remote.category || 'unclassified';
      delete e.update;
      e.conflict = false; e.error = ''; notify(); schedule();
    }
    function remove(id) {
      const e = entries[id];
      if (!e) return Promise.resolve();
      e.deleting = true; e.conflict = false; e.error = ''; notify();
      // If a create/edit is in flight, finish it and then send the deletion.
      return flush().then(() => {
        if (entries[id]?.deleting && !entries[id].error) return flush();
      });
    }
    function state(id) {
      const e = entries[id];
      return !e ? '' : e.error || (e.saving ? (e.deleting ? '削除中…' : '保存中…') : e.deleting ? '削除待ち…' : dirty(e) ? '保存待ち…' : e.created ? '保存済み' : '');
    }
    return {edit, get, adopt, flush, useLatest, remove, state, pending: () => Object.values(entries).filter(e => dirty(e) || e.creation || e.update || e.deleting)};
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createCommentAutosave};
  else root.createCommentAutosave = createCommentAutosave;
})(typeof globalThis !== 'undefined' ? globalThis : this);
