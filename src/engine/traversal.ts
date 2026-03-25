// Graph traversal algorithms
// Currently implemented directly in SqliteStorage for performance.
// This file serves as the future home for engine-level traversal logic
// when we need provider-agnostic graph algorithms (e.g., after switching to Neo4j).

export type Direction = 'incoming' | 'outgoing' | 'both';

export interface TraversalOptions {
  maxDepth: number;
  direction: Direction;
  relationshipFilter?: string[];
}
