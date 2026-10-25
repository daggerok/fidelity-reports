#!/usr/bin/env bun
/// <reference types="bun" />
// Compares the reports of this app with the outputs of the scio-examples Scala jobs (sbt runMain io.github.daggerok.Main).
// Usage: bun scripts/compare-scio.ts [scio-examples dir] [runDate yyyy-MM-dd]
//   input:  <scio>/src/main/resources/input/*.csv (file N = the N-th file by name, like Commons.captureInputs)
//   output: <scio>/target/{dividends,DRIPs,investments}/N.csv and target/watchlist/<name>.{csv,txt}
// runDate is the day the Scala job ran (DRIPs show only dates after it); default: the date of target/DRIPs/1.csv.
// Investments and DRIPs must be byte-identical. Dividends and watchlists have rows with equal sort keys, which Beam
// gives no order: same header, same set of rows and the same sequence of sort keys (scripts/compare-report.ts).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildReport, parseMarketCap, readFidelityAccounts, reportText, todayIso, REPORT_KINDS } from '../src/reports';
import { compareReport, type OrderCheck } from './compare-report';

const scio = process.argv[2] ?? '../scio-examples';
const inputDir = join(scio, 'src/main/resources/input');
const target = join(scio, 'target');
const runDate = process.argv[3] ?? todayIso(statSync(join(target, 'DRIPs/1.csv')).mtime);

const files = readdirSync(inputDir).filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.csv')).sort();
const accounts = files.flatMap(f => readFidelityAccounts(f, readFileSync(join(inputDir, f), 'utf8')) ?? []);

let passed = 0;
let failed = 0;
const exact: string[] = [];

function compare(label: string, expectedText: string, actualText: string, check: OrderCheck): void {
  if (expectedText === actualText) exact.push(label);
  const problems = compareReport(expectedText, actualText, check);
  if (!problems.length) { passed += 1; return; }
  failed += 1;
  console.log(`FAIL ${label} (${check.kind === 'bytes' ? 'must be byte-identical' : 'rows as a set, sort keys in order'})`);
  problems.forEach(p => console.log(`  ${p}`));
}

// dividends sort by the first diff column (the 7th, after Symbol..Shares)
const dividendsCheck: OrderCheck = { kind: 'keys', header: true, key: line => line.split(',')[6] ?? '' };

for (const { kind, folder } of REPORT_KINDS) {
  const sheets = buildReport(kind, accounts, runDate);
  if (kind !== 'watchlist') {
    const check: OrderCheck = kind === 'dividends' ? dividendsCheck : { kind: 'bytes' };
    sheets.forEach((sheet, i) => {
      const file = join(target, folder, `${i + 1}.csv`);
      if (sheet.error || !existsSync(file)) { failed += 1; console.log(`FAIL ${folder}/${i + 1}.csv: ${sheet.error ?? 'missing in target'}`); return; }
      compare(`${folder}/${i + 1}.csv (${sheet.title})`, readFileSync(file, 'utf8'), reportText(kind, sheet.table), check);
    });
    continue;
  }
  for (const sheet of sheets) {
    // watchlists list tickers by market cap, largest first: the cap of each ticker is the sort key
    const caps = new Map(sheet.table.rows.map(([ticker, capText]) => [ticker, String(parseMarketCap(capText))]));
    const check: OrderCheck = { kind: 'keys', header: false, key: ticker => caps.get(ticker) ?? `? (${ticker} not in this report)` };
    for (const ext of ['csv', 'txt']) {
      const file = join(target, folder, `${sheet.title}.${ext}`);
      if (!existsSync(file)) { failed += 1; console.log(`FAIL missing ${file}`); continue; }
      // All, All ETFs, All Stocks: every file read with its own header (scio-examples fixed the one-header bug in
      // BuildFidelityAccountsWatchlistScioApp.combinedPipeline)
      compare(`watchlist/${sheet.title}.${ext}`, readFileSync(file, 'utf8'), reportText(kind, sheet.table), check);
    }
  }
}

console.log(`runDate ${runDate}: ${passed} passed, ${failed} failed; byte-identical: ${exact.length}`);
process.exit(failed ? 1 : 0);
