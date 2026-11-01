/// <reference lib="esnext" />
// Input file bookkeeping of main.tsx, kept free of the DOM so `bun test` covers it.

export type InputSource = 'repo' | 'loaded';

/**
 * The repo data/ files arrive asynchronously at start. They become the input only while the input is still the
 * repo's: files the user loaded in the meantime (or a list trimmed with the tab ✕) are never replaced by a late
 * arrival; the Repo data button brings the repo files back.
 */
export function repoDataTakesOver(source: InputSource): boolean {
  return source === 'repo';
}

export type PickedFile = { name: string; text: () => Promise<string> };

/** Reads every picked file; one that cannot be read is listed in `failed` instead of rejecting, so the others still load. */
export async function readPicked(files: PickedFile[]): Promise<{ read: { name: string; text: string }[]; failed: string[] }> {
  const results = await Promise.all(files.map(async f => {
    try {
      return { name: f.name, text: await f.text() };
    } catch {
      return { name: f.name, text: null };
    }
  }));
  const read: { name: string; text: string }[] = [];
  const failed: string[] = [];
  for (const r of results) {
    if (r.text === null) failed.push(r.name);
    else read.push({ name: r.name, text: r.text });
  }
  return { read, failed };
}

export type StoredFile = { name: string; text: string };

/**
 * The files to keep in this browser for the next visit: the loaded files (also a list the user trimmed with the tab ✕),
 * or null for "forget them" when the input went back to the repo data/, so the next visit starts from the repo defaults.
 */
export function filesToKeep(files: StoredFile[], source: InputSource): StoredFile[] | null {
  return source === 'loaded' ? files.map(f => ({ name: f.name, text: f.text })) : null;
}

/**
 * What the next visit starts from: the kept files when the store holds at least one well-formed file (anything else in
 * it is dropped), otherwise null = the repo data/ is the default. An empty, missing or broken store never blocks the start.
 */
export function keptFiles(stored: unknown): StoredFile[] | null {
  if (!Array.isArray(stored)) return null;
  const files = stored.filter((f): f is StoredFile => !!f && typeof f === 'object' && typeof (f as StoredFile).name === 'string' && typeof (f as StoredFile).text === 'string');
  return files.length ? files : null;
}
