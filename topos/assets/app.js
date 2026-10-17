(() => {
  const reviewPrefix = 'topos-ag-final:reviewed:v1:';
  let reviewStatus = {online: false, pending: 0};
  const reviewSync = createReviewSync({
    storage: {getItem: key => localStorage.getItem(key), setItem: (key, value) => localStorage.setItem(key, value),
      removeItem: key => localStorage.removeItem(key), key: i => localStorage.key(i), get length() { return localStorage.length; }},
    request: (...args) => fetch(...args),
    changed: status => {
      reviewStatus = status;
      reviewInputs.forEach((input, key) => restoreReview(key, input));
      updateReviewIndicators();
    }
  });
  const reviewInputs = new Map();
  const updateReviewIndicators = bindReviewIndicators(document, id => reviewSync.checked(id));
  updateReviewIndicators();
  function restoreReview(key, input) {
    const ids = JSON.parse(input.dataset.reviewIds || 'null') || [key.slice(reviewPrefix.length)];
    input.checked = ids.every(id => reviewSync.checked(id));
    input.parentElement.title = reviewStatus.localOnly ? '確認状態をこのブラウザー内に保存'
      : reviewStatus.online && !reviewStatus.pending
      ? '確認状態をサーバーと同期済み'
      : '確認状態は未同期. 接続後に再送する. ';
  }
  document.querySelectorAll('.statement[id], .outline-section[data-review-section]').forEach(statement => {
    const outline = statement.classList.contains('outline-section');
    const heading = statement.querySelector(outline ? ':scope > details > summary' : ':scope > h3');
    if (!heading) return;
    const key = reviewPrefix + statement.id;
    const label = document.createElement('label');
    label.className = outline ? 'statement-review outline-section-review' : 'statement-review';
    label.title = '確認状態をこのブラウザーに保存';
    const input = document.createElement('input');
    const pair = statement.closest('.statement-pair');
    const ids = pair ? [...pair.querySelectorAll('.statement[id]')].map(item => item.id) : [statement.id];
    input.dataset.reviewIds = JSON.stringify(ids);
    input.type = 'checkbox';
    input.autocomplete = 'off';
    heading.setAttribute('aria-label', heading.textContent.trim());
    input.setAttribute('aria-label', `${heading.textContent.trim()}：確認済み`);
    label.append(input, document.createTextNode('確認済み'));
    if (outline) statement.prepend(label);
    else heading.append(label);
    reviewInputs.set(key, input);
    restoreReview(key, input);
    input.addEventListener('change', () => {
      const checked = input.checked;
      void Promise.all(ids.map(id => reviewSync.set(id, checked)));
    });
  });
  addEventListener('storage', event => {
    if (event.key === null || event.key.startsWith(reviewPrefix) || event.key === 'topos-ag-final:review-pending:v1') void reviewSync.sync();
  });
  addEventListener('pageshow', () => { void reviewSync.sync(); });
  addEventListener('focus', () => { void reviewSync.sync(); });
  addEventListener('online', () => { void reviewSync.sync(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void reviewSync.sync(); });
  setInterval(() => { if (!document.hidden) void reviewSync.sync(); }, 2000);
  void reviewSync.sync();
  bindStatementScopes(document);
  const viewSync = bindStatementViews();
  bindMathLayout(document);
  const menu = document.getElementById('toc-toggle');
  const sidebar = document.getElementById('toc');
  const edge = document.getElementById('toc-edge');
  const tip = document.getElementById('annotation');
  let active = null;
  let timer;
  let menuTimer;
  let menuByPointer = false;
  const hoverPointer = matchMedia('(any-hover: hover)');

  function closeMenu() {
    clearTimeout(menuTimer);
    sidebar.classList.remove('is-open');
    sidebar.inert = true;
    menu.setAttribute('aria-expanded', 'false');
    edge.setAttribute('aria-expanded', 'false');
    menuByPointer = false;
  }
  function openMenu(byPointer = false) {
    clearTimeout(menuTimer);
    menuByPointer = byPointer;
    sidebar.inert = false;
    sidebar.classList.add('is-open');
    menu.setAttribute('aria-expanded', 'true');
    edge.setAttribute('aria-expanded', 'true');
  }
  function deferCloseMenu() {
    if (menuByPointer) menuTimer = setTimeout(closeMenu, 180);
  }
  closeMenu();
  menu.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) closeMenu();
    else openMenu();
  });
  edge.addEventListener('pointerenter', event => {
    if (hoverPointer.matches && event.pointerType !== 'touch') openMenu(true);
  });
  edge.addEventListener('pointerleave', deferCloseMenu);
  edge.addEventListener('click', event => {
    openMenu(event.detail > 0 && hoverPointer.matches);
    if (!event.detail) sidebar.querySelector('a')?.focus();
  });
  sidebar.addEventListener('pointerenter', () => clearTimeout(menuTimer));
  sidebar.addEventListener('pointerleave', deferCloseMenu);
  sidebar.addEventListener('focusin', () => { clearTimeout(menuTimer); menuByPointer = false; });
  sidebar.addEventListener('focusout', event => {
    if (!sidebar.contains(event.relatedTarget) && event.relatedTarget !== menu && event.relatedTarget !== edge) closeMenu();
  });
  sidebar.addEventListener('click', event => {
    if (event.target.closest('a')) closeMenu();
  });

  function hideNote() {
    clearTimeout(timer);
    active?.removeAttribute('aria-describedby');
    tip.hidden = true;
    active = null;
  }
  function placeNote() {
    if (!active) return;
    const anchor = active.getBoundingClientRect();
    const bounds = tip.getBoundingClientRect();
    const left = Math.max(12, Math.min(anchor.left, innerWidth - bounds.width - 12));
    const below = anchor.bottom + 10;
    const top = below + bounds.height <= innerHeight - 12 ? below : Math.max(12, anchor.top - bounds.height - 10);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function showNote(trigger) {
    clearTimeout(timer);
    if (active && active !== trigger) active.removeAttribute('aria-describedby');
    active = trigger;
    tip.replaceChildren();
    const preview = trigger.dataset.referenceRef && document.getElementById(trigger.dataset.referenceRef);
    const bibliography = !trigger.classList.contains('reference') && trigger.dataset.sourceRef && document.getElementById(trigger.dataset.sourceRef);
    if (bibliography) {
      tip.append(bibliography.content.cloneNode(true));
    } else {
      if (trigger.dataset.noteTitle) {
        const title = document.createElement('strong');
        title.className = 'annotation-title';
        title.textContent = trigger.dataset.noteTitle;
        tip.append(title);
      }
      if (preview) {
        tip.append(preview.content.cloneNode(true));
      } else {
        tip.append(document.createTextNode(trigger.dataset.note || ''));
      }
    }
    tip.hidden = false;
    trigger.setAttribute('aria-describedby', tip.id);
    placeNote();
  }
  function deferHide() { clearTimeout(timer); timer = setTimeout(hideNote, 220); }
  document.querySelectorAll('[data-note], [data-reference-ref], [data-source-ref]').forEach(trigger => {
    trigger.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') showNote(trigger);
    });
    trigger.addEventListener('pointerleave', deferHide);
    trigger.addEventListener('focus', () => showNote(trigger));
    trigger.addEventListener('blur', deferHide);
    if (trigger.tagName === 'BUTTON') {
      trigger.addEventListener('click', () => {
        // Touch and keyboard activation keep the annotation visible.
        showNote(trigger);
      });
    }
  });
  tip.addEventListener('pointerenter', () => clearTimeout(timer));
  tip.addEventListener('pointerleave', deferHide);
  document.addEventListener('pointerdown', event => {
    if (!sidebar.contains(event.target) && !menu.contains(event.target) && event.target !== edge) closeMenu();
    if (!event.target.closest('[data-note], [data-reference-ref], [data-source-ref]') && !tip.contains(event.target)) hideNote();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      hideNote();
      if (sidebar.classList.contains('is-open')) {
        closeMenu();
        (menu.getClientRects().length ? menu : edge).focus();
      }
    }
  });
  addEventListener('scroll', placeNote, { passive: true });
  addEventListener('resize', placeNote);
  function showTarget() {
    if (!location.hash) return;
    let id;
    try { id = decodeURIComponent(location.hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    viewSync.reveal(target);
  }
  addEventListener('hashchange', () => { hideNote(); showTarget(); });
  showTarget();
  bindComments({reveal: viewSync.reveal});
})();
