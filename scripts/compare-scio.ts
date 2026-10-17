#!/usr/bin/env bun
/// <reference types="bun" />
// Compares the reports of this app with the outputs of the scio-examples Scala jobs (sbt runMain io.github.daggerok.Main).
// Usage: bun scripts/compare-scio.ts [scio-examples dir] [runDate yyyy-MM-dd]
//   input:  <scio>/src/main/resources/input/*.csv (file N = the N-th file by name, like Commons.captureInputs)
//   output: <scio>/target/{dividends,DRIPs,investments}/N.csv and target/watchlist/<name>.{csv,txt}
// runDate is the day the Scala job ran (DRIPs show only dates after it); default: the date of target/DRIPs/1.csv.
// Beam gives no order to rows with equal sort keys: those reports are compared as a set of rows, plus the order of the keys.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport, readFidelityAccounts, reportText, todayIso, REPORT_KINDS } from '../src/reports';

const scio = process.argv[2] ?? '../scio-examples';
const inputDir = join(scio, 'src/main/resources/input');
const target = join(scio, 'target');
const runDate = process.argv[3] ?? todayIso(statSync(join(target, 'DRIPs/1.csv')).mtime);

const files = readdirSync(inputDir).filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.csv')).sort();
const accounts = files.flatMap(f => readFidelityAccounts(f, readFileSync(join(inputDir, f), 'utf8')) ?? []);

let passed = 0;
let failed = 0;
const exact: string[] = [];

function lines(text: string): string[] {
  return text.split('\n').filter(Boolean);
}

/** Same header, same set of rows; reports the first differences. */
function compare(label: string, expectedText: string, actualText: string, header: boolean): void {
  const e = lines(expectedText);
  const a = lines(actualText);
  if (expectedText === actualText) exact.push(label);
  const same = (!header || e[0] === a[0]) && [...e].sort().join('\n') === [...a].sort().join('\n');
  if (same) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label}: expected ${e.length} lines, got ${a.length}`);
  if (header && e[0] !== a[0]) console.log(`  header expected: ${e[0]}\n  header actual:   ${a[0]}`);
  e.filter(l => !a.includes(l)).slice(0, 5).forEach(l => console.log(`  - ${l}`));
  a.filter(l => !e.includes(l)).slice(0, 5).forEach(l => console.log(`  + ${l}`));
}

for (const { kind, folder } of REPORT_KINDS) {
  const sheets = buildReport(kind, accounts, runDate);
  if (kind !== 'watchlist') {
    sheets.forEach((sheet, i) => {
      const file = join(target, folder, `${i + 1}.csv`);
      if (sheet.error || !existsSync(file)) { failed += 1; console.log(`FAIL ${folder}/${i + 1}.csv: ${sheet.error ?? 'missing in target'}`); return; }
      compare(`${folder}/${i + 1}.csv (${sheet.title})`, readFileSync(file, 'utf8'), reportText(kind, sheet.table), true);
    });
    continue;
  }
  for (const sheet of sheets) {
    for (const ext of ['csv', 'txt']) {
      const file = join(target, folder, `${sheet.title}.${ext}`);
      if (!existsSync(file)) { failed += 1; console.log(`FAIL missing ${file}`); continue; }
      const expected = readFileSync(file, 'utf8');
      const actual = reportText(kind, sheet.table);
      // All, All ETFs, All Stocks: every file read with its own header (scio-examples fixed the one-header bug in
      // BuildFidelityAccountsWatchlistScioApp.combinedPipeline); equal market caps have no order, so compare as sets
      compare(`watchlist/${sheet.title}.${ext}`, expected, actual, false);
    }
  }
}

console.log(`runDate ${runDate}: ${passed} passed, ${failed} failed; byte-identical: ${exact.length}`);
process.exit(failed ? 1 : 0);
