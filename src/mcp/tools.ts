/**
 * MCP Tools — implements the 4 Sifthook tools for MCP clients.
 * Uses Zod schemas as required by @modelcontextprotocol/sdk.
 */

import { z } from 'zod';
import path from 'node:path';
import { SifthookStore } from '../indexer/store.js';
import { computeBlastRadius } from '../analyzer/blast-radius.js';
import { searchSymbols } from '../indexer/embeddings.js';
import { parseDiffText } from '../analyzer/diff.js';
import { buildReviewPrompt } from '../analyzer/context-builder.js';
import { reviewWithClaude } from '../analyzer/reviewer.js';
import { loadConfig } from '../config.js';

// ─── Zod Schemas ───────────────────────────────────────────────────

export const getBlastRadiusSchema = z.object({
  file: z.string().describe('File path to query'),
  symbol: z.string().optional().describe('Specific symbol name'),
  depth: z.number().optional().default(2).describe('Max traversal depth'),
});

export const searchCodebaseSchema = z.object({
  query: z.string().describe('Search query text'),
  top_k: z.number().optional().default(8).describe('Number of results to return'),
});

export const analyzeDiffSchema = z.object({
  diff: z.string().describe('Unified diff text'),
  base_ref: z.string().optional().describe('Base git ref'),
  head_ref: z.string().optional().describe('Head git ref'),
});

export const getDependencyGraphSchema = z.object({
  path_filter: z.string().optional().describe('Filter graph by file path substring'),
  format: z.enum(['json', 'mermaid']).optional().default('json').describe('Output format'),
});

// ─── Tool Implementations ──────────────────────────────────────────

export function createToolHandlers(repoRoot: string) {
  const config = loadConfig(repoRoot);
  const store = new SifthookStore(repoRoot);

  return {
    get_blast_radius: async (input: z.infer<typeof getBlastRadiusSchema>) => {
      const filePath = path.resolve(repoRoot, input.file).replace(/\\/g, '/');
      const nodes = computeBlastRadius(store, filePath, input.symbol, input.depth);

      return {
        affected: nodes.map(n => ({
          file: path.relative(repoRoot, n.file),
          symbol: n.symbol,
          relation: n.relation,
          distance: n.distance,
        })),
      };
    },

    search_codebase: async (input: z.infer<typeof searchCodebaseSchema>) => {
      const results = await searchSymbols(store.getSifthookDir(), input.query, input.top_k);

      return {
        results: results.map(r => ({
          file: path.relative(repoRoot, r.file_path),
          symbol: r.symbol_name,
          score: r.score,
          snippet: r.summary_text,
        })),
      };
    },

    analyze_diff: async (input: z.infer<typeof analyzeDiffSchema>) => {
      // Parse the diff
      const diffFiles = parseDiffText(input.diff);

      // Compute blast radius for changed files
      const allBlastRadius: any[] = [];
      const changedFiles = new Set<string>();
      for (const df of diffFiles) {
        const file = df.to ?? df.from;
        if (file) {
          changedFiles.add(path.resolve(repoRoot, file).replace(/\\/g, '/'));
        }
      }

      for (const filePath of changedFiles) {
        const nodes = computeBlastRadius(store, filePath, undefined, config.max_depth);
        for (const node of nodes) {
          if (!allBlastRadius.some((n: any) => n.file === node.file && n.symbol === node.symbol)) {
            allBlastRadius.push(node);
          }
        }
      }

      // Build context and call Claude / AI Provider
      const { prompt } = buildReviewPrompt(diffFiles, allBlastRadius, store, repoRoot);
      const review = await reviewWithClaude(prompt, config);

      return review;
    },

    get_dependency_graph: async (input: z.infer<typeof getDependencyGraphSchema>) => {
      const graphData = store.getFullGraph(input.path_filter);

      if (input.format === 'mermaid') {
        return { graph: toMermaid(graphData, repoRoot) };
      }

      return {
        graph: JSON.stringify({
          files: graphData.files.map(f => ({
            ...f,
            path: path.relative(repoRoot, f.path),
          })),
          symbols: graphData.symbols,
          edges: graphData.edges,
        }, null, 2),
      };
    },

    cleanup: () => {
      store.close();
    },
  };
}

/**
 * Convert graph data to a Mermaid diagram string.
 */
function toMermaid(
  graphData: { files: any[]; symbols: any[]; edges: any[] },
  repoRoot: string
): string {
  const lines: string[] = ['flowchart LR'];

  // Create node IDs from symbol IDs
  const symbolMap = new Map<number, any>();
  for (const sym of graphData.symbols) {
    symbolMap.set(sym.id, sym);
  }

  // Group symbols by file
  const fileSymbols = new Map<number, any[]>();
  for (const sym of graphData.symbols) {
    const existing = fileSymbols.get(sym.file_id) ?? [];
    existing.push(sym);
    fileSymbols.set(sym.file_id, existing);
  }

  // Create subgraphs per file
  for (const file of graphData.files) {
    const relPath = path.relative(repoRoot, file.path);
    const symbols = fileSymbols.get(file.id) ?? [];
    if (symbols.length > 0) {
      lines.push(`  subgraph ${sanitizeMermaidId(relPath)}["${relPath}"]`);
      for (const sym of symbols) {
        lines.push(`    S${sym.id}["${sym.kind}: ${sym.name}"]`);
      }
      lines.push('  end');
    }
  }

  // Create edges
  for (const edge of graphData.edges) {
    const label = edge.edge_type;
    lines.push(`  S${edge.from_symbol_id} -->|${label}| S${edge.to_symbol_id}`);
  }

  return lines.join('\n');
}

function sanitizeMermaidId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, '_');
}
