#!/usr/bin/env bun
/// <reference types="bun" />
// Masks the account numbers of the Fidelity exports in data/ (or the given files): AB1234567 -> *****4567
// (every character but the last 4; the masking itself is src/sanitize.ts, the app applies it to every loaded file).
// Only the "Account number" column changes; every other byte of the file (quotes, spaces, CRLF) stays as it was,
// so the reports are the same. Already masked values (*****4567, *0043) are kept, a second run changes nothing.
//
//   bun scripts/sanitize-data.ts                 mask data/*.csv in place
//   bun scripts/sanitize-data.ts a.csv b.csv     mask these files in place
//   bun scripts/sanitize-data.ts --check         exit 1 when a file in data/ still has a full account number, or any
//                                                file of the repo (tracked or new) holds something shaped like one
//   bun scripts/sanitize-data.ts --check-dist    the same scan over the built site (dist/), run after every build
//   bun scripts/sanitize-data.ts --check-history exit 1 when any commit ever had one (run before a public push)
//
// The values are never printed (only file, line and column), see the workspace no-secrets rule.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { accountLikeLines, sanitizeText } from '../src/sanitize';

/** Files never scanned for account-like numbers: the lockfile (hashes) and binaries. */
const SKIP = /(^|\/)bun\.lock$|\.(ico|png|jpe?g|gif|zip|woff2?)$/i;

function report(label: string, lines: number[]): void {
  console.log(`ACCOUNT-LIKE ${label}: ${lines.length} lines (first at line ${lines[0]})`);
}

/** Every file of the repo that git would commit (tracked and new, not ignored). */
function scanRepo(): number {
  let bad = 0;
  for (const path of git(['ls-files', '-co', '--exclude-standard']).split('\n').filter(p => p && !SKIP.test(p))) {
    let text = '';
    try { text = readFileSync(join(ROOT, path), 'utf8'); } catch { continue; } // deleted in the working tree
    const lines = accountLikeLines(text);
    if (lines.length) { bad += 1; report(path, lines); }
  }
  return bad;
}

function walk(dir: string): string[] {
  return readdirSync(dir).sort().flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const ROOT = join(import.meta.dir, '..');
const DATA = join(ROOT, 'data');

function dataFiles(): string[] {
  return readdirSync(DATA).filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.csv')).sort().map(f => join(DATA, f));
}

function git(args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

function main(argv: string[]): number {
  if (argv.includes('--check-dist')) {
    const dist = join(ROOT, 'dist');
    let bad = 0;
    for (const file of walk(dist).filter(f => !SKIP.test(f))) {
      const lines = accountLikeLines(readFileSync(file, 'utf8'));
      if (lines.length) { bad += 1; report(relative(ROOT, file), lines); }
    }
    console.log(bad ? `the built site has account-like numbers in ${bad} files: do not publish it` : 'dist: no account-like numbers');
    return bad ? 1 : 0;
  }
  if (argv.includes('--check-history')) {
    let bad = 0;
    for (const commit of git(['rev-list', '--all']).split('\n').filter(Boolean)) {
      for (const path of git(['ls-tree', '-r', '--name-only', commit]).split('\n').filter(p => p && !SKIP.test(p))) {
        const lines = accountLikeLines(git(['show', `${commit}:${path}`]));
        if (lines.length) { bad += 1; report(`${commit.slice(0, 7)} ${path}`, lines); }
      }
    }
    for (const commit of git(['rev-list', '--all', '--', 'data']).split('\n').filter(Boolean)) {
      for (const path of git(['ls-tree', '-r', '--name-only', commit, '--', 'data']).split('\n').filter(p => p.toLowerCase().endsWith('.csv'))) {
        const { findings } = sanitizeText(git(['show', `${commit}:${path}`]));
        if (findings.length) { bad += 1; console.log(`UNMASKED ${commit.slice(0, 7)} ${path}: ${findings.length} rows`); }
      }
    }
    console.log(bad ? `history has account numbers in ${bad} file versions: rewrite it before a public push (see README)` : 'history: no commit holds an account number');
    return bad ? 1 : 0;
  }
  const check = argv.includes('--check');
  const files = argv.filter(a => !a.startsWith('--'));
  const targets = files.length ? files.map(f => join(process.cwd(), f)) : dataFiles();
  let unmasked = 0;
  for (const file of targets) {
    const before = readFileSync(file, 'utf8');
    const { text, findings } = sanitizeText(before);
    const name = relative(process.cwd(), file);
    if (!findings.length) continue;
    unmasked += findings.length;
    if (check) console.log(`UNMASKED ${name}: ${findings.length} rows (first at line ${findings[0].line}, column ${findings[0].column})`);
    else { writeFileSync(file, text); console.log(`masked ${name}: ${findings.length} rows`); }
  }
  if (check) {
    const repoFindings = scanRepo();
    if (unmasked) console.log(`run: bun run sanitize (${unmasked} rows with a full account number in data/)`);
    if (repoFindings) console.log(`${repoFindings} files hold account-like numbers: mask or remove them`);
    if (!unmasked && !repoFindings) console.log(`${targets.length} data files masked, no account-like numbers in the repo`);
    return unmasked || repoFindings ? 1 : 0;
  }
  if (!unmasked) console.log(`${targets.length} files: nothing to mask`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
