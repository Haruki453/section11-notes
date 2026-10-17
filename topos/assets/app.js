/* Public reading controls. No private storage or authoring APIs. */
(() => {
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
})();
