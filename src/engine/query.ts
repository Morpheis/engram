// Query builders for complex graph queries
// Currently implemented directly in SqliteStorage.
// This file will hold provider-agnostic query logic when needed.

export interface QueryFilter {
  type?: string;
  staleAfterDays?: number;
  orphansOnly?: boolean;
}
