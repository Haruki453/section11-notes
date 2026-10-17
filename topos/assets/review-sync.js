(function (root) {
  function createReviewSync({storage, request, changed = () => {}}) {
    const prefix = 'topos-ag-final:reviewed:v1:';
    const pendingKey = 'topos-ag-final:review-pending:v1';
    const migratedKey = 'topos-ag-final:review-store:v1';
    const validId = id => /^[a-z][a-z0-9-]{0,127}$/.test(id);
    const read = key => { try { return storage.getItem(key); } catch (_) { return null; } };
    const write = (key, value) => {
      try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch (_) {}
    };
    function readChecks() {
      const checks = {};
      try {
        for (let i = 0; i < storage.length; i++) {
          const key = storage.key(i);
          if (key.startsWith(prefix) && validId(key.slice(prefix.length)) && read(key) === '1') checks[key.slice(prefix.length)] = true;
        }
      } catch (_) {}
      return checks;
    }
    function readPending() {
      const result = {};
      try {
        const saved = JSON.parse(read(pendingKey) || '{}');
        for (const [id, value] of Object.entries(saved)) if (validId(id) && typeof value === 'boolean') result[id] = value;
      } catch (_) {}
      return result;
    }
    const legacy = readChecks();
    let pending = readPending();
    let values = {...legacy, ...pending};
    let online = false;
    let localOnly = false;
    let running = null;
    let storeId = null;
    let revision = -1;
    const notify = () => changed({online, localOnly, pending: Object.keys(pending).length});
    function cache() {
      for (const [id, checked] of Object.entries(values)) write(prefix + id, checked ? '1' : null);
      write(pendingKey, JSON.stringify(pending));
    }
    function apply(data) {
      if (data.storeId !== storeId || data.revision >= revision) {
        storeId = data.storeId;
        revision = data.revision;
        // Include false values for old cached IDs that the server no longer has.
        values = {...Object.fromEntries(Object.keys(values).map(id => [id, false])), ...data.states, ...pending};
        cache();
      }
    }
    async function exchange(payload) {
      const response = await request('/api/reviews', {
        cache: 'no-store',
        ...(payload ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)} : {})
      });
      if (response.status === 404) localOnly = true;
      if (!response.ok) throw new Error('Review sync unavailable');
      const data = await response.json();
      if (typeof data.storeId !== 'string' || !Number.isInteger(data.revision) || !data.states || typeof data.states !== 'object'
          || !Object.entries(data.states).every(([id, value]) => validId(id) && typeof value === 'boolean')) throw new Error('Invalid review state');
      return data;
    }
    function sync() {
      if (localOnly) {
        pending = readPending();
        values = {...Object.fromEntries(Object.keys(values).map(id => [id, false])), ...readChecks(), ...pending};
        notify();
        return Promise.resolve();
      }
      if (running) return running;
      running = (async () => {
        let succeeded = false;
        try {
          let data = await exchange();
          if (read(migratedKey) !== data.storeId) {
            data = await exchange({import: Object.keys(legacy)});
            write(migratedKey, data.storeId);
          }
          const changes = {...pending};
          if (Object.keys(changes).length) {
            data = await exchange({changes});
            for (const [id, value] of Object.entries(changes)) if (pending[id] === value) delete pending[id];
          }
          apply(data);
          online = true;
          succeeded = true;
        } catch (_) {
          online = false;
        } finally {
          running = null;
          notify();
          // A click during the request must also be sent, in order.
          if (succeeded && Object.keys(pending).length) void sync();
        }
      })();
      return running;
    }
    function set(id, checked) {
      if (!validId(id) || typeof checked !== 'boolean') throw new Error('Invalid review update');
      values[id] = checked;
      pending[id] = checked;
      cache();
      notify();
      return sync();
    }
    return {checked: id => values[id] === true, set, sync};
  }
  function bindReviewIndicators(document, checked) {
    const indicators = [...document.querySelectorAll('.correspondence-grid tr[data-review-ids], a[data-review-page][data-review-ids]')].map(element => {
      const badge = document.createElement('span');
      badge.className = 'correspondence-review';
      badge.textContent = '✓ 確認済み';
      badge.title = 'リンク先ページのすべての定義・定理などを確認済み';
      badge.hidden = true;
      const link = element.matches('a') ? element : element.querySelector('td > a');
      link.append(badge);
      return {element, badge, ids: element.dataset.reviewIds.split(/\s+/).filter(Boolean)};
    });
    return () => indicators.forEach(({element, badge, ids}) => {
      const complete = ids.length > 0 && ids.every(checked);
      badge.hidden = !complete;
      element.classList.toggle('is-reviewed', complete);
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {createReviewSync, bindReviewIndicators};
  else {
    root.createReviewSync = createReviewSync;
    root.bindReviewIndicators = bindReviewIndicators;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
