/**
 * Blast Radius — depth-limited BFS over the dependency graph.
 * Finds everything that depends on a changed symbol/file (reverse traversal).
 */

import type { SifthookStore } from '../indexer/store.js';
import type { BlastRadiusNode, SymbolKind, EdgeType } from '../types.js';

/**
 * Compute the blast radius for a given file and optional symbol.
 * Traverses edges in the REVERSE direction (find what depends on this).
 */
export function computeBlastRadius(
  store: SifthookStore,
  filePath: string,
  symbolName?: string,
  maxDepth: number = 2,
  includeTemporalEdges: boolean = true
): BlastRadiusNode[] {
  const result: BlastRadiusNode[] = [];
  const visited = new Set<number>(); // symbol IDs already visited

  // Find starting symbols
  let startSymbols: Array<{ id: number; name: string; kind: string; file_path?: string }>;

  if (symbolName) {
    startSymbols = store.findSymbolByName(symbolName)
      .filter(s => s.file_path === filePath || !filePath);
  } else {
    // All symbols in the file
    const file = store.getFileByPath(filePath);
    if (!file) return result;
    startSymbols = store.getSymbolsByFile(file.id).map(s => ({
      ...s,
      file_path: filePath,
    }));
  }

  if (startSymbols.length === 0) return result;

  // BFS queue: [symbolId, distance]
  const queue: Array<[number, number]> = [];

  for (const sym of startSymbols) {
    visited.add(sym.id);
    queue.push([sym.id, 0]);
  }

  while (queue.length > 0) {
    const [currentId, distance] = queue.shift()!;

    if (distance >= maxDepth) continue;

    // Find all symbols that reference the current symbol (reverse edges)
    const incomingEdges = store.getEdgesTo(currentId);

    for (const edge of incomingEdges) {
      if (visited.has(edge.from_symbol_id)) continue;
      visited.add(edge.from_symbol_id);

      result.push({
        file: edge.from_file,
        symbol: edge.from_name,
        symbolKind: edge.from_kind as SymbolKind,
        relation: edge.edge_type as EdgeType,
        distance: distance + 1,
        signature: null, // will be filled in by the caller if needed
      });

      queue.push([edge.from_symbol_id, distance + 1]);
    }
  }

  // Also include temporal coupling edges if enabled
  if (includeTemporalEdges) {
    const file = store.getFileByPath(filePath);
    if (file) {
      const temporalEdges = store.getTemporalEdgesForFile(file.id);
      for (const edge of temporalEdges) {
        // Check if we haven't already included this file
        const alreadyIncluded = result.some(r => r.file === edge.coupled_file_path);
        if (!alreadyIncluded) {
          result.push({
            file: edge.coupled_file_path,
            symbol: '(temporal coupling)',
            symbolKind: 'variable', // placeholder
            relation: 'temporal',
            distance: 1,
            signature: `Co-commit rate: ${(edge.coupling_score * 100).toFixed(0)}%`,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Format blast radius results as a tree string for terminal output.
 */
export function formatBlastRadiusTree(
  filePath: string,
  symbolName: string | undefined,
  nodes: BlastRadiusNode[]
): string {
  const lines: string[] = [];
  const header = symbolName
    ? `🎯 Blast radius for ${symbolName} in ${filePath}`
    : `🎯 Blast radius for ${filePath}`;

  lines.push(header);
  lines.push('─'.repeat(Math.min(header.length, 60)));

  if (nodes.length === 0) {
    lines.push('  (no dependents found)');
    return lines.join('\n');
  }

  // Group by distance
  const byDistance = new Map<number, BlastRadiusNode[]>();
  for (const node of nodes) {
    const existing = byDistance.get(node.distance) ?? [];
    existing.push(node);
    byDistance.set(node.distance, existing);
  }

  for (const [distance, group] of Array.from(byDistance.entries()).sort((a, b) => a[0] - b[0])) {
    lines.push(`\n  Distance ${distance}:`);
    for (const node of group) {
      const icon = getRelationIcon(node.relation);
      const temporal = node.relation === 'temporal' ? ' 👻' : '';
      lines.push(`    ${icon} ${node.file} → ${node.symbol} (${node.relation})${temporal}`);
      if (node.signature) {
        lines.push(`       ${node.signature}`);
      }
    }
  }

  lines.push(`\n  Total affected: ${nodes.length} symbols`);
  return lines.join('\n');
}

function getRelationIcon(relation: EdgeType): string {
  switch (relation) {
    case 'imports': return '📦';
    case 'calls': return '📞';
    case 'extends': return '🧬';
    case 'implements': return '🔌';
    case 'references': return '🔗';
    case 'temporal': return '👻';
    default: return '•';
  }
}
