/// <reference types="bun" />
import { describe, it, expect } from 'bun:test';
import { accountLikeLines, isMasked, maskValue, sanitizeText } from '../src/sanitize';
import { readFidelityAccounts, buildReport, reportText, REPORT_KINDS } from '../src/reports';

// fake account numbers, built at run time so no literal in the repo looks like one (the hooks scan for them)
const FAKE_A = ['X1234', '5678'].join('');
const FAKE_B = ['98765', '4321'].join('');
const HEADER = '﻿Account number,Account name,Symbol,Cost basis total,Current value,Last price,Dist. rate,Payment frequency,Market cap,Ex-date,Pay date,Sector';
const SAMPLE = [
  HEADER,
  ` ${FAKE_A},Stocks,ITW,$20.00,$26.55,$262.50,2.64%,Quarterly,Large cap ($76.10B),Sep-30-2026,Oct-09-2026,Industrials,`,
  `${FAKE_B},Max ROTH IRA,"SCHD",$3.10,$2.05,$27.10,3.80%,Quarterly,--,Dec-10-2026,Dec-15-2026,--,`,
  '',
  '"The data and information in this spreadsheet is provided to you solely for your use, not for distribution."',
].join('\r\n');

describe('sanitize', () => {
  it('masks every character but the last 4 (same length), keeps spaces and quotes', () => {
    expect(maskValue(` ${FAKE_A}`)).toBe(' *****5678');
    expect(maskValue(`"${FAKE_B}"`)).toBe('"*****4321"');
    expect(maskValue('A12')).toBe('***A12');
    expect([isMasked('*****5678'), isMasked('*0043'), isMasked(`${FAKE_A}`)]).toEqual([true, true, false]);
  });

  it('changes only the account numbers: same bytes otherwise, a second run changes nothing', () => {
    const once = sanitizeText(SAMPLE);
    expect(once.findings.map(f => f.line)).toEqual([2, 3]);
    expect(once.text).toBe(SAMPLE.replace(` ${FAKE_A},`, ' *****5678,').replace(`${FAKE_B},`, '*****4321,'));
    expect(sanitizeText(once.text)).toEqual({ text: once.text, findings: [] });
  });

  it('finds anything shaped like an account number in any text (the hooks and the build use it)', () => {
    expect(accountLikeLines(SAMPLE)).toEqual([2, 3]);
    expect(accountLikeLines(sanitizeText(SAMPLE).text)).toEqual([]);
    expect(accountLikeLines(`a\nid=${FAKE_A};\n${['1234', '56789'].join('')}`)).toEqual([2, 3]);
    expect(accountLikeLines('$6744.54 1234567890 X1234567 268435456 *****5678')).toEqual([]); // 10 digits, 8 chars, a library constant, masked
  });

  it('keeps the reports the same and accounts apart', () => {
    const before = readFidelityAccounts('a.csv', SAMPLE) ?? [];
    const after = readFidelityAccounts('a.csv', sanitizeText(SAMPLE).text) ?? [];
    expect(after.map(a => a.number)).toEqual(['*****5678', '*****4321']);
    for (const { kind } of REPORT_KINDS) {
      expect(buildReport(kind, after, '2026-10-01').map(s => reportText(kind, s.table))).toEqual(buildReport(kind, before, '2026-10-01').map(s => reportText(kind, s.table)));
    }
    expect(() => sanitizeText(`${HEADER}\nA10325,X,ITW,,,,,,,,,\nB20325,Y,ITW,,,,,,,,,`)).toThrow('same 4 characters');
  });
});
