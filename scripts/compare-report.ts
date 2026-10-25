/// <reference lib="esnext" />
// How compare-scio.ts checks one report against the scio output (pure, `bun test` covers it).
//   bytes: the files must be identical (investments and DRIPs: their sort keys never tie in the data)
//   keys:  same header, same set of rows, and the same sequence of sort keys from top to bottom. Beam gives no
//          order to rows with an equal sort key (dividends: the first diff column; watchlists: the market cap),
//          so only those rows may swap; any other order change fails
export type OrderCheck = { kind: 'bytes' } | { kind: 'keys'; header: boolean; key: (line: string) => string };

export function lines(text: string): string[] {
  return text.split('\n').filter(Boolean);
}

/** The problems found, empty when the report matches. */
export function compareReport(expectedText: string, actualText: string, check: OrderCheck): string[] {
  const e = lines(expectedText);
  const a = lines(actualText);
  if (check.kind === 'bytes') {
    if (expectedText === actualText) return [];
    const i = Array.from({ length: Math.max(e.length, a.length) }, (_, k) => k).find(k => e[k] !== a[k]) ?? -1;
    if (i < 0) return [`expected ${e.length} lines, got ${a.length}: same lines, different bytes (line ends or a trailing newline)`];
    return [`expected ${e.length} lines, got ${a.length}; first difference at line ${i + 1}:`, `  - ${e[i] ?? '(none)'}`, `  + ${a[i] ?? '(none)'}`];
  }
  const problems: string[] = [];
  if (check.header && e[0] !== a[0]) problems.push(`header expected: ${e[0]}`, `header actual:   ${a[0]}`);
  const eb = check.header ? e.slice(1) : e;
  const ab = check.header ? a.slice(1) : a;
  if ([...eb].sort().join('\n') !== [...ab].sort().join('\n')) {
    problems.push(`expected ${e.length} lines, got ${a.length}`);
    eb.filter(l => !ab.includes(l)).slice(0, 5).forEach(l => problems.push(`  - ${l}`));
    ab.filter(l => !eb.includes(l)).slice(0, 5).forEach(l => problems.push(`  + ${l}`));
    return problems;
  }
  if (problems.length) return problems;
  const ek = eb.map(check.key);
  const ak = ab.map(check.key);
  const i = ek.findIndex((k, n) => k !== ak[n]);
  if (i >= 0) problems.push(`sort keys differ at row ${i + 1}: expected ${ek[i]}, got ${ak[i]}`);
  return problems;
}
