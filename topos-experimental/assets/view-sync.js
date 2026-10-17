/* Keep generated formal views in the document, with only readable views exposed. */
(() => {
  window.bindStatementScopes = doc => {
    function placeControl(pair, panel) {
      const control = pair.querySelector('.scope-mode-switch');
      const heading = panel?.querySelector('.statement > h3');
      if (!control || !heading || control.parentElement === heading) return;
      const focused = control.contains(doc.activeElement) ? doc.activeElement : null;
      heading.insertBefore(control, heading.querySelector('.statement-review'));
      focused?.focus({preventScroll: true});
    }
    doc.querySelectorAll('.statement-pair').forEach(pair => {
      placeControl(pair, pair.querySelector(':scope > .statement-scope:not([hidden])'));
    });
    function select(pair, mode) {
      const panels = [...pair.querySelectorAll(':scope > .statement-scope')];
      if (!panels.some(panel => panel.dataset.scope === mode)) return;
      panels.forEach(panel => { panel.hidden = panel.dataset.scope !== mode; });
      placeControl(pair, panels.find(panel => panel.dataset.scope === mode));
      pair.querySelectorAll('.scope-mode-switch > button').forEach(button => {
        button.setAttribute('aria-pressed', String(button.dataset.scopeMode === mode));
      });
      pair.dispatchEvent(new CustomEvent('statementscopechange', {bubbles: true}));
    }
    doc.addEventListener('click', event => {
      const button = event.target.closest('.scope-mode-switch > button');
      if (!button) return;
      const pair = button.closest('.statement-pair');
      select(pair, button.dataset.scopeMode);
      const id = button.getAttribute('aria-controls');
      const url = new URL(location.href); url.hash = id;
      history.replaceState(history.state, '', url);
    });
    const reveal = element => {
      const panel = element.closest('.statement-scope');
      if (!panel) return false;
      const changed = panel.hidden;
      if (changed) select(panel.closest('.statement-pair'), panel.dataset.scope);
      return changed;
    };
    window.revealStatementScope = reveal;
    return {select, reveal};
  };
  window.bindStatementViews = () => {
    function reveal(element) {
      if (element.closest('.statement-formal,.proof[data-readable="false"]')) return false;
      const changedScope = window.revealStatementScope?.(element);
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS' && !parent.hidden) {
          parent.open = true;
        }
      }
      if (changedScope) element.scrollIntoView({block: 'start'});
      return true;
    }
    return {reveal};
  };
})();
