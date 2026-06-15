/**
 * Store — SQLite persistence layer using Node.js built-in node:sqlite.
 * Manages .sifthook/graph.db for the dependency graph.
 * No native compilation required — uses the WASM-based SQLite built into Node.js 22.5+.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import type {
  FileRecord,
  SymbolRecord,
  EdgeRecord,
  TemporalEdgeRecord,
  SupportedLanguage,
  SymbolKind,
  EdgeType,
} from '../types.js';
import type { DependencyGraph } from './graph-builder.js';

const SIFTHOOK_DIR = '.sifthook';
const DB_FILE = 'graph.db';

export class SifthookStore {
  private db: DatabaseSync;
  private sifthookDir: string;

  constructor(repoRoot: string) {
    this.sifthookDir = path.join(repoRoot, SIFTHOOK_DIR);
    fs.mkdirSync(this.sifthookDir, { recursive: true });

    const dbPath = path.join(this.sifthookDir, DB_FILE);
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA foreign_keys = ON');
    this.initSchema();
  }

  /**
   * Initialize the SQLite schema.
   */
  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        language TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        last_indexed_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS symbols (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        start_line INTEGER NOT NULL,
        end_line INTEGER NOT NULL,
        signature TEXT
      );

      CREATE TABLE IF NOT EXISTS edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        from_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        to_symbol_id INTEGER NOT NULL REFERENCES symbols(id) ON DELETE CASCADE,
        edge_type TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS temporal_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_a_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        file_b_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
        co_commit_count INTEGER NOT NULL,
        total_commits_a INTEGER NOT NULL,
        total_commits_b INTEGER NOT NULL,
        coupling_score REAL NOT NULL
      );
    `);

    // Create indexes (using separate statements since node:sqlite may not support multiple in one exec)
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_edges_to ON edges(to_symbol_id)',
      'CREATE INDEX IF NOT EXISTS idx_edges_from ON edges(from_symbol_id)',
      'CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_id)',
      'CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name)',
      'CREATE INDEX IF NOT EXISTS idx_temporal_file_a ON temporal_edges(file_a_id)',
      'CREATE INDEX IF NOT EXISTS idx_temporal_file_b ON temporal_edges(file_b_id)',
    ];
    for (const idx of indexes) {
      this.db.exec(idx);
    }
  }

  /**
   * Get the .sifthook directory path.
   */
  getSifthookDir(): string {
    return this.sifthookDir;
  }

  /**
   * Check if a file needs re-indexing by comparing content hashes.
   */
  needsReindex(filePath: string, contentHash: string): boolean {
    const stmt = this.db.prepare('SELECT content_hash FROM files WHERE path = ?');
    const row = stmt.get(filePath) as { content_hash: string } | undefined;
    return !row || row.content_hash !== contentHash;
  }

  /**
   * Clear all data for a file (for re-indexing).
   */
  clearFile(filePath: string): void {
    const stmt = this.db.prepare('SELECT id FROM files WHERE path = ?');
    const file = stmt.get(filePath) as { id: number } | undefined;
    if (file) {
      // Delete edges referencing symbols in this file
      this.db.exec(`DELETE FROM edges WHERE from_symbol_id IN (SELECT id FROM symbols WHERE file_id = ${file.id}) OR to_symbol_id IN (SELECT id FROM symbols WHERE file_id = ${file.id})`);
      // Delete symbols
      this.db.exec(`DELETE FROM symbols WHERE file_id = ${file.id}`);
      // Delete temporal edges
      this.db.exec(`DELETE FROM temporal_edges WHERE file_a_id = ${file.id} OR file_b_id = ${file.id}`);
      // Delete file record
      this.db.exec(`DELETE FROM files WHERE id = ${file.id}`);
    }
  }

  /**
   * Store a complete dependency graph from parsed files.
   */
  storeGraph(graph: DependencyGraph, contentHashes: Map<string, string>): {
    filesIndexed: number;
    symbolsFound: number;
    edgesFound: number;
  } {
    const insertFile = this.db.prepare(
      'INSERT INTO files (path, language, content_hash, last_indexed_at) VALUES (?, ?, ?, ?)'
    );
    const insertSymbol = this.db.prepare(
      'INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature) VALUES (?, ?, ?, ?, ?, ?)'
    );
    const insertEdge = this.db.prepare(
      'INSERT INTO edges (from_symbol_id, to_symbol_id, edge_type) VALUES (?, ?, ?)'
    );

    let filesIndexed = 0;
    let symbolsFound = 0;
    let edgesFound = 0;

    // Map from filePath:symbolName to symbolId
    const symbolIdMap = new Map<string, number>();

    // Wrap in a transaction for performance
    this.db.exec('BEGIN TRANSACTION');

    try {
      // 1. Insert files and symbols
      for (const filePath of graph.files) {
        const symbols = graph.symbols.get(filePath) ?? [];
        const hash = contentHashes.get(filePath) ?? '';
        const language = this.detectLangFromPath(filePath);

        // Clear existing data for this file
        this.clearFile(filePath);

        const fileResult = insertFile.run(
          filePath,
          language,
          hash,
          new Date().toISOString()
        );
        // node:sqlite returns lastInsertRowid differently
        const fileId = (fileResult as any).lastInsertRowid ?? this.getLastInsertRowId();
        filesIndexed++;

        for (const { symbol } of symbols) {
          const symResult = insertSymbol.run(
            fileId,
            symbol.name,
            symbol.kind,
            symbol.startLine,
            symbol.endLine,
            symbol.signature
          );
          const symId = (symResult as any).lastInsertRowid ?? this.getLastInsertRowId();
          symbolIdMap.set(`${filePath}:${symbol.name}`, symId);
          symbolsFound++;
        }
      }

      // 2. Insert edges
      for (const edge of graph.edges) {
        const fromId = symbolIdMap.get(`${edge.fromFile}:${edge.fromSymbol}`);
        const toId = symbolIdMap.get(`${edge.toFile}:${edge.toSymbol}`);

        if (fromId && toId) {
          insertEdge.run(fromId, toId, edge.edgeType);
          edgesFound++;
        }
      }

      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return { filesIndexed, symbolsFound, edgesFound };
  }

  /**
   * Get the last insert rowid.
   */
  private getLastInsertRowId(): number {
    const stmt = this.db.prepare('SELECT last_insert_rowid() as id');
    const row = stmt.get() as { id: number };
    return row.id;
  }

  /**
   * Store a single file and its symbols (for incremental updates).
   */
  storeFile(
    filePath: string,
    language: SupportedLanguage,
    contentHash: string,
    symbols: Array<{ name: string; kind: SymbolKind; startLine: number; endLine: number; signature: string | null }>
  ): number {
    this.clearFile(filePath);

    const insertFile = this.db.prepare(
      'INSERT INTO files (path, language, content_hash, last_indexed_at) VALUES (?, ?, ?, ?)'
    );
    insertFile.run(filePath, language, contentHash, new Date().toISOString());
    const fileId = this.getLastInsertRowId();

    const insertSymbol = this.db.prepare(
      'INSERT INTO symbols (file_id, name, kind, start_line, end_line, signature) VALUES (?, ?, ?, ?, ?, ?)'
    );

    for (const sym of symbols) {
      insertSymbol.run(fileId, sym.name, sym.kind, sym.startLine, sym.endLine, sym.signature);
    }

    return fileId;
  }

  /**
   * Store temporal coupling edges.
   */
  storeTemporalEdges(
    edges: Array<{
      fileA: string;
      fileB: string;
      coCommitCount: number;
      totalCommitsA: number;
      totalCommitsB: number;
      couplingScore: number;
    }>
  ): number {
    // Clear existing temporal edges
    this.db.exec('DELETE FROM temporal_edges');

    const insert = this.db.prepare(
      `INSERT INTO temporal_edges (file_a_id, file_b_id, co_commit_count, total_commits_a, total_commits_b, coupling_score)
       VALUES (?, ?, ?, ?, ?, ?)`
    );

    let count = 0;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const edge of edges) {
        const fileA = this.getFileByPath(edge.fileA);
        const fileB = this.getFileByPath(edge.fileB);
        if (fileA && fileB) {
          insert.run(fileA.id, fileB.id, edge.coCommitCount, edge.totalCommitsA, edge.totalCommitsB, edge.couplingScore);
          count++;
        }
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }

    return count;
  }

  /**
   * Get a file record by path.
   */
  getFileByPath(filePath: string): FileRecord | undefined {
    const stmt = this.db.prepare('SELECT * FROM files WHERE path = ?');
    return stmt.get(filePath) as FileRecord | undefined;
  }

  /**
   * Get all file records.
   */
  getAllFiles(): FileRecord[] {
    const stmt = this.db.prepare('SELECT * FROM files');
    return stmt.all() as unknown as FileRecord[];
  }

  /**
   * Get symbols for a file.
   */
  getSymbolsByFile(fileId: number): SymbolRecord[] {
    const stmt = this.db.prepare('SELECT * FROM symbols WHERE file_id = ?');
    return stmt.all(fileId) as unknown as SymbolRecord[];
  }

  /**
   * Get symbols by file path.
   */
  getSymbolsByFilePath(filePath: string): SymbolRecord[] {
    const stmt = this.db.prepare(`
      SELECT s.* FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE f.path = ?
    `);
    return stmt.all(filePath) as unknown as SymbolRecord[];
  }

  /**
   * Find a symbol by name (across all files).
   */
  findSymbolByName(name: string): (SymbolRecord & { file_path: string })[] {
    const stmt = this.db.prepare(`
      SELECT s.*, f.path as file_path FROM symbols s
      JOIN files f ON s.file_id = f.id
      WHERE s.name = ? OR s.name LIKE ?
    `);
    return stmt.all(name, `%.${name}`) as unknown as (SymbolRecord & { file_path: string })[];
  }

  /**
   * Get all edges from a symbol (outgoing).
   */
  getEdgesFrom(symbolId: number): (EdgeRecord & { to_name: string; to_file: string })[] {
    const stmt = this.db.prepare(`
      SELECT e.*, s.name as to_name, f.path as to_file
      FROM edges e
      JOIN symbols s ON e.to_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE e.from_symbol_id = ?
    `);
    return stmt.all(symbolId) as unknown as (EdgeRecord & { to_name: string; to_file: string })[];
  }

  /**
   * Get all edges to a symbol (incoming — what depends on this symbol).
   */
  getEdgesTo(symbolId: number): (EdgeRecord & { from_name: string; from_file: string; from_kind: string })[] {
    const stmt = this.db.prepare(`
      SELECT e.*, s.name as from_name, f.path as from_file, s.kind as from_kind
      FROM edges e
      JOIN symbols s ON e.from_symbol_id = s.id
      JOIN files f ON s.file_id = f.id
      WHERE e.to_symbol_id = ?
    `);
    return stmt.all(symbolId) as unknown as (EdgeRecord & { from_name: string; from_file: string; from_kind: string })[];
  }

  /**
   * Get temporal edges for a file.
   */
  getTemporalEdgesForFile(fileId: number): (TemporalEdgeRecord & { coupled_file_path: string })[] {
    const stmtA = this.db.prepare(`
      SELECT te.*, f.path as coupled_file_path
      FROM temporal_edges te
      JOIN files f ON te.file_b_id = f.id
      WHERE te.file_a_id = ?
    `);

    const stmtB = this.db.prepare(`
      SELECT te.*, f.path as coupled_file_path
      FROM temporal_edges te
      JOIN files f ON te.file_a_id = f.id
      WHERE te.file_b_id = ?
    `);

    const asA = stmtA.all(fileId) as unknown as (TemporalEdgeRecord & { coupled_file_path: string })[];
    const asB = stmtB.all(fileId) as unknown as (TemporalEdgeRecord & { coupled_file_path: string })[];

    return [...asA, ...asB];
  }

  /**
   * Get the full dependency graph as JSON.
   */
  getFullGraph(pathFilter?: string): {
    files: FileRecord[];
    symbols: SymbolRecord[];
    edges: EdgeRecord[];
  } {
    let files: FileRecord[];
    if (pathFilter) {
      const stmt = this.db.prepare('SELECT * FROM files WHERE path LIKE ?');
      files = stmt.all(`%${pathFilter}%`) as unknown as FileRecord[];
    } else {
      const stmt = this.db.prepare('SELECT * FROM files');
      files = stmt.all() as unknown as FileRecord[];
    }

    const fileIds = files.map(f => f.id);
    if (fileIds.length === 0) {
      return { files, symbols: [], edges: [] };
    }

    const placeholders = fileIds.map(() => '?').join(',');
    const symStmt = this.db.prepare(
      `SELECT * FROM symbols WHERE file_id IN (${placeholders})`
    );
    const symbols = symStmt.all(...fileIds) as unknown as SymbolRecord[];

    const symbolIds = symbols.map(s => s.id);
    if (symbolIds.length === 0) {
      return { files, symbols, edges: [] };
    }

    const symPlaceholders = symbolIds.map(() => '?').join(',');
    const edgeStmt = this.db.prepare(
      `SELECT * FROM edges WHERE from_symbol_id IN (${symPlaceholders}) OR to_symbol_id IN (${symPlaceholders})`
    );
    const edges = edgeStmt.all(...symbolIds, ...symbolIds) as unknown as EdgeRecord[];

    return { files, symbols, edges };
  }

  /**
   * Get summary statistics.
   */
  getStats(): { files: number; symbols: number; edges: number; temporalEdges: number } {
    const filesStmt = this.db.prepare('SELECT COUNT(*) as count FROM files');
    const symbolsStmt = this.db.prepare('SELECT COUNT(*) as count FROM symbols');
    const edgesStmt = this.db.prepare('SELECT COUNT(*) as count FROM edges');
    const tempStmt = this.db.prepare('SELECT COUNT(*) as count FROM temporal_edges');

    const files = (filesStmt.get() as { count: number }).count;
    const symbols = (symbolsStmt.get() as { count: number }).count;
    const edges = (edgesStmt.get() as { count: number }).count;
    const temporalEdges = (tempStmt.get() as { count: number }).count;

    return { files, symbols, edges, temporalEdges };
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  private detectLangFromPath(filePath: string): SupportedLanguage {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.py') return 'python';
    if (ext === '.js' || ext === '.jsx' || ext === '.mjs' || ext === '.cjs') return 'javascript';
    return 'typescript';
  }
}
