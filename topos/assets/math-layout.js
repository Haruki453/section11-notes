/* Center only the environments that need extra room for their formulas. */
(() => {
  window.bindMathLayout = doc => {
    const win = doc.defaultView;
    const main = doc.querySelector('main');
    if (!win || !main) return;
    const blocks = [...main.querySelectorAll('.math-block, .inference, .formula-expanded')]
      .filter(block => !block.closest('table') && !block.parentElement.closest('.formula-expanded'));
    const groups = new Map();
    blocks.forEach(block => {
      const group = block.closest('.statement') || block;
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(block);
    });
    let pending = 0;
    function layout() {
      pending = 0;
      // Restore normal flow first so narrower windows and changed modes can shrink back.
      groups.forEach((_, group) => {
        group.style.removeProperty('--math-layout-width');
        group.style.removeProperty('--math-layout-offset');
        group.classList.remove('math-layout-wide');
      });
      const mainRect = main.getBoundingClientRect();
      const mainStyle = win.getComputedStyle(main);
      const left = Math.max(16, mainRect.left + parseFloat(mainStyle.paddingLeft));
      const right = Math.min(doc.documentElement.clientWidth - 16,
        mainRect.right - parseFloat(mainStyle.paddingRight));
      const changes = [];
      for (const [group, members] of groups) {
        const rect = group.getBoundingClientRect();
        if (!rect.width) continue;
        let needed = rect.width;
        for (const block of members) {
          // Closed details may still report intrinsic bounds in some browsers.
          let hidden = false;
          for (let parent = block; parent && parent !== main; parent = parent.parentElement) {
            if (parent.hidden || (parent.tagName === 'DETAILS' && !parent.open)) {
              hidden = true;
              break;
            }
          }
          if (hidden) continue;
          const blockRect = block.getBoundingClientRect();
          if (!blockRect.width) continue;
          const formulas = block.matches('.formula-expanded')
            ? block.querySelectorAll('.math-block > svg') : block.querySelectorAll(':scope > svg');
          const intrinsic = Math.max(0, ...[...formulas].map(svg => svg.getBoundingClientRect().width));
          // Include the environment's padding and any list indentation.
          needed = Math.max(needed, intrinsic + rect.width - blockRect.width);
        }
        const center = (rect.left + rect.right) / 2;
        const available = 2 * Math.min(center - left, right - center);
        const width = Math.min(Math.ceil(needed), Math.floor(available));
        if (width > rect.width + 1) changes.push([group, width, (rect.width - width) / 2]);
      }
      changes.forEach(([group, width, offset]) => {
        group.style.setProperty('--math-layout-width', `${width}px`);
        group.style.setProperty('--math-layout-offset', `${offset}px`);
        group.classList.add('math-layout-wide');
      });
    }
    function schedule() {
      if (!pending) pending = win.requestAnimationFrame(layout);
    }
    const observer = new win.ResizeObserver(schedule);
    observer.observe(main);
    // Observe intrinsic formula sizes too, including formulas becoming visible.
    blocks.forEach(block => block.querySelectorAll('svg').forEach(svg => observer.observe(svg)));
    doc.addEventListener('toggle', schedule, true);
    win.addEventListener('resize', schedule);
    win.addEventListener('pagehide', () => {
      observer.disconnect();
      win.cancelAnimationFrame(pending);
    }, {once: true});
    layout();
  };
})();
