// ============================================================
// PERSISTENT MEMORY ENGINE
// ------------------------------------------------------------
// Stores user preferences, facts, and research notes in
// localStorage with full-text search. Used by NeuralChat +
// Telegram bot to remember context across sessions.
//
// Storage: localStorage key `ai_memory_v1` = MemoryEntry[]
// Search: simple tokenized search (no FTS5 in browser, but
// fast enough for <1000 entries)
// ============================================================

export interface MemoryEntry {
  id: string;
  type: 'preference' | 'fact' | 'note' | 'research' | 'alert';
  content: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
  source: 'user' | 'ai' | 'system';
  pinned?: boolean;
}

const STORAGE_KEY = 'ai_memory_v1';

export function loadMemory(): MemoryEntry[] {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch { /* empty */ }
  return [];
}

export function saveMemory(entries: MemoryEntry[]): void {
  try {
    // Cap at 500 entries to avoid localStorage quota issues.
    const capped = entries.slice(-500);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(capped));
  } catch { /* quota */ }
}

export function addMemory(
  content: string,
  type: MemoryEntry['type'] = 'note',
  tags: string[] = [],
  source: MemoryEntry['source'] = 'user'
): MemoryEntry {
  const entries = loadMemory();
  // Dedupe: if same content exists, update it instead of adding duplicate.
  const existing = entries.find(e => e.content === content);
  if (existing) {
    existing.updatedAt = Date.now();
    existing.tags = [...new Set([...existing.tags, ...tags])];
    saveMemory(entries);
    return existing;
  }
  const entry: MemoryEntry = {
    id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type, content, tags,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    source,
  };
  entries.push(entry);
  saveMemory(entries);
  return entry;
}

export function removeMemory(id: string): void {
  const entries = loadMemory().filter(e => e.id !== id);
  saveMemory(entries);
}

export function updateMemory(id: string, patch: Partial<MemoryEntry>): void {
  const entries = loadMemory();
  const idx = entries.findIndex(e => e.id === id);
  if (idx >= 0) {
    entries[idx] = { ...entries[idx], ...patch, updatedAt: Date.now() };
    saveMemory(entries);
  }
}

export function searchMemory(query: string): MemoryEntry[] {
  if (!query.trim()) return loadMemory();
  const entries = loadMemory();
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
  return entries
    .map(e => {
      const text = (e.content + ' ' + e.tags.join(' ')).toLowerCase();
      let score = 0;
      for (const t of tokens) {
        if (text.includes(t)) score += 1;
      }
      // Pinned entries get bonus
      if (e.pinned) score += 0.5;
      return { entry: e, score };
    })
    .filter(r => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(r => r.entry);
}

export function getMemoryContext(): string {
  const entries = loadMemory();
  if (entries.length === 0) return '';
  const pinned = entries.filter(e => e.pinned);
  const recent = entries.filter(e => !e.pinned).slice(-10);
  const all = [...pinned, ...recent];
  if (all.length === 0) return '';
  let ctx = '=== USER MEMORY (persistent across sessions) ===\n';
  for (const e of all) {
    ctx += `[${e.type.toUpperCase()}] ${e.content}\n`;
  }
  ctx += '=== END MEMORY ===\n';
  return ctx;
}

export function clearMemory(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}
