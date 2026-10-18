/// <reference types="bun" />
// =========================================================================
// Fidelity Reports: Fidelity Portfolio_Positions CSV exports -> dividends, DRIPs, investments and watchlists,
// the reports of scio-examples (sbt runMain io.github.daggerok.Main), built in the browser.
//
// - Input tab: every input file as a table. At start the files of the repo data/ folder are loaded
//   (data/index.json lists them, `bun run build` copies data/ into dist/); Load files (or a drop on the
//   page) replaces them until the page is reloaded
// - Output tab: the reports, built in a web worker right after the input changes; a spinner sits on
//   each report tab until it is ready. "Output per: file" shows 1..N (one per account) and then the
//   4 reports, plus "All" for the 3 watchlists over every account; "Output per: report" shows the
//   4 reports and then 1..N (watchlist: All, All ETFs, All Stocks and one list per account by name)
// - Every table: sort (click a header: asc, desc, off), column types (badge, Shift+click resets),
//   filters under the headers (grammar of the ETF apps and Stocks), search, Columns menu,
//   Copy Tickers, Export .csv (the shown rows in scio format plus Market cap) and Export .txt (tickers)
// - Download all: one zip with the folders and file names of scio-examples target/ (dividends/1.csv,
//   DRIPs/1.csv, investments/1.csv, ..., watchlist/All.csv and All.txt, ...), the full reports in report order
// Same look as Stocks: plain DOM, Tailwind classes, the ui-std filter engine and dropdown blocks.
// =========================================================================
import {
  readFidelityAccounts, readTable, reportText, todayIso, COMBINED_WATCHLISTS, REPORT_KINDS,
  type Account, type ReportKind, type ReportSheet, type ReportTable,
} from './reports';
import {
  ALL_COL_TYPES, COL_TYPE_CLASSES, COL_TYPE_HELP, COL_TYPE_LABELS, COL_TYPE_NAMES, COL_TYPE_PLACEHOLDERS,
  compileFilter, detectColType, parseCellValue, type ColType,
} from './filter-engine';
import { createDropdown, type Dropdown } from './dropdown';
import { escapeHtml } from './html';
import { sanitizeText } from './sanitize';
import { strToU8, zipSync } from 'fflate';

// ---- 1. DOM, state, storage -----------------------------------------------------------------------

function byId(id: string): any {
  const node = document.getElementById(id);
  if (!node) throw new Error(`#${id} is missing in index.html`);
  return node;
}

const el = {
  subtitle: byId('app-subtitle'), mainTabs: byId('main-tabs'), fileCount: byId('file-count'), theme: byId('theme-toggle'),
  search: byId('search-input'), searchClear: byId('search-clear-btn'), groupBtn: byId('group-btn'), groupSummary: byId('group-summary'),
  columnsBtn: byId('columns-btn'), columnsPanel: byId('columns-panel'), columnsSummary: byId('columns-summary'), columnsBadge: byId('columns-badge'),
  filtersBtn: byId('filters-btn'), filtersSummary: byId('filters-summary'), filtersBadge: byId('filters-badge'), clearFilters: byId('clear-filters-btn'),
  runDateWrap: byId('run-date-wrap'), runDate: byId('run-date'), status: byId('status'),
  fileInput: byId('file-input'), loadBtn: byId('load-btn'), repoBtn: byId('repo-data-btn'),
  copyBtn: byId('copy-btn'), csvBtn: byId('export-csv-btn'), txtBtn: byId('export-txt-btn'), allBtn: byId('download-all-btn'),
  sub1: byId('sub-tabs-1'), sub2: byId('sub-tabs-2'), busy: byId('busy-overlay'), busyLabel: byId('busy-label'),
  scroll: byId('table-scroll'), head: byId('table-head'), body: byId('table-body'), drop: byId('drop-overlay'),
};

type InputFile = { name: string; text: string; table: ReportTable; accounts: Account[] | null };
type ReportState = { status: 'idle' | 'running' | 'done'; sheets: ReportSheet[]; error?: string };
type MainTab = 'input' | 'output';
type GroupBy = 'file' | 'report';
type TableSettings = { filters: Record<string, string>; types: Record<string, ColType>; hidden: string[] };
type SortState = { col: string; dir: 'asc' | 'desc' } | null;

const PREFIX = 'fidelity-reports';
const THEME_KEY = `${PREFIX}-theme`;
const VIEW_KEY = `${PREFIX}-view`;
const SHOW_FILTERS_KEY = `${PREFIX}-show-filters`;
const FILTER_DEBOUNCE_MS = 250;
const COMBINED = 'combined';
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

function lsSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* quota or private mode */ }
}

function lsJson(key: string, fallback: any): any {
  try { const raw = lsGet(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
}

const savedView = lsJson(VIEW_KEY, {});

const state = {
  files: [] as InputFile[],
  accounts: [] as Account[],
  source: 'repo' as 'repo' | 'loaded',
  repoFiles: [] as InputFile[],
  mainTab: (savedView.mainTab === 'input' ? 'input' : 'output') as MainTab,
  groupBy: (savedView.groupBy === 'report' ? 'report' : 'file') as GroupBy,
  inputFile: '',
  // the shown report: kind + sheet (an account id or a combined watchlist id); both output layouts share it
  kind: (REPORT_KINDS.some(k => k.kind === savedView.kind) ? savedView.kind : 'dividends') as ReportKind,
  sheet: typeof savedView.sheet === 'string' ? savedView.sheet : '',
  reports: Object.fromEntries(REPORT_KINDS.map(k => [k.kind, { status: 'idle', sheets: [] } as ReportState])) as Record<ReportKind, ReportState>,
  runDate: todayIso(),
  showFilters: lsGet(SHOW_FILTERS_KEY) !== 'off',
  search: '',
  sorts: {} as Record<string, SortState>,
  settings: {} as Record<string, TableSettings>,
};

function persistView(): void {
  lsSet(VIEW_KEY, JSON.stringify({ mainTab: state.mainTab, groupBy: state.groupBy, kind: state.kind, sheet: state.sheet }));
}

function settingsFor(scope: string): TableSettings {
  if (!state.settings[scope]) {
    const s = lsJson(`${PREFIX}-table-${scope}`, {});
    const strings = (v: any) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string')) : {});
    state.settings[scope] = {
      filters: strings(s.filters) as Record<string, string>,
      types: Object.fromEntries(Object.entries(strings(s.types)).filter(([, t]) => ALL_COL_TYPES.includes(t as ColType))) as Record<string, ColType>,
      hidden: Array.isArray(s.hidden) ? s.hidden.filter((x: unknown) => typeof x === 'string') : [],
    };
  }
  return state.settings[scope];
}

function saveSettings(scope: string): void {
  lsSet(`${PREFIX}-table-${scope}`, JSON.stringify(settingsFor(scope)));
}

function setStatus(text: string): void {
  el.status.textContent = text;
}

function setBusy(on: boolean, label = ''): void {
  if (label) el.busyLabel.textContent = label;
  el.busy.hidden = !on;
}

// ---- 2. Input files and the report worker -----------------------------------------------------------

/** Every file is masked first (AB1234567 -> *****4567), so a full account number is never kept or shown. */
function toInput(name: string, raw: string): InputFile {
  let text = raw;
  try {
    text = sanitizeText(raw).text;
  } catch (e) {
    // two accounts of one file end with the same 4 characters: mask the column completely
    text = raw.split(/(\r\n|\n|\r)/).map((line, i) => (i % 2 === 0 && /^\s*[A-Za-z0-9]{5,}\s*,/.test(line) && !/^\s*account number/i.test(line) ? line.replace(/^(\s*)[A-Za-z0-9]+/, (_, s) => `${s}*****`) : line)).join('');
    setStatus(`${name}: ${e instanceof Error ? e.message : String(e)}; the account numbers are hidden completely`);
  }
  return { name, text, table: readTable(text), accounts: readFidelityAccounts(name, text) };
}

let worker: Worker | null = null;
let jobId = 0;

/** New input: rebuild every report in the worker; each output tab spins until its report arrives. */
function setInput(files: InputFile[], source: 'repo' | 'loaded'): void {
  state.files = [...files].sort((a, b) => collator.compare(a.name, b.name));
  state.accounts = state.files.flatMap(f => f.accounts ?? []);
  state.source = source;
  if (!state.files.some(f => f.name === state.inputFile)) state.inputFile = state.files[0]?.name ?? '';
  runReports();
  render();
}

function runReports(): void {
  if (worker) worker.terminate();
  worker = null;
  jobId += 1;
  const id = jobId;
  for (const { kind } of REPORT_KINDS) state.reports[kind] = { status: state.accounts.length ? 'running' : 'idle', sheets: [] };
  if (!state.accounts.length) return;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<{ jobId: number; kind: ReportKind; sheets: ReportSheet[]; error?: string }>) => {
    if (e.data.jobId !== id) return;
    state.reports[e.data.kind] = { status: 'done', sheets: e.data.sheets, error: e.data.error };
    render();
  };
  worker.onerror = e => {
    for (const { kind } of REPORT_KINDS) if (state.reports[kind].status === 'running') state.reports[kind] = { status: 'done', sheets: [], error: e.message || 'The report worker failed' };
    render();
  };
  worker.postMessage({ jobId: id, accounts: state.accounts, runDate: state.runDate });
}

async function loadRepoData(): Promise<void> {
  setBusy(true, 'Loading the repo data…');
  try {
    const index = await (await fetch('data/index.json', { cache: 'no-cache' })).json();
    const names: string[] = Array.isArray(index.files) ? index.files.filter((n: unknown) => typeof n === 'string') : [];
    const files = await Promise.all(names.map(async name => toInput(name, await (await fetch(`data/${encodeURIComponent(name)}`, { cache: 'no-cache' })).text())));
    state.repoFiles = files;
    setInput(files, 'repo');
  } catch (e) {
    setStatus(`Could not load the repo data (${e instanceof Error ? e.message : String(e)}): load files instead`);
    setInput([], 'repo');
  } finally {
    setBusy(false);
  }
}

async function loadFiles(list: FileList | File[]): Promise<void> {
  const picked = [...list].filter(f => /\.csv$/i.test(f.name) || f.type.includes('csv'));
  if (!picked.length) { setStatus('Only .csv files can be loaded'); return; }
  const loaded = await Promise.all(picked.map(async f => toInput(f.name, await f.text())));
  // the first load replaces the repo data; more loads add files (a file with the same name is replaced)
  const keep = state.source === 'loaded' ? state.files.filter(f => !loaded.some(l => l.name === f.name)) : [];
  state.inputFile = loaded[0].name;
  setInput([...keep, ...loaded], 'loaded');
  const plain = loaded.filter(f => !f.accounts).map(f => f.name);
  setStatus(plain.length ? `Not a Fidelity positions export (shown on Input, not in the reports): ${plain.join(', ')}` : `${loaded.length} file${loaded.length === 1 ? '' : 's'} loaded`);
}

// ---- 3. What the output tabs show ------------------------------------------------------------------

type Tab = { id: string; label: string; sub?: string; title?: string; busy?: boolean; warn?: boolean };

const kindLabel = (kind: ReportKind) => REPORT_KINDS.find(k => k.kind === kind)?.label ?? kind;
const isCombined = (sheet: string) => COMBINED_WATCHLISTS.some(w => w.id === sheet);

function accountTabs(): Tab[] {
  return state.accounts.map((a, i) => ({ id: a.id, label: String(i + 1), sub: a.name, title: `${a.name} (${a.number}) from ${a.fileName}` }));
}

/** The sheet ids of a report in tab order: watchlist = All, All ETFs, All Stocks, then the accounts by name (like scio target/watchlist). */
function sheetTabs(kind: ReportKind): Tab[] {
  if (kind !== 'watchlist') return accountTabs();
  const sheets = state.reports.watchlist.sheets;
  const name = (id: string) => sheets.find(s => s.id === id)?.title ?? state.accounts.find(a => a.id === id)?.name ?? id;
  const combined = COMBINED_WATCHLISTS.map(w => ({ id: w.id, label: w.title, title: `${w.title}: every account` }));
  const accounts = state.accounts.map(a => ({ id: a.id, label: name(a.id), title: `${a.name} (${a.number})` })).sort((x, y) => collator.compare(x.label, y.label));
  return [...combined, ...accounts];
}

/** Keeps kind + sheet pointing at something that exists (e.g. after new input). */
function normalizeSelection(): void {
  const ids = new Set(state.accounts.map(a => a.id));
  if (isCombined(state.sheet)) state.kind = 'watchlist';
  else if (!ids.has(state.sheet)) state.sheet = state.accounts[0]?.id ?? '';
}

function activeSheet(): ReportSheet | null {
  return state.reports[state.kind].sheets.find(s => s.id === state.sheet) ?? null;
}

// ---- 4. Rendering: tabs ----------------------------------------------------------------------------

const PILL_ACTIVE = 'bg-blue-600 text-white font-medium border-blue-500 shadow-xs';
const PILL_IDLE = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 border-slate-200 dark:border-slate-700';

function pills(container: any, tabs: Tab[], active: string, onPick: (id: string) => void, big = false): void {
  container.innerHTML = tabs.map(tab => `<button type="button" role="tab" data-tab="${escapeHtml(tab.id)}" aria-selected="${tab.id === active}"${tab.title ? ` title="${escapeHtml(tab.title)}"` : ''}
    class="${big ? 'px-4 py-1.5 text-sm' : 'px-3.5 py-1.5 text-xs'} rounded-full transition border whitespace-nowrap ${tab.id === active ? PILL_ACTIVE : PILL_IDLE}">${tab.warn ? '⚠ ' : ''}<span class="tab-num">${escapeHtml(tab.label)}</span>${tab.sub ? `<span class="tab-sub">${escapeHtml(tab.sub)}</span>` : ''}${tab.busy ? '<span class="tab-spin" aria-label="building"></span>' : ''}</button>`).join('');
  container.querySelectorAll('button[data-tab]').forEach((button: any) => button.addEventListener('click', () => onPick(button.dataset.tab)));
}

function anyRunning(): boolean {
  return REPORT_KINDS.some(k => state.reports[k.kind].status === 'running');
}

function renderTabs(): void {
  pills(el.mainTabs, [
    { id: 'input', label: 'Input', sub: String(state.files.length) },
    { id: 'output', label: 'Output', busy: anyRunning() },
  ], state.mainTab, id => { state.mainTab = id === 'input' ? 'input' : 'output'; state.search = ''; el.search.value = ''; persistView(); render(); }, true);

  if (state.mainTab === 'input') {
    pills(el.sub1, state.files.map((f, i) => ({ id: f.name, label: String(i + 1), sub: f.name, warn: !f.accounts, title: f.accounts ? f.accounts.map(a => `${a.name} (${a.number})`).join(', ') : 'Not a Fidelity positions export: not used in the reports' })),
      state.inputFile, id => { state.inputFile = id; render(); });
    el.sub2.innerHTML = '';
    el.sub2.hidden = true;
    return;
  }
  el.sub2.hidden = false;
  normalizeSelection();
  const kindTabs = (): Tab[] => REPORT_KINDS.map(k => ({ id: k.kind, label: k.label, busy: state.reports[k.kind].status === 'running' }));
  const pickKind = (id: string) => {
    state.kind = id as ReportKind;
    if (state.kind !== 'watchlist' && isCombined(state.sheet)) state.sheet = state.accounts[0]?.id ?? '';
    persistView(); render();
  };
  const pickSheet = (id: string) => { state.sheet = id; if (isCombined(id)) state.kind = 'watchlist'; persistView(); render(); };
  if (state.groupBy === 'file') {
    // level 1: 1..N and All (the watchlists over every account), level 2: the 4 reports (or the 3 combined watchlists)
    const level1 = [...accountTabs(), { id: COMBINED, label: 'All', sub: 'accounts', title: 'Watchlists over every account: All, All ETFs, All Stocks', busy: state.reports.watchlist.status === 'running' }];
    pills(el.sub1, level1, isCombined(state.sheet) ? COMBINED : state.sheet, id => pickSheet(id === COMBINED ? (isCombined(state.sheet) ? state.sheet : COMBINED_WATCHLISTS[0].id) : id));
    if (isCombined(state.sheet)) pills(el.sub2, COMBINED_WATCHLISTS.map(w => ({ id: w.id, label: w.title, busy: state.reports.watchlist.status === 'running' })), state.sheet, pickSheet);
    else pills(el.sub2, kindTabs(), state.kind, pickKind);
  } else {
    // level 1: the 4 reports, level 2: 1..N (watchlist: All, All ETFs, All Stocks and the accounts by name)
    pills(el.sub1, kindTabs(), state.kind, pickKind);
    pills(el.sub2, sheetTabs(state.kind), state.sheet, pickSheet);
  }
}

// ---- 5. Rendering: the table ----------------------------------------------------------------------

type View = { scope: string; table: ReportTable; exportName: string; exportKind: ReportKind | 'input'; message: string };

function currentView(): View {
  if (state.mainTab === 'input') {
    const file = state.files.find(f => f.name === state.inputFile);
    if (!file) return { scope: 'input', table: { columns: [], rows: [] }, exportName: 'input', exportKind: 'input', message: 'No input files: load Fidelity Portfolio_Positions CSV files (or drop them on the page)' };
    return { scope: 'input', table: file.table, exportName: file.name.replace(/\.csv$/i, ''), exportKind: 'input', message: file.table.rows.length ? '' : 'This file has no table' };
  }
  const report = state.reports[state.kind];
  const empty = { columns: [], rows: [] };
  if (!state.accounts.length) return { scope: state.kind, table: empty, exportName: '', exportKind: state.kind, message: 'No Fidelity positions files in the input' };
  if (report.status === 'running') return { scope: state.kind, table: empty, exportName: '', exportKind: state.kind, message: `Building ${kindLabel(state.kind)}…` };
  const sheet = activeSheet();
  if (report.error || !sheet || sheet.error) return { scope: state.kind, table: empty, exportName: '', exportKind: state.kind, message: report.error ?? sheet?.error ?? 'Nothing to show' };
  const folder = REPORT_KINDS.find(k => k.kind === state.kind)?.folder ?? state.kind;
  const index = state.accounts.findIndex(a => a.id === sheet.id);
  const name = state.kind === 'watchlist' ? sheet.title : String(index + 1); // the scio target file name
  return { scope: state.kind, table: sheet.table, exportName: `${folder}-${name}`, exportKind: state.kind, message: sheet.table.rows.length ? '' : 'Nothing in this report' };
}

type Prepared = { view: View; types: ColType[]; detected: ColType[]; values: number[][]; shown: number[]; symbolCol: number };

let prepared: Prepared | null = null;

function prepare(): Prepared {
  const view = currentView();
  const { columns, rows } = view.table;
  const settings = settingsFor(view.scope);
  const detected = columns.map((_, i) => detectColType(rows.map(r => r[i] ?? '')));
  const types = columns.map((c, i) => settings.types[c] ?? detected[i]);
  const values = columns.map((_, i) => rows.map(r => parseCellValue(r[i] ?? '', types[i])));
  const filters = columns.map((c, i) => compileFilter(settings.filters[c] ?? '', types[i]));
  const terms = state.search.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = rows.map((_, r) => r).filter(r => {
    for (let i = 0; i < columns.length; i += 1) {
      const f = filters[i];
      if (f && f.ok && !f.test(values[i][r], (rows[r][i] ?? '').toLowerCase())) return false;
    }
    if (!terms.length) return true;
    const line = rows[r].join(' ').toLowerCase();
    return terms.every(t => line.includes(t));
  });
  const sort = state.sorts[view.scope];
  const c = sort ? columns.indexOf(sort.col) : -1;
  if (sort && c >= 0) {
    const sign = sort.dir === 'asc' ? 1 : -1;
    shown = shown.map((r, i) => ({ r, i })).sort((a, b) => {
      if (types[c] === 'string') {
        const x = rows[a.r][c] ?? '';
        const y = rows[b.r][c] ?? '';
        if (!x !== !y) return x ? -1 : 1; // empty cells last
        return sign * collator.compare(x, y) || a.i - b.i;
      }
      const x = values[c][a.r];
      const y = values[c][b.r];
      if (Number.isNaN(x) !== Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1; // unavailable values last
      return (Number.isNaN(x) ? 0 : sign * (x - y)) || a.i - b.i;
    }).map(x => x.r);
  }
  return { view, types, detected, values, shown, symbolCol: columns.findIndex(col => col.toLowerCase() === 'symbol') };
}

function visibleColumns(p: Prepared): number[] {
  const hidden = settingsFor(p.view.scope).hidden;
  return p.view.table.columns.map((_, i) => i).filter(i => i === p.symbolCol || !hidden.includes(p.view.table.columns[i]));
}

function headHtml(p: Prepared): string {
  const { columns } = p.view.table;
  const scope = p.view.scope;
  const settings = settingsFor(scope);
  const sort = state.sorts[scope];
  const cols = visibleColumns(p);
  const head = cols.map(i => {
    const c = columns[i];
    const numeric = p.types[i] !== 'string';
    const arrow = sort?.col === c ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    const overridden = p.types[i] !== p.detected[i];
    const badgeTitle = `Column type: ${COL_TYPE_NAMES[p.types[i]]} (${overridden ? 'set by you, detected: ' + COL_TYPE_NAMES[p.detected[i]] : 'auto-detected'}). Click to cycle the type, Shift+click to return to auto-detection.`;
    const badge = `<button type="button" data-type-col="${i}" title="${escapeHtml(badgeTitle)}" class="type-badge ${COL_TYPE_CLASSES[p.types[i]]}${overridden ? ' is-override' : ''}">${COL_TYPE_LABELS[p.types[i]]}</button>`;
    return `<th class="py-3.5 px-4${numeric ? ' text-right' : ''}"><div class="flex items-center gap-1.5${numeric ? ' justify-end' : ''}"><button data-sort="${i}" title="Sort by ${escapeHtml(c)}: ascending, descending, off" class="uppercase tracking-wider hover:text-blue-600 dark:hover:text-blue-400 focus:outline-hidden focus:text-blue-600 dark:focus:text-blue-400">${escapeHtml(c)}${arrow}</button>${badge}</div></th>`;
  }).join('');
  let html = `<tr><th class="py-3.5 px-4 w-12 text-center" title="Row index">#</th>${head}</tr>`;
  if (state.showFilters) {
    html += `<tr class="filter-row"><th></th>${cols.map(i => {
      const c = columns[i];
      const expression = settings.filters[c] ?? '';
      const compiled = expression.trim() ? compileFilter(expression, p.types[i]) : null;
      const error = compiled && !compiled.ok ? compiled.error : '';
      const help = `${error ? 'Cannot apply this filter: ' + error + '. ' : ''}${COL_TYPE_HELP[p.types[i]]}`;
      return `<th class="filter-cell"><div class="filter-wrap"><input type="text" data-filter-col="${i}" value="${escapeHtml(expression)}" placeholder="${escapeHtml(COL_TYPE_PLACEHOLDERS[p.types[i]])}" spellcheck="false" autocomplete="off" aria-label="Filter ${escapeHtml(c)}" title="${escapeHtml(help)}" class="filter-input${expression.trim() ? ' is-active' : ''}${error ? ' is-invalid' : ''}" /><button type="button" data-clear-filter="${i}" class="filter-clear" title="Clear this filter" aria-label="Clear the ${escapeHtml(c)} filter"${expression.trim() ? '' : ' hidden'}>✕</button></div></th>`;
    }).join('')}</tr>`;
  }
  return html;
}

function bodyHtml(p: Prepared): string {
  const { rows } = p.view.table;
  if (p.view.message) return `<tr><td colspan="99" class="py-12 text-center text-slate-400 dark:text-slate-500">${escapeHtml(p.view.message)}</td></tr>`;
  if (!p.shown.length) return `<tr><td colspan="99" class="py-12 text-center text-slate-400 dark:text-slate-500">No rows match the filters</td></tr>`;
  const cols = visibleColumns(p);
  return p.shown.map((r, n) => `<tr class="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"><td class="py-2 px-4 text-center text-xs text-slate-400 dark:text-slate-500">${n + 1}</td>${cols.map(i => {
    const numeric = p.types[i] !== 'string';
    return `<td class="py-2 px-4${numeric ? ' text-right tabular-nums' : ''}${i === p.symbolCol ? ' font-semibold text-slate-900 dark:text-white' : ' text-slate-600 dark:text-slate-300'}">${escapeHtml(rows[r][i] ?? '')}</td>`;
  }).join('')}</tr>`).join('');
}

/** Rows only (filters, search): the header with its focused filter input stays in place. */
function renderRows(): void {
  prepared = prepare();
  el.body.innerHTML = bodyHtml(prepared);
  renderToolbar();
}

function renderTable(): void {
  prepared = prepare();
  el.head.innerHTML = prepared.view.table.columns.length ? headHtml(prepared) : '';
  el.body.innerHTML = bodyHtml(prepared);
}

let columnsDropdown: Dropdown | null = null;

function renderToolbar(): void {
  const p = prepared;
  const total = p ? p.view.table.rows.length : 0;
  const shown = p ? p.shown.length : 0;
  const scope = p ? p.view.scope : 'input';
  const settings = settingsFor(scope);
  const columns = p ? p.view.table.columns : [];
  const filterCount = Object.entries(settings.filters).filter(([c, v]) => v.trim() && columns.includes(c)).length;
  const hiddenCount = columns.filter(c => settings.hidden.includes(c) && c !== columns[p?.symbolCol ?? -1]).length;
  el.columnsSummary.textContent = `${columns.length - hiddenCount} of ${columns.length}`;
  el.columnsBadge.hidden = hiddenCount === 0;
  el.columnsBadge.textContent = String(hiddenCount);
  el.filtersSummary.textContent = state.showFilters ? 'on' : 'off';
  el.filtersBtn.setAttribute('aria-pressed', String(state.showFilters));
  el.filtersBadge.hidden = filterCount === 0;
  el.filtersBadge.textContent = String(filterCount);
  el.clearFilters.hidden = !(filterCount || state.search || state.sorts[scope]);
  el.groupBtn.hidden = state.mainTab !== 'output';
  el.groupSummary.textContent = state.groupBy;
  el.runDateWrap.hidden = !(state.mainTab === 'output' && state.kind === 'drips');
  el.runDate.value = state.runDate;
  el.searchClear.classList.toggle('hidden', !state.search);
  el.repoBtn.hidden = state.source === 'repo' || !state.repoFiles.length;
  const usable = !!p && !p.view.message && shown > 0;
  el.copyBtn.disabled = !usable || (p?.symbolCol ?? -1) < 0;
  el.csvBtn.disabled = !usable;
  el.txtBtn.disabled = !usable || (p?.symbolCol ?? -1) < 0;
  el.allBtn.disabled = !state.accounts.length || REPORT_KINDS.some(k => state.reports[k.kind].status !== 'done');
  const accounts = state.accounts.length;
  el.fileCount.textContent = `${state.files.length} file${state.files.length === 1 ? '' : 's'}`;
  el.fileCount.title = `${accounts} account${accounts === 1 ? '' : 's'}; ${state.source === 'repo' ? 'the repo data/ folder' : 'loaded files'}`;
  el.subtitle.textContent = `${state.source === 'repo' ? 'Repo data' : 'Loaded files'}: ${accounts} accounts${anyRunning() ? ', building reports…' : ''}${p && !p.view.message ? ` · ${shown === total ? `${total} rows` : `${shown} of ${total} rows`}` : ''}`;
  if (columnsDropdown) columnsDropdown.refresh();
}

function render(): void {
  renderTabs();
  renderTable();
  renderToolbar();
  fitTableHeight();
}

function fitTableHeight(): void {
  const rect = el.scroll.getBoundingClientRect();
  const card = el.scroll.parentElement;
  const main = document.querySelector('main');
  const footer = document.querySelector('footer');
  const below = (card ? parseFloat(getComputedStyle(card).borderBottomWidth) : 0) + (main ? parseFloat(getComputedStyle(main).paddingBottom) : 0) + (footer ? footer.getBoundingClientRect().height : 0);
  el.scroll.style.maxHeight = `${Math.max(240, window.innerHeight - rect.top - below)}px`;
}

// ---- 6. Exports ------------------------------------------------------------------------------------

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const csvCell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_');

function shownTickers(p: Prepared): string[] {
  return p.symbolCol < 0 ? [] : p.shown.map(r => p.view.table.rows[r][p.symbolCol]).filter(Boolean);
}

/** The shown rows in their shown order; reports in the scio output format (watchlist: one ticker per line). */
function exportCsv(): void {
  if (!prepared) return;
  const { view, shown } = prepared;
  const table = { ...view.table, rows: shown.map(r => view.table.rows[r]) };
  const text = view.exportKind === 'input'
    ? [table.columns, ...table.rows].map(r => r.map(csvCell).join(',')).join('\n') + '\n'
    : reportText(view.exportKind, table, true); // what the table shows, with Market cap; Download all keeps the scio format
  download(`${safeName(view.exportName)}.csv`, text, 'text/csv');
}

/** Every report, unfiltered and in report order, laid out like scio-examples target/ (file N = account N). */
function downloadAll(): void {
  const entries: Record<string, Uint8Array> = {};
  for (const { kind, folder } of REPORT_KINDS) {
    for (const sheet of state.reports[kind].sheets) {
      if (sheet.error) continue;
      const text = strToU8(reportText(kind, sheet.table));
      if (kind === 'watchlist') {
        entries[`${folder}/${safeName(sheet.title)}.csv`] = text;
        entries[`${folder}/${safeName(sheet.title)}.txt`] = text;
      } else {
        entries[`${folder}/${state.accounts.findIndex(a => a.id === sheet.id) + 1}.csv`] = text;
      }
    }
  }
  const zip = zipSync(entries);
  const url = URL.createObjectURL(new Blob([zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `fidelity-reports-${state.runDate}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  setStatus(`${Object.keys(entries).length} files in fidelity-reports-${state.runDate}.zip`);
}

// ---- 7. Events -------------------------------------------------------------------------------------

const filterTimers = new Map<string, ReturnType<typeof setTimeout>>();

function setFilter(index: number, value: string, immediate: boolean): void {
  if (!prepared) return;
  const scope = prepared.view.scope;
  const column = prepared.view.table.columns[index];
  const key = `${scope}:${column}`;
  const timer = filterTimers.get(key);
  if (timer) clearTimeout(timer);
  const apply = () => {
    const settings = settingsFor(scope);
    if (value.trim()) settings.filters[column] = value; else delete settings.filters[column];
    saveSettings(scope);
    const input = el.head.querySelector(`input[data-filter-col="${index}"]`);
    if (input) {
      const compiled = value.trim() ? compileFilter(value, prepared?.types[index] ?? 'string') : null;
      input.classList.toggle('is-active', !!value.trim());
      input.classList.toggle('is-invalid', !!compiled && !compiled.ok);
      if (compiled && !compiled.ok) input.title = `Cannot apply this filter: ${compiled.error}`;
      const clear = input.parentElement?.querySelector('[data-clear-filter]');
      if (clear) clear.hidden = !value.trim();
    }
    renderRows();
  };
  if (immediate) apply(); else filterTimers.set(key, setTimeout(apply, FILTER_DEBOUNCE_MS));
}

function initEvents(): void {
  el.theme.addEventListener('click', () => {
    const dark = !document.documentElement.classList.contains('dark');
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.backgroundColor = dark ? '#020617' : '#f8fafc';
    el.theme.textContent = dark ? '☀️' : '🌙';
    lsSet(THEME_KEY, dark ? 'dark' : 'light');
  });
  el.theme.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';

  el.head.addEventListener('click', (event: any) => {
    const sortBtn = event.target.closest('[data-sort]');
    const typeBtn = event.target.closest('[data-type-col]');
    const clearBtn = event.target.closest('[data-clear-filter]');
    if (!prepared) return;
    const scope = prepared.view.scope;
    if (sortBtn) {
      const col = prepared.view.table.columns[Number(sortBtn.dataset.sort)];
      const sort = state.sorts[scope];
      state.sorts[scope] = sort?.col !== col ? { col, dir: 'asc' } : sort.dir === 'asc' ? { col, dir: 'desc' } : null;
      renderTable(); renderToolbar();
    } else if (typeBtn) {
      const i = Number(typeBtn.dataset.typeCol);
      const col = prepared.view.table.columns[i];
      const settings = settingsFor(scope);
      if (event.shiftKey) delete settings.types[col];
      else {
        const next = ALL_COL_TYPES[(ALL_COL_TYPES.indexOf(prepared.types[i]) + 1) % ALL_COL_TYPES.length];
        if (next === prepared.detected[i]) delete settings.types[col]; else settings.types[col] = next;
      }
      saveSettings(scope);
      renderTable(); renderToolbar();
    } else if (clearBtn) {
      const i = Number(clearBtn.dataset.clearFilter);
      const input = el.head.querySelector(`input[data-filter-col="${i}"]`);
      if (input) input.value = '';
      setFilter(i, '', true);
    }
  });
  el.head.addEventListener('input', (event: any) => {
    const input = event.target.closest('input[data-filter-col]');
    if (input) setFilter(Number(input.dataset.filterCol), input.value, false);
  });

  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  el.search.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.search = el.search.value; renderRows(); }, FILTER_DEBOUNCE_MS);
  });
  el.searchClear.addEventListener('click', () => { el.search.value = ''; state.search = ''; renderRows(); el.search.focus(); });

  el.groupBtn.addEventListener('click', () => { state.groupBy = state.groupBy === 'file' ? 'report' : 'file'; persistView(); render(); });
  el.filtersBtn.addEventListener('click', () => { state.showFilters = !state.showFilters; lsSet(SHOW_FILTERS_KEY, state.showFilters ? 'on' : 'off'); render(); });
  el.clearFilters.addEventListener('click', () => {
    if (!prepared) return;
    const scope = prepared.view.scope;
    settingsFor(scope).filters = {};
    saveSettings(scope);
    state.sorts[scope] = null;
    state.search = '';
    el.search.value = '';
    render();
  });
  el.runDate.addEventListener('change', () => {
    if (!el.runDate.value || el.runDate.value === state.runDate) return;
    state.runDate = el.runDate.value;
    runReports();
    render();
  });

  columnsDropdown = createDropdown({
    trigger: el.columnsBtn,
    panel: el.columnsPanel,
    title: 'Columns',
    noun: 'columns',
    unit: 'position',
    getItems: () => {
      if (!prepared) return [];
      const { columns } = prepared.view.table;
      const hidden = settingsFor(prepared.view.scope).hidden;
      return columns.map((c, i) => ({ id: c, label: c, count: i + 1, selected: i === prepared?.symbolCol || !hidden.includes(c), locked: i === prepared?.symbolCol }));
    },
    onChange: selected => {
      if (!prepared) return;
      const scope = prepared.view.scope;
      settingsFor(scope).hidden = prepared.view.table.columns.filter(c => !selected.has(c));
      saveSettings(scope);
      renderTable(); renderToolbar();
    },
  });

  el.loadBtn.addEventListener('click', () => el.fileInput.click());
  el.fileInput.addEventListener('change', () => { if (el.fileInput.files?.length) loadFiles(el.fileInput.files); el.fileInput.value = ''; });
  el.repoBtn.addEventListener('click', () => { setInput(state.repoFiles, 'repo'); setStatus('Back to the repo data'); });
  el.copyBtn.addEventListener('click', () => {
    if (!prepared) return;
    const list = shownTickers(prepared);
    navigator.clipboard?.writeText(list.join('\n')).then(() => setStatus(`${list.length} tickers copied`), () => setStatus('The clipboard is blocked'));
  });
  el.csvBtn.addEventListener('click', exportCsv);
  el.allBtn.addEventListener('click', downloadAll);
  el.txtBtn.addEventListener('click', () => { if (prepared) download(`${safeName(prepared.view.exportName)}.txt`, shownTickers(prepared).map(t => `${t}\n`).join(''), 'text/plain'); });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) { dragDepth += 1; el.drop.hidden = false; } });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) el.drop.hidden = true; });
  window.addEventListener('dragover', (e: DragEvent) => e.preventDefault());
  window.addEventListener('drop', (e: DragEvent) => {
    e.preventDefault();
    dragDepth = 0;
    el.drop.hidden = true;
    if (e.dataTransfer?.files.length) loadFiles(e.dataTransfer.files);
  });
  window.addEventListener('resize', fitTableHeight);
  new ResizeObserver(fitTableHeight).observe(document.getElementById('top-panels') ?? document.body);
}

initEvents();
render();
loadRepoData();
