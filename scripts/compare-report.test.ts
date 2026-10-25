/// <reference types="bun" />
import { describe, it, expect } from 'bun:test';
import { compareReport } from './compare-report';

const text = (...ls: string[]) => ls.map(l => `${l}\n`).join('');
const HEAD = 'Symbol,Yield %,Value $,0.001 Costs $,Baseline $,Shares,1x Diff $,1x Diff Shares';
const dividendKey = { kind: 'keys' as const, header: true, key: (line: string) => line.split(',')[6] ?? '' };
const caps: Record<string, string> = { NVDA: '5.56T', AAPL: '4.10T', ITW: '76.10B', XLC: '', SCHD: '' };
const watchlistKey = { kind: 'keys' as const, header: false, key: (t: string) => caps[t] ?? '?' };

describe('compare', () => {
  it('bytes: identical files pass; the same rows in another order fail (sets let that through before)', () => {
    const scio = text('Symbol,Current $', 'BBB,5.20', 'AAA,1.60');
    expect(compareReport(scio, scio, { kind: 'bytes' })).toEqual([]);
    expect(compareReport(scio, text('Symbol,Current $', 'AAA,1.60', 'BBB,5.20'), { kind: 'bytes' })).toEqual([
      'expected 3 lines, got 3; first difference at line 2:', '  - BBB,5.20', '  + AAA,1.60',
    ]);
  });

  it('bytes: a changed cell, a missing line or a missing final newline fails', () => {
    const scio = text('Symbol,Current $', 'BBB,5.20');
    expect(compareReport(scio, text('Symbol,Current $', 'BBB,5.21'), { kind: 'bytes' })[0]).toContain('first difference at line 2');
    expect(compareReport(scio, text('Symbol,Current $'), { kind: 'bytes' })).toEqual(['expected 2 lines, got 1; first difference at line 2:', '  - BBB,5.20', '  + (none)']);
    expect(compareReport(scio, 'Symbol,Current $\nBBB,5.20', { kind: 'bytes' })[0]).toContain('different bytes');
  });

  it('keys: rows with an equal sort key may swap (Beam gives them no order), others may not', () => {
    const scio = text(HEAD, 'AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.000', 'KO,2.30,16.80,0.09,14.14,0.179,0.00,0.000', 'DDD,0.50,1.00,0.01,1.00,0.143,0.40,0.058');
    const tieSwapped = text(HEAD, 'KO,2.30,16.80,0.09,14.14,0.179,0.00,0.000', 'AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.000', 'DDD,0.50,1.00,0.01,1.00,0.143,0.40,0.058');
    const keyMoved = text(HEAD, 'DDD,0.50,1.00,0.01,1.00,0.143,0.40,0.058', 'AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.000', 'KO,2.30,16.80,0.09,14.14,0.179,0.00,0.000');
    expect(compareReport(scio, tieSwapped, dividendKey)).toEqual([]);
    expect(compareReport(scio, keyMoved, dividendKey)).toEqual(['sort keys differ at row 1: expected 0.00, got 0.40']);
  });

  it('keys: a different header or row set fails before the order is looked at', () => {
    const scio = text(HEAD, 'AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.000');
    expect(compareReport(scio, text('Symbol', 'AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.000'), dividendKey)).toEqual([`header expected: ${HEAD}`, 'header actual:   Symbol']);
    expect(compareReport(scio, text(HEAD, 'AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.001'), dividendKey)).toEqual([
      'expected 2 lines, got 2', '  - AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.000', '  + AAA,2.00,1.60,0.00,1.50,0.533,0.00,0.001',
    ]);
    expect(compareReport(text(HEAD, 'A', 'A', 'B'), text(HEAD, 'A', 'B', 'B'), dividendKey)[0]).toBe('expected 4 lines, got 4');
  });

  it('keys: watchlists keep market cap order, tickers of an equal cap may swap', () => {
    const scio = text('NVDA', 'AAPL', 'ITW', 'XLC', 'SCHD');
    expect(compareReport(scio, text('NVDA', 'AAPL', 'ITW', 'SCHD', 'XLC'), watchlistKey)).toEqual([]);
    expect(compareReport(scio, text('AAPL', 'NVDA', 'ITW', 'XLC', 'SCHD'), watchlistKey)).toEqual(['sort keys differ at row 1: expected 5.56T, got 4.10T']);
  });
});
