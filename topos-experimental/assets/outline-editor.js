(function (scope) {
  const clone = value => JSON.parse(JSON.stringify(value));
  function locate(doc, id) {
    for (const section of doc.sections) {
      if (section.id === id) return {item: section, list: doc.sections, section};
      for (const table of section.tables) {
        if (table.id === id) return {item: table, list: section.tables, section, table};
        const item = table.rows.find(row => row.id === id);
        if (item) return {item, list: table.rows, section, table};
      }
    }
    throw new Error('項目が見つからない');
  }
  function change(doc, action) {
    const found = locate(doc, action.id), list = found.list, item = found.item;
    if (action.type === 'delete') item.deleted = true;
    else if (action.type === 'edit') Object.assign(item, action.values);
    else if (action.type === 'step') {
      const index = list.indexOf(item); let target = index + action.delta;
      while (target >= 0 && target < list.length && list[target].deleted) target += action.delta;
      if (target >= 0 && target < list.length) [list[index], list[target]] = [list[target], list[index]];
    } else if (action.type === 'move') {
      const destination = locate(doc, action.table).item;
      if (!found.table || destination.kind !== found.table.kind) throw new Error('同じ種類の表を選んで');
      if (action.before === item.id) return;
      list.splice(list.indexOf(item), 1);
      const position = action.before ? destination.rows.findIndex(row => row.id === action.before) : destination.rows.length;
      if (position < 0) throw new Error('移動先が見つからない');
      destination.rows.splice(position, 0, item);
    }
    return doc;
  }
  scope.OutlineDraft = {clone, locate, change};
  if (typeof module === 'object') module.exports = scope.OutlineDraft;
  if (typeof document === 'undefined') return;
  const root = document.getElementById('ega-outline');
  if (!root) return;
  const documentId = root.dataset.outlineDocument || 'ega-zero';
  const endpoint = documentId === 'ega-zero' ? '/api/outline' : '/api/outline/' + documentId;
  const key = documentId === 'ega-zero' ? 'topos-ag:ega-outline-draft:v1' : 'topos-ag:' + documentId + '-draft:v1';
  let catalog, baseline, draft, history = [], editing = false, busy = false, staleDraft;
  const originals = new Map();
  let installControls, controlsReady = false;
  const nodes = new Map([...root.querySelectorAll('[id]')].map(node => [node.id, node]));
  const el = (tag, text, cls) => {const node = document.createElement(tag); if (text) node.textContent = text; if (cls) node.className = cls; return node;};
  const button = (text, action, id) => {
    const node = el('button', text); node.type = 'button'; node.dataset.outlineAction = action;
    if (id) node.dataset.outlineTarget = id; return node;
  };
  const toolbar = el('div', null, 'outline-toolbar');
  const start = button('表を編集', 'start'), save = button('保存', 'save');
  const undo = button('元に戻す', 'undo'), discard = button('変更を取り消す', 'discard');
  const close = button('編集を終了', 'close'), status = el('span', '');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  toolbar.append(start, save, undo, discard, close, status);
  const dialog = el('dialog', null, 'outline-dialog');
  const dialogTitle = el('h2'); dialogTitle.id = 'outline-dialog-title'; dialog.setAttribute('aria-labelledby', dialogTitle.id);
  const fields = el('div'), apply = button('反映', 'apply'), cancel = button('閉じる', 'cancel');
  dialog.append(dialogTitle, fields, el('div', null, 'outline-dialog-actions')); dialog.lastChild.append(apply, cancel);
  document.body.append(dialog);
  let active, formType, controls;
  function input(label, value, multiline = false) {
    const wrapper = el('label', label), field = el(multiline ? 'textarea' : 'input');
    field.value = value; if (multiline) field.rows = 8; wrapper.append(field); fields.append(wrapper); return field;
  }
  function openEditor(id) {
    active = id; formType = 'edit'; fields.replaceChildren(); const {item, table} = locate(draft, id);
    dialogTitle.textContent = table && item.content !== undefined ? '項目 ' + item.label + ' を編集' : '見出しを編集';
    controls = {};
    if (item.content !== undefined) {
      if (table.kind === 'notation') controls.label = input('記号・用語', item.label);
      controls.content = input('内容', item.content, true);
      const help = el('details'); help.append(el('summary', '数式の入力')); help.append(el('p', '数式は \\( と \\) で囲む。強調は ** と ** で囲む。')); fields.append(help);
    } else {
      controls.title = input('見出し', item.title);
      if (item.intro !== undefined) controls.intro = input('前提・補足', item.intro, true);
    }
    dialog.showModal(); Object.values(controls)[0].focus();
  }
  function openMove(id) {
    active = id; formType = 'move'; fields.replaceChildren(); dialogTitle.textContent = '項目 ' + locate(draft, id).item.label + ' の移動';
    fields.append(el('p', '移動先の表と位置を選び、「反映」を押す。最後に「保存」で確定する。'));
    const source = locate(draft, id), tableSelect = el('select'), position = el('select');
    const tableLabel = el('label', '移動先の表'); tableLabel.append(tableSelect); fields.append(tableLabel);
    const positionLabel = el('label', '位置'); positionLabel.append(position); fields.append(positionLabel);
    for (const section of draft.sections.filter(s => !s.deleted)) for (const table of section.tables.filter(t => !t.deleted && t.kind === source.table.kind)) {
      const option = el('option', section.title + ' / ' + table.title); option.value = table.id; tableSelect.append(option);
    }
    tableSelect.value = source.table.id;
    const update = () => {
      position.replaceChildren(); const end = el('option', '末尾'); end.value = ''; position.append(end);
      for (const row of locate(draft, tableSelect.value).item.rows.filter(r => !r.deleted && r.id !== id)) {
        const option = el('option', row.label + ' の前'); option.value = row.id; position.append(option);
      }
    };
    tableSelect.addEventListener('change', update); update(); controls = {table: tableSelect, before: position}; dialog.showModal();
  }
  const dirty = () => JSON.stringify(draft) !== JSON.stringify(baseline);
  function place(parent, ordered) {
    let cursor = parent.firstElementChild;
    for (const node of ordered) {
      if (node === cursor) cursor = cursor.nextElementSibling;
      else parent.insertBefore(node, cursor);
    }
  }
  function remember(modified) {
    try {
      if (modified && !staleDraft) localStorage.setItem(key, JSON.stringify({token: catalog.token, baseline, document: draft}));
      else if (!staleDraft) localStorage.removeItem(key);
    } catch (_) {}
  }
  function refresh() {
    const modified = dirty();
    if (editing && !controlsReady) {installControls(); controlsReady = true;}
    root.classList.toggle('outline-editing', editing); root.classList.toggle('outline-busy', busy);
    start.hidden = editing; save.hidden = discard.hidden = close.hidden = !editing;
    save.disabled = busy || !modified; discard.disabled = busy || !modified; close.disabled = busy || modified;
    undo.hidden = !editing && !catalog.canUndo; undo.disabled = busy || (!history.length && (modified || !catalog.canUndo));
    status.textContent = busy ? '保存中…' : modified ? '未保存の変更あり' : '保存済み';
    if (!controlsReady) {remember(modified); return;}
    const sections = [];
    for (const section of draft.sections) {
      const sectionNode = nodes.get(section.id); sectionNode.hidden = section.deleted;
      sectionNode.querySelector(':scope > h2 .outline-title').textContent = section.title;
      for (const [name, delta] of [['up', -1], ['down', 1]]) {
        const visible = draft.sections.filter(s => !s.deleted), index = visible.indexOf(section);
        const control = sectionNode.querySelector(':scope > h2 [data-outline-action="' + name + '"]');
        if (control) control.disabled = delta < 0 ? index <= 0 : index >= visible.length - 1;
      }
      sections.push(sectionNode); const tables = [];
      for (const table of section.tables) {
        const tableNode = nodes.get(table.id); tableNode.hidden = table.deleted;
        tableNode.querySelector(':scope > h3 .outline-title').textContent = table.title;
        for (const [name, delta] of [['up', -1], ['down', 1]]) {
          const visible = section.tables.filter(t => !t.deleted), index = visible.indexOf(table);
          const control = tableNode.querySelector(':scope > h3 [data-outline-action="' + name + '"]');
          if (control) control.disabled = delta < 0 ? index <= 0 : index >= visible.length - 1;
        }
        tables.push(tableNode); const rows = [], visible = table.rows.filter(r => !r.deleted);
        for (const row of table.rows) {
          const node = nodes.get(row.id); node.hidden = row.deleted; rows.push(node);
          const original = originals.get(row.id);
          if (row.content !== original.content) {
            node.querySelector('.outline-content').textContent = row.content.replace(/\*\*/g, '').replace(/\\\((.*?)\\\)/g, '$1');
            node.classList.add('outline-changed');
          } else if (node.classList.contains('outline-changed')) {
            node.querySelector('.outline-content').innerHTML = node._originalContent;
            node.classList.remove('outline-changed');
          }
          for (const [action, delta] of [['up', -1], ['down', 1]]) {
            const index = visible.indexOf(row);
            node.querySelector('[data-outline-action="' + action + '"]').disabled = delta < 0 ? index <= 0 : index >= visible.length - 1;
          }
        }
        place(tableNode.querySelector('tbody'), rows);
      }
      // Notes follow all tables and remain outside the reorderable collection.
      const anchor = sectionNode.querySelector('.outline-note');
      let cursor = sectionNode.querySelector(':scope > h2').nextElementSibling;
      for (const node of tables) {if (node === cursor) cursor = cursor.nextElementSibling; else sectionNode.insertBefore(node, cursor || anchor);}
    }
    let cursor = root.querySelector('.outline-section');
    for (const node of sections) {if (node === cursor) cursor = cursor.nextElementSibling; else root.insertBefore(node, cursor);}
    const nav = root.querySelector('.outline-contents'); nav.replaceChildren();
    for (const section of draft.sections.filter(s => !s.deleted)) {const link = el('a', section.title); link.href = '#' + section.id; nav.append(link);}
    remember(modified);
  }
  function mutate(action) {history.push(clone(draft)); if (history.length > 20) history.shift(); change(draft, action); refresh();}
  async function request(payload) {
    const response = await fetch(endpoint, {cache: 'no-store', ...(payload ? {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)} : {})});
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || '保存できなかった。入力は保持している。');
    }
    return response.json();
  }
  async function publish(action) {
    busy = true; refresh();
    try {
      await request({action, revision: catalog.revision, token: catalog.token, ...(action === 'save' ? {document: draft} : {})});
      localStorage.removeItem(key); location.reload();
    } catch (error) {busy = false; refresh(); status.textContent = error.message;}
  }
  function click(event) {
    const control = event.target.closest('button[data-outline-action]'); if (!control || busy) return;
    const action = control.dataset.outlineAction, id = control.dataset.outlineTarget;
    if (action === 'start') {editing = true; refresh();}
    else if (action === 'close') {editing = false; refresh();}
    else if (action === 'save') void publish('save');
    else if (action === 'undo') {if (history.length) {draft = history.pop(); refresh();} else void publish('undo');}
    else if (action === 'discard') {draft = clone(baseline); history = []; refresh();}
    else if (action === 'delete') mutate({type: 'delete', id});
    else if (action === 'up' || action === 'down') mutate({type: 'step', id, delta: action === 'up' ? -1 : 1});
    else if (action === 'edit') openEditor(id);
    else if (action === 'move') openMove(id);
    else if (action === 'cancel') dialog.close();
    else if (action === 'apply') {
      const values = Object.fromEntries(Object.entries(controls).map(([key, field]) => [key, field.value]));
      if (formType === 'edit') mutate({type: 'edit', id: active, values});
      else mutate({type: 'move', id: active, ...values});
      dialog.close();
    }
  }
  request().then(data => {
    catalog = data; baseline = clone(data.document); draft = clone(baseline);
    for (const section of baseline.sections) for (const table of section.tables) for (const row of table.rows) originals.set(row.id, row);
    // A newly published page is required before binding its fixed row IDs.
    if (String(root.dataset.revision) !== String(data.revision)) {location.reload(); return;}
    installControls = () => {
    for (const section of draft.sections) {
      const node = nodes.get(section.id); if (!node) continue;
      for (const [item, heading, row] of [[section, node.querySelector(':scope > h2'), false], ...section.tables.map(t => [t, nodes.get(t.id)?.querySelector(':scope > h3'), false])]) {
        if (!heading) continue; const title = el('span', heading.textContent, 'outline-title'); heading.replaceChildren(title);
        const tools = el('span', null, 'outline-tools');
        for (const [label, action] of [['↑', 'up'], ['↓', 'down'], ['編集', 'edit'], ['削除', 'delete']]) {
          const b = button(label, action, item.id); b.setAttribute('aria-label', item.title + '：' + ({up: '上へ', down: '下へ'}[action] || label)); tools.append(b);
        }
        heading.append(tools);
      }
      for (const table of section.tables) {
        const tableNode = nodes.get(table.id); if (!tableNode) continue;
        tableNode.querySelector('thead tr').append(el('th', '操作', 'outline-tools'));
        for (const row of table.rows) {
          const node = nodes.get(row.id); if (!node) continue;
          node._originalContent = node.querySelector('.outline-content').innerHTML;
          const tools = el('td', null, 'outline-tools');
          for (const [label, action] of [['↑', 'up'], ['↓', 'down'], ['移動', 'move'], ['編集', 'edit'], ['削除', 'delete']]) {
            const b = button(label, action, row.id); b.setAttribute('aria-label', row.label + '：' + ({up: '上へ', down: '下へ'}[action] || label));
            tools.append(b);
          }
          node.append(tools);
        }
      }
    }
    // Deleted entries are retained privately for undo, but have no live DOM nodes.
    // Filter them from the draft UI model only by providing inert nodes.
    for (const section of draft.sections) {
      if (!nodes.has(section.id)) {const node = el('section'); node.id = section.id; node.innerHTML = '<h2><span class="outline-title"></span></h2>'; nodes.set(section.id, node); root.append(node);}
      for (const table of section.tables) {
        if (!nodes.has(table.id)) {const node = el('section'); node.id = table.id; node.innerHTML = '<h3><span class="outline-title"></span></h3><table><tbody></tbody></table>'; nodes.set(table.id, node); nodes.get(section.id).append(node);}
        for (const row of table.rows) if (!nodes.has(row.id)) {
          const node = el('tr'); node.id = row.id; node.innerHTML = '<td class="outline-content"></td><td><button data-outline-action="up"></button><button data-outline-action="down"></button></td>';
          node._originalContent = ''; nodes.set(row.id, node); nodes.get(table.id).querySelector('tbody').append(node);
        }
      }
    }
    };
    let cached; try {cached = JSON.parse(localStorage.getItem(key));} catch (_) {}
    if (cached?.token === catalog.token) {draft = cached.document; editing = true; history.push(clone(baseline));}
    else if (cached) staleDraft = cached;
    root.addEventListener('click', click); dialog.addEventListener('click', click); root.prepend(toolbar); refresh();
    if (staleDraft) {
      status.textContent = '別の画面で変更された。前の未保存の入力は保持している。';
      const recover = el('button', '未保存の入力を確認'); recover.type = 'button'; toolbar.append(recover);
      recover.addEventListener('click', () => {
        fields.replaceChildren(); dialogTitle.textContent = '前の未保存の入力';
        const lines = [];
        for (const section of staleDraft.document.sections) for (const table of section.tables) for (const row of table.rows) {
          let before; try {before = locate(staleDraft.baseline || baseline, row.id).item;} catch (_) {}
          if (!before || row.content !== before.content || row.deleted !== before.deleted) lines.push(row.label + (row.deleted ? '（削除）' : '') + '\n' + row.content);
        }
        const contents = input('変更した内容', lines.join('\n\n'), true); contents.readOnly = true;
        apply.hidden = true; dialog.showModal();
      });
      dialog.addEventListener('close', () => {apply.hidden = false;});
    }
  }).catch(() => {dialog.remove();});
})(typeof globalThis === 'object' ? globalThis : this);
