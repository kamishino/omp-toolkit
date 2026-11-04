// Sticky session affinity summary: per-credential session counts from the
// broker's session:sticky:* cache rows.

export interface StickyRowLike {
  key: string;
  value: string;
}

export interface StickySummaryEntry {
  credentialId: number;
  sessions: number;
}

export function summarizeSticky(
  rows: readonly StickyRowLike[],
  provider: string,
): StickySummaryEntry[] {
  const counts = new Map<number, number>();
  const prefix = `session:sticky:${provider}:`;
  for (const row of rows) {
    if (!row.key.startsWith(prefix)) continue;
    let id: number | null = null;
    const raw = row.value.trim();
    if (/^\d+$/.test(raw)) id = Number(raw);
    else {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === "number") id = parsed;
        else if (typeof parsed === "object" && parsed !== null) {
          const rec = parsed as Record<string, unknown>;
          const candidate = rec.id ?? rec.credentialId ?? rec.rowId;
          if (typeof candidate === "number") id = candidate;
        }
      } catch {
        id = null;
      }
    }
    if (id === null) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([credentialId, sessions]) => ({ credentialId, sessions }))
    .sort((a, b) => b.sessions - a.sessions || a.credentialId - b.credentialId);
}
