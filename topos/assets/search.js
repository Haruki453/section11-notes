(() => {
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase().trim();
  function search(entries, query, mode) {
    const q = normalize(query);
    if (!q) return [];
    const number = q.replace(/^(?:定理|定義|命題|補題|系|公理|例|注意|記法)\s*/, '').replace(/\s+/g, '');
    if (mode === 'number' || /^\d+\.\d+$/.test(number)) {
      if (!/^\d+\.\d+$/.test(number)) return [];
      return entries.filter(item => normalize(item.number) === number);
    }
    const words = q.split(/\s+/);
    return entries.filter(item => words.every(word => normalize(item.title + ' ' + item.text).includes(word)))
      .map(item => ({ item, score: words.reduce((score, word) => score + (normalize(item.title) === word ? 10 : normalize(item.title).includes(word) ? 4 : 0), 0) }))
      .sort((a, b) => b.score - a.score || a.item.href.localeCompare(b.item.href)).map(result => result.item);
  }
  // The matching function is also available to the local verification script.
  if (typeof module !== 'undefined') module.exports = { search };
  if (typeof document === 'undefined') return;
  const dialog = document.getElementById('site-search');
  const query = document.getElementById('search-query');
  const mode = document.getElementById('search-mode');
  const status = document.getElementById('search-status');
  const results = document.getElementById('search-results');
  let loading;
  let generation = 0;
  let timer;
  function load() {
    if (window.SITE_SEARCH_INDEX) return Promise.resolve(window.SITE_SEARCH_INDEX);
    if (!loading) loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'assets/search-index.js';
      script.onload = () => resolve(window.SITE_SEARCH_INDEX);
      script.onerror = () => { script.remove(); loading = null; reject(new Error('load')); };
      document.head.append(script);
    });
    return loading;
  }
  async function run() {
    const current = ++generation;
    const text = query.value.trim();
    results.replaceChildren();
    if (!text) { status.textContent = mode.value === 'number' ? '定理番号を入力（例：1.19）' : '用語を入力して検索'; return; }
    status.textContent = '検索中…';
    try {
      const entries = await load();
      if (current !== generation) return;
      const found = search(entries, text, mode.value);
      status.textContent = found.length ? `${found.length}件${found.length > 50 ? '（上位50件を表示）' : ''}` : '見つからなかった';
      for (const item of found.slice(0, 50)) {
        const li = document.createElement('li');
        const link = document.createElement('a');
        link.href = item.href;
        link.textContent = `${item.number ? item.kind + ' ' + item.number + '　' : ''}${item.title}`;
        const snippet = document.createElement('p');
        const position = normalize(item.text).indexOf(normalize(text).split(/\s+/)[0]);
        const start = mode.value === 'term' ? Math.max(0, position - 30) : 0;
        snippet.textContent = (start ? '…' : '') + item.text.slice(start, start + 140) + (item.text.length > start + 140 ? '…' : '');
        li.append(link, snippet); results.append(li);
      }
    } catch (_) { if (current === generation) status.textContent = '検索データを読み込めなかった。もう一度検索して。'; }
  }
  document.getElementById('search-open').addEventListener('click', () => { dialog.showModal(); query.focus(); run(); });
  document.getElementById('search-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', event => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom)) dialog.close();
  });
  document.getElementById('search-form').addEventListener('submit', event => { event.preventDefault(); clearTimeout(timer); run(); });
  query.addEventListener('input', () => { generation++; clearTimeout(timer); timer = setTimeout(run, 120); });
  mode.addEventListener('change', () => { query.placeholder = mode.value === 'number' ? '例：1.19、定理 2.3' : '用語または定理番号を入力'; run(); query.focus(); });
})();
