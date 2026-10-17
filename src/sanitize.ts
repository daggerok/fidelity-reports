// Masks Fidelity account numbers: AB1234567 -> *****4567 (every character but the last 4 becomes *, the length
// stays). Used by scripts/sanitize-data.ts for the repo data/ and by the app for every file it loads, so a full
// account number is never stored in the repo nor shown on the page. Pure code, no DOM, no node APIs.

/** Same quote-aware split as src/reports.ts (Commons.CsvSplit of scio-examples). */
const CSV_SPLIT = /,(?=(?:[^"]*"[^"]*")*[^"]*$)/;
export const KEEP = 4;

/** A masked value: stars, then at most 4 characters (*****4567, and Fidelity's own *0043). */
export function isMasked(value: string): boolean {
  return /^\*+[A-Za-z0-9]{0,4}$/.test(value.trim());
}

/** AB1234567 -> *****4567; spaces and quotes around the number stay (" AB1234567" -> " *****4567"). */
export function maskValue(value: string, keep: number = KEEP): string {
  const inner = value.replace(/"/g, '').trim();
  if (inner === '' || isMasked(inner)) return value;
  const tail = inner.slice(-keep);
  return value.replace(inner, `${'*'.repeat(Math.max(inner.length - tail.length, 3))}${tail}`);
}

export type Finding = { line: number; column: number };

/** The column of "Account number" when the line is a Fidelity header row, else -1. */
function accountColumn(line: string): number {
  const headers = line.replace(/﻿/g, '').split(CSV_SPLIT).map(h => h.trim().replace(/"/g, '').toLowerCase());
  return headers[0] === 'account number' ? 0 : -1;
}

/**
 * Masks the account numbers of one Fidelity export. Only the Account number column changes, every other byte
 * (quotes, spaces, CRLF) stays, so the reports are the same. Files without a Fidelity header are returned as
 * they are. Throws when two accounts of one file end with the same 4 characters (they could not be told apart).
 */
export function sanitizeText(text: string): { text: string; findings: Finding[] } {
  const lines = text.split(/(\r\n|\n|\r)/); // separators kept at odd indices
  const findings: Finding[] = [];
  let column = -1;
  const rows: { index: number; parts: string[] }[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i];
    const header = accountColumn(line);
    if (header >= 0) { column = header; continue; }
    if (column < 0 || line.trim() === '') continue;
    const parts = line.split(CSV_SPLIT);
    if (parts.length < 2 || parts.length <= column) continue; // disclaimers and other single-field lines
    const raw = parts[column].trim().replace(/"/g, '');
    if (raw === '' || isMasked(raw)) continue;
    findings.push({ line: i / 2 + 1, column: column + 1 });
    rows.push({ index: i, parts });
  }
  if (!rows.length) return { text, findings };
  const numbers = [...new Set(rows.map(r => r.parts[column].trim().replace(/"/g, '')))];
  if (new Set(numbers.map(n => n.slice(-KEEP))).size < numbers.length) throw new Error('two accounts end with the same 4 characters: cannot mask them apart');
  for (const { index, parts } of rows) {
    parts[column] = maskValue(parts[column]);
    lines[index] = parts.join(',');
  }
  return { text: lines.join(''), findings };
}

/**
 * Anything that looks like a Fidelity account number: a letter and 8 digits, or 9 digits, standing alone.
 * The git hooks and the build scan every file with it, not only the Account number column of data/.
 */
const ACCOUNT_LIKE = /(?<![A-Za-z0-9])(?:[A-Z]\d{8}|\d{9})(?![A-Za-z0-9])/g;

/** Numbers of the bundled libraries that have the same shape (2^28 and constants of decimal.js and fflate). */
const LIBRARY_CONSTANTS = new Set(['268435456', '135520028', '306674912']);

/** 1-based line numbers of the text that hold something shaped like an account number. */
export function accountLikeLines(text: string): number[] {
  const found: number[] = [];
  text.split(/\r\n|\n|\r/).forEach((line, i) => {
    const hits = (line.match(ACCOUNT_LIKE) ?? []).filter(token => !LIBRARY_CONSTANTS.has(token));
    if (hits.length) found.push(i + 1);
  });
  return found;
}
