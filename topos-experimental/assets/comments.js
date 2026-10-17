/* Quote anchors retain the selected text even after the manuscript changes. */
(function (root) {
  const categories = [['fix', '簡単な修正'], ['question', '疑問点'], ['unclassified', '未分類']];
  function groupComments(comments) {
    return categories.map(([category, label]) => ({category, label,
      comments: comments.filter(c => (c.category || 'unclassified') === category)}));
  }
  function locateQuote(text, anchor) {
    const candidates = [];
    let start = text.indexOf(anchor.quote);
    while (start !== -1) {
      const end = start + anchor.quote.length;
      const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
      const after = text.slice(end, end + anchor.suffix.length);
      candidates.push({start, end, context: before === anchor.prefix && after === anchor.suffix});
      start = text.indexOf(anchor.quote, start + 1);
    }
    if (candidates.length === 1) return candidates[0];
    const exact = candidates.filter(c => c.context);
    // A changed document must not silently point at another identical sentence.
    return exact.length === 1 ? exact[0] : null;
  }
  function matchesComment(comment, query) {
    const terms = query.normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    const text = [comment.number, comment.text, comment.resolution, comment.currentTitle,
      comment.anchor?.title, comment.anchor?.quote].filter(value => value != null)
      .join(' ').normalize('NFKC').toLocaleLowerCase();
    return terms.every(term => text.includes(term));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {locateQuote, matchesComment, groupComments};
  else root.bindComments = function ({reveal}) {
    const main = document.getElementById('main');
    if (!main) return;
    const page = location.pathname.split('/').pop() || 'index.html';
    const listPage = document.getElementById('comments-page');
    const params = new URL(location.href).searchParams;
    const fromPage = /^[a-z0-9][a-z0-9-]*\.html$/.test(params.get('from') || '') ? params.get('from') : '';
    const listHref = 'comments.html' + (!listPage ? '?from=' + encodeURIComponent(page) : location.search);

    const skip = 'button,input,textarea,select,label,script,style,template,.scope-mode-switch,.statement-review,.breadcrumb,.pagination,.reference-summary';
    const button = (text, fn) => {
      const b = document.createElement('button'); b.type = 'button'; b.textContent = text;
      b.addEventListener('click', fn); return b;
    };
    const node = (tag, text, className) => {
      const n = document.createElement(tag); if (text) n.textContent = text;
      if (className) n.className = className; return n;
    };
    const element = n => n.nodeType === Node.ELEMENT_NODE ? n : n.parentElement;
    function textModel(container, mode, visibleOnly = false) {
      const parts = []; let text = '';
      function walk(n) {
        if (n.nodeType === Node.TEXT_NODE) {
          parts.push({node: n, start: text.length, end: text.length + n.data.length, atomic: false});
          text += n.data; return;
        }
        if (n.nodeType !== Node.ELEMENT_NODE || n.matches(skip)) return;
        if ((n.matches('[hidden]') && !n.matches('.proof[data-formal]'))
            || (n.matches('.proof[data-formal]') && n.dataset[mode === 'formal' ? 'formal' : 'readable'] === 'false')
            || (mode === 'formal' && n.matches('.statement-readable'))
            || (mode !== 'formal' && n.matches('.statement-formal'))) return;
        if (visibleOnly && getComputedStyle(n).display === 'none') return;
        if (n.matches('svg')) {
          const value = n.getAttribute('aria-label');
          if (value) {
            parts.push({node: n, start: text.length, end: text.length + value.length, atomic: true});
            text += value;
          }
          return;
        }
        const children = visibleOnly && n.matches('details:not([open])')
          ? [...n.children].filter(c => c.tagName === 'SUMMARY') : [...n.childNodes];
        children.forEach(walk);
      }
      walk(container); return {text, parts};
    }
    function readSelection() {
      const selection = getSelection();
      if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return null;
      const range = selection.getRangeAt(0);
      if (!main.contains(range.startContainer) || !main.contains(range.endContainer)) return null;
      const first = element(range.startContainer), last = element(range.endContainer);
      if (first.closest(skip) || last.closest(skip)) return null;
      const startStatement = first.closest('.statement[id]');
      const endStatement = last.closest('.statement[id]');
      let container = first.closest('.statement[id],.statement-attachment[id],section[id],article[id]');
      while (container && !container.contains(range.endContainer)) container = container.parentElement.closest('[id]');
      if (!container || !main.contains(container)) container = main;
      const view = first.closest('.statement-formal,.statement-readable');
      const mode = view?.classList.contains('statement-formal') ? 'formal' : 'readable';
      const model = textModel(container, mode, true);
      let start = null, end = null;
      for (const part of model.parts) {
        if (!range.intersectsNode(part.node)) continue;
        let a = part.start, b = part.end;
        if (!part.atomic) {
          if (part.node === range.startContainer) a += range.startOffset;
          if (part.node === range.endContainer) b = part.start + range.endOffset;
        }
        if (a >= b) continue;
        if (start === null) start = a;
        end = b;
      }
      if (start === null || end === null) return null;
      const quote = model.text.slice(start, end);
      if (!quote.trim()) return null;
      return {page, rootId: container.id, statementId: startStatement?.id || '',
        endStatementId: endStatement?.id || '',
        title: (startStatement?.querySelector('h3')?.getAttribute('aria-label') || document.querySelector('h1')?.textContent || document.title).trim().slice(0, 500),
        view: mode, start, end, quote,
        prefix: model.text.slice(Math.max(0, start - 80), start), suffix: model.text.slice(end, end + 80)};
    }
    let comments = [], selected = null, activeId = null, available = false, refreshing = false, revision = -1;
    let highlightTargets = [], composing = false, editorActionRunning = false;
    const launcher = node('a', 'コメント'); launcher.href = listHref;
    launcher.className = 'comments-open'; launcher.hidden = true;
    if (listPage) launcher.setAttribute('aria-current', 'page');
    document.querySelector('.header-actions')?.prepend(launcher);
    const header = document.querySelector('.site-header');
    if (header) new ResizeObserver(() => {
      document.documentElement.style.setProperty('--site-header-height', header.getBoundingClientRect().height + 'px');
    }).observe(header);
    const add = button('コメントを付ける', () => {
      if (!selected) return;
      if (selected.quote.length > 20000) return;
      const anchor = selected;
      const rect = getSelection().getRangeAt(0).getBoundingClientRect();
      const id = typeof crypto.randomUUID === 'function' ? crypto.randomUUID()
        : [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
      autosave.edit(id, anchor, '', undefined, 'fix');
      openEditor(id, rect);
    });
    add.className = 'selection-comment'; add.hidden = true;
    add.addEventListener('pointerdown', e => e.preventDefault());
    document.body.append(add);
    const dialog = node('dialog', '', 'comments-panel');
    dialog.setAttribute('aria-labelledby', 'comments-heading');
    const heading = node('div', '', 'comments-heading');
    const title = node('h2', 'コメント'); title.id = 'comments-heading';
    const headingActions = node('div', '', 'comment-actions');
    const back = button('一覧', () => { closeWindow(); if (!listPage) location.href = listHref; });
    const close = button('閉じる', closeWindow);
    headingActions.append(back, close); heading.append(title, headingActions);
    const status = node('p', '', 'comments-status'); status.setAttribute('role', 'status');
    const form = node('form', '', 'comment-form');
    const quotation = node('blockquote');
    const label = node('label', 'コメント'); label.htmlFor = 'comment-text';
    const editor = node('textarea'); editor.id = 'comment-text'; editor.rows = 4; editor.maxLength = 10000;
    const categoryLabel = node('label', '種類'); categoryLabel.htmlFor = 'comment-category';
    const category = node('select'); category.id = 'comment-category';
    for (const [value, text] of categories) {
      const option = node('option', text); option.value = value; category.append(option);
    }
    const conflictButton = button('最新の内容を確認', async () => {
      await refresh();
      const current = comments.find(c => c.id === activeId);
      if (current) {
        conflictText.textContent = '現在の保存内容 (' + categories.find(([key]) => key === (current.category || 'unclassified'))[1] + '): ' + current.text;
        overwrite.hidden = false;
      }
    });
    const conflictText = node('p', '', 'comment-resolution');
    const overwrite = button('入力中の内容で更新', () => {
      autosave.useLatest(activeId, comments.find(c => c.id === activeId));
      overwrite.hidden = true; conflictText.textContent = '';
    });
    conflictButton.hidden = true; overwrite.hidden = true;
    form.append(quotation, categoryLabel, category, label, editor, conflictButton, conflictText, overwrite);
    const editorActions = node('div', '', 'comment-card-actions');
    const resolve = button('対応済みにする', async () => {
      const id = activeId;
      if (!id || editorActionRunning) return;
      editorActionRunning = true; updateEditorActions(); remember();
      try {
        await autosave.flush();
        if (autosave.pending().some(e => e.id === id)) return;
        const c = comments.find(c => c.id === id);
        if (c) {
          await request({action: 'status', id, status: c.status === 'open' ? 'resolved' : 'open', resolution: c.resolution});
          status.textContent = c.status === 'open' ? '対応済みにした.' : '未対応に戻した.';
        }
      } catch (_) { status.textContent = '保存できない. 接続を確認して再度試して.'; }
      finally { editorActionRunning = false; updateEditorActions(); }
    });
    const remove = button('削除', async () => {
      const id = activeId;
      if (!id || editorActionRunning) return;
      editorActionRunning = true; updateEditorActions();
      try {
        await autosave.remove(id);
        if (!autosave.get(id) && activeId === id) {
          activeId = null; dialog.close();
          if (listPage) state.focus({preventScroll: true});
        }
      } finally { editorActionRunning = false; updateEditorActions(); }
    });
    editorActions.append(resolve, remove); form.append(editorActions);
    function updateEditorActions() {
      const c = comments.find(c => c.id === activeId);
      const entry = activeId && autosave.get(activeId);
      resolve.textContent = c?.status === 'resolved' ? '未対応に戻す' : '対応済みにする';
      resolve.disabled = editorActionRunning || !c || !!entry?.deleting;
      remove.disabled = editorActionRunning || !entry;
      editor.disabled = category.disabled = editorActionRunning || !!entry?.deleting;
    }
    form.addEventListener('submit', e => { e.preventDefault(); void autosave.flush(); });
    const filters = node('div', '', 'comment-filters');
    const searchLabel = node('label', '検索'), search = node('input');
    search.type = 'search'; search.placeholder = '番号・本文・引用';
    search.setAttribute('aria-label', 'コメントを検索'); search.value = params.get('q') || '';
    searchLabel.className = 'comment-search'; searchLabel.append(search);
    const stateLabel = node('label', '状態'), state = node('select');
    state.setAttribute('aria-label', 'コメントの状態');
    for (const [value, text] of [['open', '未対応'], ['resolved', '対応済み'], ['all', 'すべて']]) {
      const opt = node('option', text); opt.value = value; state.append(opt);
    }
    state.value = ['open', 'resolved', 'all'].includes(params.get('status')) ? params.get('status') : 'open';
    stateLabel.append(state);
    const scopeLabel = node('label', '範囲'), scope = node('select');
    scope.setAttribute('aria-label', 'コメントの範囲');
    for (const [value, text] of [['all', '全ページ'], ['page', '元のページ']]) {
      const opt = node('option', text); opt.value = value; scope.append(opt);
    }
    scope.value = fromPage && params.get('scope') === 'page' ? 'page' : 'all';
    scopeLabel.append(scope); scopeLabel.hidden = !fromPage;
    filters.append(searchLabel, stateLabel, scopeLabel);
    const listStatus = node('p', '読み込み中…', 'comments-status'); listStatus.setAttribute('role', 'status');
    const resultCount = node('p', '', 'comment-result-count'); resultCount.setAttribute('aria-live', 'polite');
    const list = node('div', '', 'comment-list');
    dialog.append(heading, status, form); document.body.append(dialog);
    if (listPage) listPage.append(filters, listStatus, resultCount, list);
    function filterChanged() {
      if (listPage) {
        const url = new URL(location.href);
        for (const [key, value] of [['q', search.value], ['status', state.value === 'open' ? '' : state.value], ['scope', scope.value === 'all' ? '' : scope.value]]) {
          if (value) url.searchParams.set(key, value); else url.searchParams.delete(key);
        }
        history.replaceState(null, '', url);
      }
      render();
    }
    search.addEventListener('input', filterChanged);
    state.addEventListener('change', filterChanged);
    scope.addEventListener('change', filterChanged);
    const autosave = createCommentAutosave({
      storage: {getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value)},
      send: request,
      changed: () => {
        if (activeId && !autosave.get(activeId)) {
          activeId = null; dialog.close();
          if (listPage) state.focus({preventScroll: true});
        }
        if (activeId) {
          status.textContent = autosave.state(activeId);
          conflictButton.hidden = !autosave.get(activeId)?.conflict;
          const number = autosave.get(activeId)?.number || comments.find(c => c.id === activeId)?.number;
          title.textContent = number ? `コメント ${number}` : 'コメント';
          updateEditorActions();
        }
      }
    });
    // Keep drafts left by the previous manual-save UI.
    const oldKey = 'topos-ag:comment-draft:v1:' + page;
    try {
      const old = JSON.parse(sessionStorage.getItem(oldKey) || 'null');
      if (old?.id && old?.anchor && typeof old.text === 'string') {
        autosave.edit(old.id, old.anchor, old.text); sessionStorage.removeItem(oldKey);
      }
    } catch (_) {}
    function remember() {
      if (activeId) {
        const entry = autosave.get(activeId);
        if (entry) autosave.edit(activeId, entry.anchor, editor.value, undefined, category.value);
      }
    }
    editor.addEventListener('compositionstart', () => { composing = true; });
    editor.addEventListener('compositionend', () => { composing = false; remember(); });
    editor.addEventListener('input', () => { if (!composing) remember(); });
    editor.addEventListener('blur', () => { if (!composing) { remember(); void autosave.flush(); } });
    category.addEventListener('change', () => { remember(); void autosave.flush(); });
    function onPage(c) {
      const id = c.anchor.statementId || c.anchor.rootId;
      return (id !== 'main' && !!document.getElementById(id)) || c.href?.split('#')[0] === page;
    }
    function commentHref(c) {
      const url = new URL(c.href || c.anchor.page + '#' + c.anchor.rootId, location.href);
      url.searchParams.set('comment', c.number); return url.href;
    }
    function render() {
      if (activeId) updateEditorActions();
      const count = comments.filter(c => c.status === 'open').length;
      launcher.textContent = 'コメント' + (count ? ` ${count}` : '');
      if (!listPage) { renderHighlights(); return; }
      const expanded = new Set([...list.querySelectorAll('details[open]')].map(d => d.closest('[data-comment-number]').dataset.commentNumber));
      const focusedNumber = document.activeElement?.closest('[data-comment-number]')?.dataset.commentNumber;
      const focusedAction = document.activeElement?.dataset.action;
      list.replaceChildren();
      const items = comments.filter(c => (scope.value === 'all' || c.href?.split('#')[0] === fromPage)
        && (state.value === 'all' || c.status === state.value) && matchesComment(c, search.value));
      state.options[0].textContent = `未対応 (${count})`;
      state.options[1].textContent = `対応済み (${comments.length - count})`;
      state.options[2].textContent = `すべて (${comments.length})`;
      resultCount.textContent = `${items.length} 件`;
      for (const group of groupComments(items)) {
        const section = node('section', '', 'comment-category-group'); section.dataset.category = group.category;
        section.append(node('h2', `${group.label} (${group.comments.length})`));
        list.append(section);
        if (!group.comments.length) section.append(node('p', 'コメントはない.', 'comments-status'));
        for (const c of group.comments) {
        const card = node('article', '', 'comment-card'); card.dataset.commentNumber = c.number; card.id = `comment-${c.number}`;
        const h = node('h3', `コメント ${c.number}`);
        const badge = node('span', c.status === 'resolved' ? '対応済み' : '未対応', 'comment-badge');
        badge.dataset.status = c.status;
        const cardHeading = node('div', '', 'comment-card-heading'); cardHeading.append(h, badge);
        const target = node('a', c.currentTitle || c.anchor.title, 'comment-target'); target.href = commentHref(c);
        if (c.targetDeleted) target.onclick = event => { event.preventDefault(); jump(c); };
        const body = node('p', c.text, 'comment-body');
        const quotationDetails = node('details', '', 'comment-quote');
        quotationDetails.open = expanded.has(String(c.number));
        quotationDetails.append(node('summary', '引用'), node('blockquote', c.anchor.quote));
        const actions = node('div', '', 'comment-card-actions');
        const edit = button('編集', () => openEditor(c.id)); edit.dataset.action = 'edit';
        const toggle = button(c.status === 'open' ? '対応済みにする' : '未対応に戻す', async () => {
          toggle.disabled = true;
          try { await request({action: 'status', id: c.id, status: c.status === 'open' ? 'resolved' : 'open', resolution: c.resolution});
            listStatus.textContent = `コメント ${c.number} を${c.status === 'open' ? '対応済み' : '未対応'}にした.`;
          } catch (_) { listStatus.textContent = '保存できない. 接続を確認して再度試して.'; toggle.disabled = false; }
        }); toggle.dataset.action = 'status';
        actions.append(edit, toggle);
        card.append(cardHeading, target, body, quotationDetails);
        if (c.resolution) {
          const resolution = node('div', '', 'comment-resolution');
          resolution.append(node('span', '対応内容', 'comment-resolution-label'), node('p', c.resolution)); card.append(resolution);
        }
        card.append(actions); section.append(card);
        }
      }
      for (const pending of autosave.pending().filter(e => !comments.some(c => c.id === e.id)
          && (scope.value === 'all' || e.anchor.page === fromPage))) {
        list.append(button('未送信のコメントを開く', () => openEditor(pending.id)));
      }
      if (!items.length && !list.children.length) list.append(node('p', search.value.trim() ? '一致するコメントはない.' : 'コメントはない.'));
      if (focusedNumber && focusedAction) {
        const replacement = list.querySelector(`[data-comment-number="${focusedNumber}"] [data-action="${focusedAction}"]`);
        (replacement || state).focus({preventScroll: true});
      }
    }
    async function request(payload) {
      const body = payload && JSON.stringify(payload);
      const response = await fetch('/api/comments', {cache: 'no-store', ...(payload ? {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body,
        keepalive: new TextEncoder().encode(body).length < 60000} : {})});
      if (!response.ok) {
        const error = new Error('Comment API unavailable'); error.conflict = response.status === 409; throw error;
      }
      const data = await response.json();
      if (data.version !== 1 || !Array.isArray(data.comments)) throw new Error('Invalid comments');
      if (data.revision >= revision) {
        const changed = revision !== data.revision;
        comments = data.comments; revision = data.revision;
        if (changed) render();
      }
      available = true; launcher.hidden = false;
      return data;
    }
    async function refresh() {
      if (refreshing) return;
      refreshing = true;
      try { await request(); listStatus.textContent = ''; }
      catch (_) {
        listStatus.textContent = 'コメントを取得できない. 接続を確認して.';
        if (dialog.open && !activeId) status.textContent = listStatus.textContent;
      }
      finally { refreshing = false; }
    }
    function positionWindow(rect) {
      const width = dialog.offsetWidth, height = dialog.offsetHeight;
      let left = (innerWidth - width) / 2, top = Math.min(100, (innerHeight - height) / 2);
      if (rect) {
        left = rect.left;
        top = rect.bottom + 10;
        if (top + height > innerHeight - 12) top = rect.top - height - 10;
      }
      dialog.style.left = Math.max(12, Math.min(left, innerWidth - width - 12)) + 'px';
      dialog.style.top = Math.max(12, Math.min(top, innerHeight - height - 12)) + 'px';
    }
    function openWindow(rect) {
      selected = null; add.hidden = true;
      if (!dialog.open) dialog.show();
      positionWindow(rect);
    }
    function openEditor(id, rect) {
      const remote = comments.find(c => c.id === id);
      if (remote) autosave.adopt(remote);
      if (!autosave.get(id)) {
        if (!remote) return;
        autosave.edit(id, remote.anchor, remote.text, remote);
      }
      activeId = id;
      const entry = autosave.get(id);
      editor.value = entry.text; quotation.textContent = entry.anchor.quote;
      category.value = entry.category || 'unclassified';
      category.options[2].hidden = category.value !== 'unclassified';
      title.textContent = remote?.number ? `コメント ${remote.number}` : 'コメント';
      status.textContent = autosave.state(id);
      form.hidden = false; back.hidden = false;
      conflictButton.hidden = !entry.conflict; overwrite.hidden = true; conflictText.textContent = '';
      updateEditorActions();
      openWindow(rect); editor.focus();
    }
    function closeWindow() {
      if (activeId) { remember(); void autosave.flush(); }
      const number = comments.find(c => c.id === activeId)?.number;
      dialog.close(); activeId = null;
      if (listPage && number) list.querySelector(`[data-comment-number="${number}"] [data-action="edit"]`)?.focus({preventScroll: true});
    }
    dialog.addEventListener('cancel', event => { event.preventDefault(); closeWindow(); });
    function selectChanged() {
      if (listPage || !available || dialog.contains(document.activeElement)) return;
      selected = readSelection(); add.hidden = !selected;
      if (!selected) return;
      const rect = getSelection().getRangeAt(0).getBoundingClientRect();
      add.style.left = Math.max(8, Math.min(rect.right, innerWidth - add.offsetWidth - 8)) + 'px';
      add.style.top = Math.max(8, Math.min(rect.bottom + 8, innerHeight - add.offsetHeight - 8)) + 'px';
    }
    document.addEventListener('selectionchange', selectChanged);
    document.addEventListener('pointerup', () => setTimeout(selectChanged, 0));
    document.addEventListener('pointerdown', event => {
      if (dialog.open && !dialog.contains(event.target) && !launcher.contains(event.target) && !add.contains(event.target)) closeWindow();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') { add.hidden = true; selected = null; if (dialog.open) closeWindow(); }
    });
    addEventListener('scroll', () => { add.hidden = true; }, {passive: true});
    addEventListener('resize', () => { add.hidden = true; if (dialog.open) positionWindow(); });
    addEventListener('focus', () => { void refresh(); void autosave.flush(); });
    addEventListener('online', () => { void refresh(); void autosave.flush(); });
    addEventListener('pagehide', () => { if (activeId) remember(); void autosave.flush(); });
    setInterval(() => { if (!document.hidden && (available || listPage)) { void refresh(); void autosave.flush(); } }, 5000);
    function findRanges(c) {
      const container = document.getElementById(c.anchor.rootId) || document.getElementById(c.anchor.statementId);
      if (!container) return null;
      const model = textModel(container, c.anchor.view);
      const match = locateQuote(model.text, c.anchor);
      if (!match) return null;
      const parts = model.parts.filter(p => p.end > match.start && p.start < match.end);
      const ranges = parts.map(part => {
        const range = document.createRange();
        if (part.atomic) range.selectNode(part.node);
        else {
          range.setStart(part.node, Math.max(0, match.start - part.start));
          range.setEnd(part.node, Math.min(part.end, match.end) - part.start);
        }
        return range;
      });
      return parts.length ? {c, parts, ranges} : null;
    }
    const fallback = node('div', '', 'comment-highlight-layer'); fallback.setAttribute('aria-hidden', 'true'); document.body.append(fallback);
    function paintFallback() {
      fallback.replaceChildren();
      if (root.CSS?.highlights && root.Highlight) return;
      for (const {ranges} of highlightTargets) for (const range of ranges) {
        for (const rect of range.getClientRects()) {
          if (!rect.width || !rect.height || rect.bottom < 0 || rect.top > innerHeight) continue;
          const mark = node('span');
          Object.assign(mark.style, {left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px'});
          fallback.append(mark);
        }
      }
    }
    function renderHighlights() {
      main.querySelectorAll('.comment-math-target').forEach(n => n.classList.remove('comment-math-target'));
      highlightTargets = comments.filter(onPage).map(findRanges).filter(Boolean);
      const ranges = highlightTargets.flatMap(t => t.ranges);
      if (root.CSS?.highlights && root.Highlight) CSS.highlights.set('comment-selection', new Highlight(...ranges));
      highlightTargets.forEach(t => t.parts.filter(p => p.atomic).forEach(p => p.node.classList.add('comment-math-target')));
      paintFallback();
    }
    main.addEventListener('click', event => {
      if (!getSelection()?.isCollapsed || event.target.closest('button,a,input,summary')) return;
      const found = highlightTargets.find(t => t.ranges.some(r => [...r.getClientRects()].some(rect =>
        event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom)));
      if (found) openEditor(found.c.id, {left: event.clientX, top: event.clientY, bottom: event.clientY});
    });
    addEventListener('scroll', paintFallback, {passive: true});
    addEventListener('resize', paintFallback);
    main.addEventListener('toggle', () => requestAnimationFrame(paintFallback), true);
    main.addEventListener('statementscopechange', () => requestAnimationFrame(paintFallback));
    function jump(c) {
      if (c.targetDeleted) { openEditor(c.id); status.textContent = 'この環境は削除済み。保存した引用を表示している。'; return; }
      if (!onPage(c)) {
        const url = new URL(c.href, location.href); url.searchParams.set('comment', c.number); location.href = url.href; return;
      }
      const found = findRanges(c);
      if (!found) { openEditor(c.id); status.textContent = '本文が変更されたか, 同じ文章が複数あるため範囲を特定できない. 保存した引用を確認して.'; return; }
      found.parts.forEach(p => reveal(element(p.node)));
      closeWindow(); renderHighlights(); element(found.parts[0].node).scrollIntoView({block: 'center'});
      add.hidden = true; selected = null;
    }
    form.hidden = true;
    void refresh().then(() => {
      void autosave.flush();
      const number = Number(new URL(location.href).searchParams.get('comment'));
      const comment = comments.find(c => c.number === number);
      if (comment && !listPage) jump(comment);
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
