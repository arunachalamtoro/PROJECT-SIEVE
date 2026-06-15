// ─── Core Data Model ───────────────────────────────────────────────

/**
 * Supported languages for AST parsing.
 */
export type SupportedLanguage = 'typescript' | 'javascript' | 'python';

/**
 * Kinds of symbols extracted from source code.
 */
export type SymbolKind = 'function' | 'class' | 'interface' | 'variable' | 'type' | 'method';

/**
 * Types of edges (dependencies) between symbols.
 */
export type EdgeType = 'imports' | 'calls' | 'extends' | 'implements' | 'references' | 'temporal';

/**
 * Risk level assigned by the reviewer.
 */
export type RiskLevel = 'low' | 'medium' | 'high';

// ─── Database Records ──────────────────────────────────────────────

export interface FileRecord {
  id: number;
  path: string;
  language: SupportedLanguage;
  content_hash: string;
  last_indexed_at: string;
}

export interface SymbolRecord {
  id: number;
  file_id: number;
  name: string;
  kind: SymbolKind;
  start_line: number;
  end_line: number;
  signature: string | null;
}

export interface EdgeRecord {
  id: number;
  from_symbol_id: number;
  to_symbol_id: number;
  edge_type: EdgeType;
}

export interface TemporalEdgeRecord {
  id: number;
  file_a_id: number;
  file_b_id: number;
  co_commit_count: number;
  total_commits_a: number;
  total_commits_b: number;
  coupling_score: number;
}

// ─── Indexer Types ─────────────────────────────────────────────────

export interface ParsedSymbol {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  signature: string | null;
}

export interface ParsedImport {
  source: string;          // module specifier (e.g., './utils' or 'lodash')
  importedNames: string[]; // named imports; ['*'] for namespace, ['default'] for default
}

export interface ParsedCall {
  calleeName: string;      // name of the function/method being called
  line: number;
}

export interface ParsedInheritance {
  childName: string;
  parentName: string;
  kind: 'extends' | 'implements';
}

export interface ParsedFile {
  filePath: string;
  language: SupportedLanguage;
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
  calls: ParsedCall[];
  inheritances: ParsedInheritance[];
}

// ─── Analyzer Types ────────────────────────────────────────────────

export interface DiffHunk {
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  addedLines: string[];
  removedLines: string[];
}

export interface DiffFile {
  from: string | null;
  to: string | null;
  chunks: DiffHunk[];
  additions: number;
  deletions: number;
}

export interface BlastRadiusNode {
  file: string;
  symbol: string;
  symbolKind: SymbolKind;
  relation: EdgeType;
  distance: number;
  signature: string | null;
}

export interface TokenUsage {
  input: number;
  output: number;
  estimated_cost_usd: number;
}

export interface ReviewResult {
  summary: string;
  risk_level: RiskLevel;
  breaking_changes: string[];
  blast_radius: Array<{ file: string; reason: string }>;
  suggestions: string[];
  tokens_used: TokenUsage;
}

// ─── MCP Types ─────────────────────────────────────────────────────

export interface BlastRadiusInput {
  file: string;
  symbol?: string;
  depth?: number;
}

export interface BlastRadiusOutput {
  affected: Array<{
    file: string;
    symbol: string;
    relation: string;
    distance: number;
  }>;
}

export interface SearchInput {
  query: string;
  top_k?: number;
}

export interface SearchOutput {
  results: Array<{
    file: string;
    symbol: string;
    score: number;
    snippet: string;
  }>;
}

export interface AnalyzeDiffInput {
  diff: string;
  base_ref?: string;
  head_ref?: string;
}

export interface GraphInput {
  path_filter?: string;
  format?: 'json' | 'mermaid';
}

export interface GraphOutput {
  graph: string;
}

// ─── Config ────────────────────────────────────────────────────────

export interface SifthookConfig {
  /** Max blast-radius BFS depth (default: 2) */
  max_depth: number;

  /** Languages to parse (default: all supported) */
  languages: SupportedLanguage[];

  /** AI Provider (default: anthropic) */
  provider: 'anthropic' | 'openrouter' | 'custom';

  /** Environment variable name containing the API key (default: ANTHROPIC_API_KEY) */
  api_key_env_var: string;

  /** Base URL for OpenAI-compatible providers (like OpenRouter) */
  api_base_url?: string;

  /** Claude model to use for reviews (default: claude-sonnet-4-20250514) */
  model: string;

  /** Max cost per review in USD. Hard-fail if exceeded (default: 0.10) */
  max_cost_per_review: number;

  /** Temporal coupling threshold (0-1, default: 0.8) */
  temporal_coupling_threshold: number;

  /** Number of git commits to analyze for temporal coupling (default: 500) */
  temporal_commit_limit: number;

  /** Glob patterns to exclude from indexing */
  exclude_patterns: string[];
}

export const DEFAULT_CONFIG: SifthookConfig = {
  max_depth: 2,
  languages: ['typescript', 'javascript', 'python'],
  provider: 'anthropic',
  api_key_env_var: 'ANTHROPIC_API_KEY',
  model: 'claude-sonnet-4-20250514',
  max_cost_per_review: 0.10,
  temporal_coupling_threshold: 0.80,
  temporal_commit_limit: 500,
  exclude_patterns: [
    'node_modules/**',
    'dist/**',
    '.sifthook/**',
    '**/*.test.*',
    '**/*.spec.*',
    'coverage/**',
    '__pycache__/**',
    '.git/**',
  ],
};

// ─── Token Pricing ─────────────────────────────────────────────────

/** Per-token prices in USD. Updated easily here. */
export const TOKEN_PRICES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-20250514': { input: 3.0 / 1_000_000, output: 15.0 / 1_000_000 },
  'claude-haiku-4-20250514': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
  'claude-3-5-haiku-20241022': { input: 0.80 / 1_000_000, output: 4.0 / 1_000_000 },
};

/** Estimate token count from text (rough: 1 token ≈ 4 chars) */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Calculate cost from token usage and model */
export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices = TOKEN_PRICES[model] ?? TOKEN_PRICES['claude-sonnet-4-20250514']!;
  return inputTokens * prices.input + outputTokens * prices.output;
}
