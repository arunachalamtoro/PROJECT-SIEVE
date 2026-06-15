/**
 * Embeddings — local embedding generation using @xenova/transformers.
 * Stores vectors in LanceDB for semantic search.
 */

import path from 'node:path';
import fs from 'node:fs';
import type { SifthookdevStore } from './store.js';
import type { SymbolRecord } from '../types.js';

// LanceDB and transformers are loaded dynamically to avoid startup cost
let lancedb: typeof import('@lancedb/lancedb') | null = null;
let pipeline: any = null;
let embeddingPipeline: any = null;

const VECTOR_TABLE = 'symbol_vectors';
const MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';

/**
 * Lazily initialize the embedding pipeline.
 */
async function getEmbeddingPipeline(): Promise<any> {
  if (embeddingPipeline) return embeddingPipeline;

  // Dynamic import to avoid loading at startup
  const transformers = await import('@xenova/transformers');
  pipeline = transformers.pipeline;
  embeddingPipeline = await pipeline('feature-extraction', MODEL_NAME, {
    quantized: true,
  });

  return embeddingPipeline;
}

/**
 * Get or create LanceDB connection.
 */
async function getLanceDB(sifthookdevDir: string) {
  if (!lancedb) {
    lancedb = await import('@lancedb/lancedb');
  }
  const vectorDir = path.join(sifthookdevDir, 'vectors');
  fs.mkdirSync(vectorDir, { recursive: true });
  return lancedb.connect(vectorDir);
}

/**
 * Build a text summary for a symbol (used as embedding input).
 */
function buildSymbolSummary(symbol: SymbolRecord, filePath: string): string {
  const parts = [
    `${symbol.kind} ${symbol.name}`,
    symbol.signature ? `signature: ${symbol.signature}` : '',
    `in file ${path.basename(filePath)}`,
    `lines ${symbol.start_line}-${symbol.end_line}`,
  ];
  return parts.filter(Boolean).join(' | ');
}

/**
 * Generate embeddings for all symbols in the store and save to LanceDB.
 */
export async function generateAndStoreEmbeddings(
  store: SifthookdevStore,
  repoRoot: string
): Promise<number> {
  const extractor = await getEmbeddingPipeline();
  const db = await getLanceDB(store.getSifthookdevDir());

  const files = store.getAllFiles();
  const records: Array<{
    symbol_id: number;
    file_path: string;
    symbol_name: string;
    symbol_kind: string;
    summary_text: string;
    vector: number[];
  }> = [];

  // Process files in batches for memory efficiency
  for (const file of files) {
    const symbols = store.getSymbolsByFile(file.id);
    for (const symbol of symbols) {
      const summary = buildSymbolSummary(symbol, file.path);

      // Generate embedding
      const output = await extractor(summary, {
        pooling: 'mean',
        normalize: true,
      });
      const vector = Array.from(output.data as Float32Array);

      records.push({
        symbol_id: symbol.id,
        file_path: file.path,
        symbol_name: symbol.name,
        symbol_kind: symbol.kind,
        summary_text: summary,
        vector,
      });
    }
  }

  if (records.length === 0) return 0;

  // Write to LanceDB
  try {
    // Try to drop existing table
    await db.dropTable(VECTOR_TABLE).catch(() => {});
  } catch {
    // Table doesn't exist yet, that's fine
  }

  await db.createTable(VECTOR_TABLE, records);

  return records.length;
}

/**
 * Search for symbols semantically using a text query.
 */
export async function searchSymbols(
  sifthookdevDir: string,
  query: string,
  topK: number = 8
): Promise<
  Array<{
    symbol_id: number;
    file_path: string;
    symbol_name: string;
    symbol_kind: string;
    summary_text: string;
    score: number;
  }>
> {
  const extractor = await getEmbeddingPipeline();
  const db = await getLanceDB(sifthookdevDir);

  // Generate query embedding
  const output = await extractor(query, {
    pooling: 'mean',
    normalize: true,
  });
  const queryVector = Array.from(output.data as Float32Array);

  // Search LanceDB
  let table;
  try {
    table = await db.openTable(VECTOR_TABLE);
  } catch {
    return []; // No embeddings yet
  }

  const results = await table
    .vectorSearch(queryVector)
    .limit(topK)
    .toArray();

  return results.map((r: any) => ({
    symbol_id: r.symbol_id,
    file_path: r.file_path,
    symbol_name: r.symbol_name,
    symbol_kind: r.symbol_kind,
    summary_text: r.summary_text,
    score: r._distance != null ? 1 / (1 + r._distance) : 0,
  }));
}

/**
 * Update embeddings for a single file (for daemon incremental updates).
 */
export async function updateFileEmbeddings(
  store: SifthookdevStore,
  fileId: number,
  filePath: string
): Promise<number> {
  const extractor = await getEmbeddingPipeline();
  const db = await getLanceDB(store.getSifthookdevDir());

  const symbols = store.getSymbolsByFile(fileId);
  const records: Array<{
    symbol_id: number;
    file_path: string;
    symbol_name: string;
    symbol_kind: string;
    summary_text: string;
    vector: number[];
  }> = [];

  for (const symbol of symbols) {
    const summary = buildSymbolSummary(symbol, filePath);
    const output = await extractor(summary, {
      pooling: 'mean',
      normalize: true,
    });
    const vector = Array.from(output.data as Float32Array);

    records.push({
      symbol_id: symbol.id,
      file_path: filePath,
      symbol_name: symbol.name,
      symbol_kind: symbol.kind,
      summary_text: summary,
      vector,
    });
  }

  if (records.length === 0) return 0;

  try {
    const table = await db.openTable(VECTOR_TABLE);
    // Delete old records for this file and add new ones
    await table.delete(`file_path = '${filePath}'`);
    await table.add(records);
  } catch {
    // Table doesn't exist yet — create it
    await db.createTable(VECTOR_TABLE, records);
  }

  return records.length;
}
