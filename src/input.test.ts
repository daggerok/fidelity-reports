/// <reference types="bun" />
import { describe, it, expect } from 'bun:test';
import { filesToKeep, keptFiles, readPicked, repoDataTakesOver } from './input';

const file = (name: string, text: string) => ({ name, text: () => Promise.resolve(text) });
const unreadable = (name: string) => ({ name, text: () => Promise.reject(new Error('NotReadableError')) });

describe('input', () => {
  it('late repo data replaces only the repo input, never files the user loaded', () => {
    expect(repoDataTakesOver('repo')).toBe(true);
    expect(repoDataTakesOver('loaded')).toBe(false);
  });

  it('reads every picked file in order', async () => {
    expect(await readPicked([file('a.csv', 'A'), file('b.csv', 'B')])).toEqual({ read: [{ name: 'a.csv', text: 'A' }, { name: 'b.csv', text: 'B' }], failed: [] });
  });

  it('an unreadable file is reported instead of rejecting, the others still load', async () => {
    expect(await readPicked([unreadable('gone.csv'), file('b.csv', 'B')])).toEqual({ read: [{ name: 'b.csv', text: 'B' }], failed: ['gone.csv'] });
    expect(await readPicked([unreadable('x.csv'), unreadable('y.csv')])).toEqual({ read: [], failed: ['x.csv', 'y.csv'] });
  });
});

describe('files kept for the next visit', () => {
  const a = { name: 'a.csv', text: 'A' };
  const b = { name: 'b.csv', text: 'B' };

  it('loaded files are kept as name + text only, repo data means forget', () => {
    expect(filesToKeep([{ ...a, extra: 1 } as any, b], 'loaded')).toEqual([a, b]);
    expect(filesToKeep([], 'loaded')).toEqual([]);
    expect(filesToKeep([a, b], 'repo')).toBeNull();
  });

  it('the next visit starts from the kept files, else from the repo data', () => {
    expect(keptFiles([a, b])).toEqual([a, b]);
    expect(keptFiles([a, null, 'x', { name: 'no-text.csv' }, { name: 1, text: 'T' }])).toEqual([a]);
    expect(keptFiles([])).toBeNull();
    expect(keptFiles(undefined)).toBeNull();
    expect(keptFiles({ name: 'a.csv', text: 'A' })).toBeNull();
    expect(keptFiles([{ name: 'no-text.csv' }])).toBeNull();
  });
});
