/** Text for innerHTML: & < > " ' escaped (same helper as Stocks). */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch));
}

/** Search text as the dropdown block compares it (same helper as Stocks). */
export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}
