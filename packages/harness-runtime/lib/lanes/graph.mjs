/**
 * @file Lane graph validation.
 *
 * Owns: dependency-graph validation, integration-order validation,
 *        deterministic cycle detection for both directed graphs.
 *
 * Representation: both graphs share a single canonical edge shape:
 *   { from: laneId, to: laneId }
 *
 * The dependency graph expresses "to requires work output/checkpoint from from".
 * The integration-order graph expresses "from must integrate before to".
 * They are independently representable and must NOT be collapsed.
 */

/**
 * Normalize an edge object: return as-is if already canonical, else build.
 */
function normalizeEdge(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('Graph edge must be an object');
  }
  const { from, to } = raw;
  if (typeof from !== 'string' || typeof to !== 'string') {
    throw new Error('Graph edge requires string from/to laneId fields');
  }
  return { from, to };
}

/**
 * Deterministic cycle detection via 3-color DFS.
 * WHITE = 0  (undiscovered)
 * GRAY  = 1  (in current recursion stack)
 * BLACK = 2  (fully explored)
 *
 * Returns true when a cycle exists; false when the graph is a DAG.
 *
 * Complexity: O(V + E).
 */
function detectCycle(adjacencyMap) {
  const color = new Map();
  for (const node of adjacencyMap.keys()) {
    color.set(node, 0);
  }

  const RECURSE_LIMIT = 100000;

  function dfs(node, depth) {
    if (depth > RECURSE_LIMIT) {
      throw new Error('Graph recursion limit exceeded — possible pathological input');
    }
    color.set(node, 1);
    for (const neighbor of adjacencyMap.get(node) || []) {
      const c = color.get(neighbor);
      if (c === 1) return true; // back-edge → cycle
      if (c === 0 && dfs(neighbor, depth + 1)) return true;
    }
    color.set(node, 2);
    return false;
  }

  for (const node of adjacencyMap.keys()) {
    if (color.get(node) === 0) {
      if (dfs(node, 0)) return true;
    }
  }
  return false;
}

/**
 * Validates a single directed graph.
 *
 * Rejects in order:
 *  1. Unknown lane references (nodes not in the known set)
 *  2. Self-dependencies (from === to)
 *  3. Duplicate edges
 *  4. Cycles (deterministic DFS color marking)
 *
 * @param {string[]} rawEdges            - raw edge objects [{from, to}]
 * @param {Set<string>} knownLaneIds     - valid lane IDs at plan scope
 * @param {string} graphLabel           - human-readable label for error messages
 * @returns {{ edges: Array<{from,to}>, laneIds: Set<string> }}
 */
export function validateDirectedGraph(rawEdges, knownLaneIds, graphLabel) {
  if (!Array.isArray(rawEdges)) {
    throw new Error(`${graphLabel} must be an array`);
  }
  if (rawEdges.length === 0) {
    return { edges: [], laneIds: new Set() };
  }

  const seen = new Set();
  const adjacent = new Map(); // laneId → Set<laneId>
  const laneIds = new Set();

  for (let i = 0; i < rawEdges.length; i++) {
    const raw = rawEdges[i];
    const edge = normalizeEdge(raw);

    // Self-dependency check (before unknown-reference to give the more specific message)
    if (edge.from === edge.to) {
      throw new Error(
        `${graphLabel} contains self-dependency at index ${i}: "${edge.from}" -> "${edge.to}"`,
      );
    }

    // Unknown reference check
    if (!knownLaneIds.has(edge.from)) {
      throw new Error(
        `${graphLabel} references unknown laneId "${edge.from}" at index ${i}`,
      );
    }
    if (!knownLaneIds.has(edge.to)) {
      throw new Error(
        `${graphLabel} references unknown laneId "${edge.to}" at index ${i}`,
      );
    }

    // Duplicate edge check
    const key = `${edge.from}->${edge.to}`;
    if (seen.has(key)) {
      throw new Error(`Duplicate ${graphLabel} edge: "${edge.from}" -> "${edge.to}"`);
    }
    seen.add(key);

    laneIds.add(edge.from);
    laneIds.add(edge.to);

    if (!adjacent.has(edge.from)) adjacent.set(edge.from, new Set());
    adjacent.get(edge.from).add(edge.to);
  }

  // Cycle detection
  if (detectCycle(adjacent)) {
    throw new Error(`${graphLabel} contains a cycle`);
  }

  return { edges: rawEdges.map((e) => normalizeEdge(e)), laneIds };
}
