// Dexie database bootstrap placeholder.
// Initialize IndexedDB adapters here when backend sync contracts are finalized.

export interface LocalCacheRecord {
  key: string;
  value: unknown;
  version?: number;
  updatedAt?: string;
}

export const databaseReady = false;
