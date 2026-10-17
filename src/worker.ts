/// <reference lib="webworker" />
// Builds the reports off the main thread, one report after another, and posts each one as soon as it is ready,
// so the output tabs stop spinning one by one while the input tables stay responsive.
import { buildReport, REPORT_KINDS, type Account } from './reports';

type RunMessage = { jobId: number; accounts: Account[]; runDate: string };

self.onmessage = (event: MessageEvent<RunMessage>) => {
  const { jobId, accounts, runDate } = event.data;
  for (const { kind } of REPORT_KINDS) {
    try {
      self.postMessage({ jobId, kind, sheets: buildReport(kind, accounts, runDate) });
    } catch (e) {
      self.postMessage({ jobId, kind, sheets: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
};
