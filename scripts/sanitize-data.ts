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
//   bun scripts/sanitize-data.ts --pre-commit    what .githooks/pre-commit runs, on the STAGED content (the index):
//                                                masks staged data/*.csv in the index and the working tree, then
//                                                refuses the commit if any staged file still holds an account-like number
//   bun scripts/sanitize-data.ts --check-hooks   exit 1 unless the git hooks are on (core.hooksPath = .githooks, both
//                                                hooks executable); build, serve and bun test run it, so work stops
//                                                in a clone where commits would not be checked (CI is skipped: it
//                                                has no hooks, it runs --check before the build instead)
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

// __dirname and require.main instead of import.meta: the owner's IDE checks this file with the TypeScript defaults (ES5, commonjs)
const ROOT = join(__dirname, '..');
const DATA = join(ROOT, 'data');

function dataFiles(): string[] {
  return readdirSync(DATA).filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.csv')).sort().map(f => join(DATA, f));
}

function git(args: string[]): string {
  const run = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args.join(' ')}: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

function gitRun(args: string[], input?: string): string {
  const run = Bun.spawnSync(['git', ...args], { cwd: ROOT, stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input), stdout: 'pipe', stderr: 'pipe' });
  if (run.exitCode !== 0) throw new Error(`git ${args[0]}: ${run.stderr.toString().trim()}`);
  return run.stdout.toString();
}

/**
 * The commit gets only masked data: staged data/*.csv are masked in the index (and in the working tree, so both
 * agree), then every staged file is scanned. A commit with an account number is never created.
 */
function preCommit(): number {
  const staged = gitRun(['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z']).split('\0').filter(Boolean);
  let masked = 0;
  for (const path of staged.filter(p => /^data\/[^/]+\.csv$/i.test(p))) {
    const { text, findings } = sanitizeText(gitRun(['show', `:${path}`]));
    if (!findings.length) continue;
    const mode = gitRun(['ls-files', '-s', '--', path]).split(' ')[0] || '100644';
    const blob = gitRun(['hash-object', '-w', '--stdin', '--path', path], text).trim();
    gitRun(['update-index', '--cacheinfo', `${mode},${blob},${path}`]);
    try {
      const work = readFileSync(join(ROOT, path), 'utf8');
      const fixed = sanitizeText(work);
      if (fixed.findings.length) writeFileSync(join(ROOT, path), fixed.text);
    } catch { /* deleted in the working tree: the index is what counts */ }
    masked += 1;
    console.log(`masked ${path}: ${findings.length} rows (staged and working copy)`);
  }
  let bad = 0;
  for (const path of staged.filter(p => !SKIP.test(p))) {
    const lines = accountLikeLines(gitRun(['show', `:${path}`]));
    if (lines.length) { bad += 1; report(`staged ${path}`, lines); }
  }
  if (bad) {
    console.log(`commit refused: ${bad} staged files hold account-like numbers (mask them, or unstage them with git restore --staged)`);
    return 1;
  }
  console.log(masked ? `${masked} data files masked before the commit` : 'staged files: no account numbers');
  return 0;
}

/** The hooks this repo relies on; a clone without them would commit unchecked files. */
export function hooksProblem(): string {
  if (process.env.CI) return '';
  let path = '';
  try { path = gitRun(['config', '--get', 'core.hooksPath']).trim(); } catch { path = ''; }
  if (path !== '.githooks') return `git hooks are off (core.hooksPath is "${path}"): run bun install (or git config core.hooksPath .githooks)`;
  for (const hook of ['pre-commit', 'pre-push']) {
    let mode = 0;
    try { mode = statSync(join(ROOT, '.githooks', hook)).mode; } catch { return `.githooks/${hook} is missing`; }
    if (!(mode & 0o111)) return `.githooks/${hook} is not executable: chmod +x .githooks/${hook}`;
  }
  return '';
}

function main(argv: string[]): number {
  if (argv.includes('--pre-commit')) return preCommit();
  if (argv.includes('--check-hooks')) {
    const problem = hooksProblem();
    console.log(problem ? `HOOKS: ${problem}` : process.env.CI ? 'hooks: skipped on CI (check-data runs instead)' : 'hooks: pre-commit and pre-push are on');
    return problem ? 1 : 0;
  }
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

if (require.main === module) process.exit(main(process.argv.slice(2)));
