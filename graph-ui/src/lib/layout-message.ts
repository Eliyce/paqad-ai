export interface LayoutRequest {
  nodes: { id: string; x: number; y: number }[];
  edges: { source: string; target: string }[];
  iterations: number;
}

export interface LayoutResponse {
  positions: Record<string, { x: number; y: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isLayoutNode(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number'
  );
}

function isLayoutEdge(value: unknown): boolean {
  return isRecord(value) && typeof value.source === 'string' && typeof value.target === 'string';
}

export function isLayoutRequest(value: unknown): value is LayoutRequest {
  return (
    isRecord(value) &&
    Array.isArray(value.nodes) &&
    value.nodes.every(isLayoutNode) &&
    Array.isArray(value.edges) &&
    value.edges.every(isLayoutEdge) &&
    typeof value.iterations === 'number' &&
    Number.isFinite(value.iterations) &&
    value.iterations >= 0
  );
}

export function isTrustedLayoutOrigin(origin: string, ownOrigin: string): boolean {
  return origin === '' || origin === ownOrigin;
}
