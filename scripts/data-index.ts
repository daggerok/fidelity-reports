#!/usr/bin/env bun
/// <reference types="bun" />
// Writes data/index.json: the CSV files of data/ in name order (natural: 2 before 10). The app reads it at start
// to load the default input files; `bun run build` and `bun run serve` run this first (prebuild, preserve).
import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dir, '..', 'data');
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const files = readdirSync(dir).filter(f => !f.startsWith('.') && f.toLowerCase().endsWith('.csv')).sort(collator.compare);
writeFileSync(join(dir, 'index.json'), `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`data/index.json: ${files.length} files`);
