/// <reference types="bun" />
import { describe, it, expect } from 'bun:test';
import { readPicked, repoDataTakesOver } from './input';

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
