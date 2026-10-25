/// <reference lib="esnext" />
// Copied verbatim from the workspace block .claude/tools/etfs/ui-std/dropdown.tsx (the Columns menu of the ETF apps and Stocks);
// only the import and the export line are added, plus the esnext lib reference and Array.from over the NodeList
// for the IDE's ES5 type check. Change the block there first, then copy it here again.
import { escapeHtml, normalizeSearchText } from './html';

type DropdownItem = { id: string; label: string; count: number; selected: boolean; badges?: string; locked?: boolean }; // locked: always selected, cannot be toggled

type Dropdown = { refresh(): void; open(query?: string): void; close(restoreFocus?: boolean): void; isOpen(): boolean };

type DropdownConfig = {
  trigger: any;
  panel: any;
  title: string; // "Exchanges"
  noun: string; // "exchanges", used in the search placeholder and the empty state
  unit: string; // what the row number counts: "stocks" or "columns"
  getItems(): DropdownItem[];
  /** Receives the complete new selection; the owner persists it and re-renders. */
  onChange(selected: Set<string>): void;
};

const DD_TICK = '<svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3.5 8.5 3 3 6-7"/></svg>';

/**
 * Accessible multi-select popover. Layout, top to bottom: search field (first
 * line, autofocused), bulk actions (All / Clear / Toggle / Reset),
 * counts + "Selected only", the scrollable option list. The selection lives in
 * the owner's state and is independent of the search text: the search only
 * decides which rows are visible, bulk actions touch only the visible rows and
 * merge with the rest, Reset restores "everything selected".
 * Keyboard (focus stays in the search input; combobox + aria-activedescendant):
 * Up/Down/PageUp/PageDown move, Enter toggles the active row (Shift+Enter =
 * Only), Space toggles while the search is empty, Ctrl/Cmd+A selects all visible,
 * Esc clears the search, then closes and refocuses the trigger. Typing on the
 * closed trigger opens the list with that text as the query. Under 640px the
 * panel is a bottom sheet with a backdrop (see .dd-panel in index.html).
 */
function createDropdown(cfg: DropdownConfig): Dropdown {
  const { trigger, panel } = cfg;
  const uid = panel.id;
  const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', cfg.title);
  panel.innerHTML = `
    <div class="dd-search">
      <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="9" cy="9" r="5.5"/><path d="m13.5 13.5 3.5 3.5"/></svg>
      <input type="text" class="dd-input" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="${uid}-list" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Search ${escapeHtml(cfg.noun)}..." aria-label="Search ${escapeHtml(cfg.noun)}" />
      <button type="button" class="dd-qclear" hidden aria-label="Clear search" tabindex="-1">✕</button>
      <button type="button" class="dd-close" aria-label="Close ${escapeHtml(cfg.title)}">✕</button>
    </div>
    <div class="dd-actions" role="group" aria-label="Bulk actions for the shown ${escapeHtml(cfg.noun)}">
      <button type="button" class="dd-act" data-act="all" title="Select every shown row (Ctrl/Cmd+A)">All</button>
      <button type="button" class="dd-act" data-act="none" title="Deselect every shown row">Clear</button>
      <button type="button" class="dd-act" data-act="toggle" title="Invert the selection of the shown rows">Toggle</button>
      <button type="button" class="dd-act" data-act="reset" title="Back to the default: everything selected, whatever the search">Reset</button>
    </div>
    <div class="dd-meta">
      <span class="dd-count" aria-live="polite"></span>
      <button type="button" class="dd-seltoggle" aria-pressed="false" title="Show only the rows selected so far">Selected only</button>
    </div>
    <div class="dd-list themed-scroll" id="${uid}-list" tabindex="-1" role="listbox" aria-multiselectable="true" aria-label="${escapeHtml(cfg.title)}"></div>`;
  const backdrop = document.createElement('div');
  backdrop.className = 'dd-backdrop';
  // Portal both to <body>: no ancestor stacking context or overflow can cover or clip the popover.
  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  const input: any = panel.querySelector('.dd-input');
  const list: any = panel.querySelector('.dd-list');
  const count: any = panel.querySelector('.dd-count');
  const qClear: any = panel.querySelector('.dd-qclear');
  const selToggle: any = panel.querySelector('.dd-seltoggle');

  let isOpen = false;
  let query = '';
  let selectedOnly = false;
  let activeId: string | null = null;
  let shown: DropdownItem[] = [];
  let closeTimer: any = 0;

  const optionId = (index: number) => `${uid}-o${index}`;
  const inRoot = (node: any) => Boolean(node && (panel.contains(node) || trigger.contains(node) || backdrop.contains(node)));

  function matches(item: DropdownItem): boolean {
    if (selectedOnly && !item.selected) return false;
    const tokens = normalizeSearchText(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return true;
    const text = normalizeSearchText(item.label);
    return tokens.every(token => text.includes(token));
  }

  function paintActive(scroll: boolean): void {
    const rows: any[] = [...list.querySelectorAll('.dd-opt')];
    let activeEl: any = null;
    rows.forEach(row => {
      const on = row.dataset.id === activeId;
      row.classList.toggle('is-active', on);
      if (on) activeEl = row;
    });
    if (activeEl) input.setAttribute('aria-activedescendant', activeEl.id);
    else input.removeAttribute('aria-activedescendant');
    if (scroll && activeEl) {
      const top = activeEl.offsetTop - list.offsetTop;
      if (top < list.scrollTop) list.scrollTop = top - 6;
      else if (top + activeEl.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + activeEl.offsetHeight - list.clientHeight + 6;
    }
  }

  function refresh(): void {
    const all = cfg.getItems();
    shown = all.filter(matches);
    if (!shown.some(item => item.id === activeId)) activeId = shown.length ? shown[0].id : null;
    const keepScroll = list.scrollTop;
    list.innerHTML = shown.length
      ? shown.map((item, i) => `
        <div class="dd-opt${item.count === 0 ? ' dd-zero' : ''}${item.locked ? ' dd-locked' : ''}" role="option" id="${optionId(i)}" data-id="${escapeHtml(item.id)}" aria-selected="${item.selected}"${item.locked ? ' aria-disabled="true" title="Always shown"' : ''}>
          <span class="dd-check">${DD_TICK}</span>
          <span class="dd-name" title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</span>
          ${item.badges || ''}
          <span class="dd-num" title="${escapeHtml(cfg.unit)}">${item.count}</span>
          ${item.locked ? `<span class="dd-only dd-only-ghost" aria-hidden="true">Only</span>` : `<button type="button" class="dd-only" data-only tabindex="-1" aria-label="Only ${escapeHtml(item.label)}">Only</button>`}
        </div>`).join('')
      : `<div class="dd-empty">${selectedOnly && !query.trim() ? `Nothing selected` : `No ${escapeHtml(cfg.noun)} match “${escapeHtml(query.trim())}”`}</div>`;
    list.scrollTop = keepScroll;
    const selectedTotal = all.filter(item => item.selected).length;
    const narrowed = Boolean(query.trim()) || selectedOnly;
    count.textContent = `${selectedTotal} of ${all.length} selected${narrowed ? ` · ${shown.filter(item => item.selected).length} of ${shown.length} shown` : ''}`;
    qClear.hidden = !query;
    selToggle.setAttribute('aria-pressed', String(selectedOnly));
    selToggle.classList.toggle('is-on', selectedOnly);
    paintActive(false);
  }

  function apply(op: 'all' | 'none' | 'toggle' | 'reset' | 'flip' | 'only', id = ''): void {
    const all = cfg.getItems();
    let next = new Set(all.filter(item => item.selected).map(item => item.id));
    const visible = shown.map(item => item.id);
    if (op === 'all') visible.forEach(v => next.add(v));
    else if (op === 'none') visible.forEach(v => next.delete(v));
    else if (op === 'toggle') visible.forEach(v => { if (next.has(v)) next.delete(v); else next.add(v); });
    else if (op === 'reset') next = new Set(all.map(item => item.id));
    else if (op === 'flip') { if (next.has(id)) next.delete(id); else next.add(id); }
    else if (op === 'only') next = new Set([id]);
    all.forEach(item => { if (item.locked) next.add(item.id); }); // locked rows stay selected whatever the operation
    cfg.onChange(next);
    refresh();
  }

  function place(): void {
    panel.style.left = '';
    panel.style.top = '';
    panel.style.bottom = '';
    panel.style.maxHeight = '';
    if (window.matchMedia('(max-width: 639px)').matches) return; // bottom sheet, positioned by CSS
    const rect = trigger.getBoundingClientRect();
    const width = panel.offsetWidth;
    const natural = panel.offsetHeight;
    const below = window.innerHeight - rect.bottom - 16;
    const above = rect.top - 16;
    const flip = below < Math.min(natural, 360) && above > below;
    panel.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
    panel.style.maxHeight = `${Math.max(180, flip ? above : below) - 8}px`;
    if (flip) {
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - rect.top + 8}px`;
      panel.style.transformOrigin = 'bottom left';
    } else {
      panel.style.top = `${rect.bottom + 8}px`;
      panel.style.transformOrigin = 'top left';
    }
  }

  function open(initialQuery = ''): void {
    if (isOpen) return;
    isOpen = true;
    clearTimeout(closeTimer);
    query = initialQuery;
    selectedOnly = false;
    input.value = initialQuery;
    const firstSelected = cfg.getItems().find(item => item.selected && matches(item));
    activeId = firstSelected ? firstSelected.id : null;
    refresh();
    panel.hidden = false;
    place();
    void panel.offsetWidth; // reflow so the transition starts from the closed state
    panel.classList.add('is-open');
    backdrop.classList.add('is-open');
    trigger.setAttribute('aria-expanded', 'true');
    input.focus({ preventScroll: true });
    input.setSelectionRange(input.value.length, input.value.length);
    const row: any = [...list.querySelectorAll('.dd-opt')].find((r: any) => r.dataset.id === activeId);
    if (row) list.scrollTop = Math.max(0, row.offsetTop - list.offsetTop - list.clientHeight / 3);
    paintActive(false);
  }

  function close(restoreFocus = false): void {
    if (!isOpen) return;
    isOpen = false;
    panel.classList.remove('is-open');
    backdrop.classList.remove('is-open');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { if (!isOpen) panel.hidden = true; }, reduceMotion() ? 0 : 200);
  }

  function move(delta: number): void {
    if (!shown.length) return;
    const index = shown.findIndex(item => item.id === activeId);
    const next = index < 0 ? (delta > 0 ? 0 : shown.length - 1) : (index + delta + shown.length) % shown.length;
    activeId = shown[next].id;
    paintActive(true);
  }

  function setQuery(value: string): void {
    query = value;
    list.scrollTop = 0;
    refresh();
  }

  trigger.addEventListener('click', () => { if (isOpen) close(); else open(); });
  trigger.addEventListener('keydown', (event: any) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); open(); }
    else if (event.key.length === 1 && event.key !== ' ') { event.preventDefault(); open(event.key); }
  });
  input.addEventListener('input', () => setQuery(input.value));
  input.addEventListener('keydown', (event: any) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      apply('all');
      return;
    }
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(1); break;
      case 'ArrowUp': event.preventDefault(); move(-1); break;
      case 'PageDown': event.preventDefault(); move(8); break;
      case 'PageUp': event.preventDefault(); move(-8); break;
      case 'Enter':
        event.preventDefault();
        if (activeId !== null && shown.some(item => item.id === activeId)) apply(event.shiftKey ? 'only' : 'flip', activeId);
        break;
      case ' ':
        if (!input.value && activeId !== null) { event.preventDefault(); apply('flip', activeId); }
        break;
      case 'Escape':
        event.preventDefault();
        event.stopPropagation();
        if (input.value) { input.value = ''; setQuery(''); } else close(true);
        break;
      default:
    }
  });
  panel.addEventListener('keydown', (event: any) => {
    if (event.key === 'Escape' && event.target !== input) { event.preventDefault(); event.stopPropagation(); close(true); }
  });
  list.addEventListener('mousedown', (event: any) => event.preventDefault()); // keep focus in the search field
  list.addEventListener('pointermove', (event: any) => {
    const row = event.target.closest && event.target.closest('.dd-opt');
    if (row && row.dataset.id !== activeId) { activeId = row.dataset.id; paintActive(false); }
  });
  list.addEventListener('click', (event: any) => {
    const row = event.target.closest && event.target.closest('.dd-opt');
    if (!row) return;
    apply(event.target.closest('[data-only]') ? 'only' : 'flip', row.dataset.id);
  });
  qClear.addEventListener('mousedown', (event: any) => event.preventDefault());
  qClear.addEventListener('click', () => { input.value = ''; setQuery(''); input.focus(); });
  panel.querySelector('.dd-close').addEventListener('click', () => close(true));
  backdrop.addEventListener('click', () => close());
  selToggle.addEventListener('click', () => { selectedOnly = !selectedOnly; list.scrollTop = 0; refresh(); input.focus({ preventScroll: true }); });
  panel.querySelectorAll('[data-act]').forEach((button: any) => {
    button.addEventListener('click', () => apply(button.dataset.act));
  });
  panel.addEventListener('focusout', (event: any) => {
    if (isOpen && event.relatedTarget && !inRoot(event.relatedTarget)) close();
  });
  document.addEventListener('pointerdown', (event: any) => {
    if (isOpen && !inRoot(event.target)) close();
  });
  window.addEventListener('resize', () => { if (isOpen) place(); });
  window.addEventListener('scroll', () => { if (isOpen) place(); }, { passive: true, capture: true });
  // The panel lives at the end of <body>, so Tab at its edges hands focus back to the page order around the trigger.
  panel.addEventListener('keydown', (event: any) => {
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('input, button')].filter((node: any) => node.tabIndex >= 0 && node.offsetParent !== null);
    if (!focusable.length) return;
    const edge = event.shiftKey ? focusable[0] : focusable[focusable.length - 1];
    if (event.target !== edge) return;
    event.preventDefault();
    close();
    if (event.shiftKey) { trigger.focus({ preventScroll: true }); return; }
    const page = Array.from(document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]'))
      .filter((node: any) => !panel.contains(node) && node.tabIndex >= 0 && !node.disabled && (node.offsetParent !== null || node === trigger));
    const next: any = page[page.indexOf(trigger) + 1];
    if (next) next.focus();
  });

  return { refresh, open, close, isOpen: () => isOpen };
}

export { createDropdown };
export type { Dropdown, DropdownItem };
