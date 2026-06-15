/**
 * File Watcher — uses chokidar to watch for file changes and update the graph.
 * Part of the background daemon for pre-computation.
 */

import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { parseFile, detectLanguage } from '../indexer/parser.js';
import { SifthookStore } from '../indexer/store.js';
import { updateFileEmbeddings } from '../indexer/embeddings.js';
import { loadConfig } from '../config.js';
import type { SupportedLanguage } from '../types.js';

export interface WatcherStats {
  filesUpdated: number;
  embeddingsUpdated: number;
  lastUpdateTime: Date | null;
  isRunning: boolean;
}

/**
 * Start watching a repository for file changes.
 * Updates the AST graph and embeddings in the background.
 */
export function startWatcher(
  repoRoot: string,
  store: SifthookStore,
  logFn: (msg: string) => void = console.log
): { watcher: FSWatcher; stats: WatcherStats } {
  const config = loadConfig(repoRoot);
  const stats: WatcherStats = {
    filesUpdated: 0,
    embeddingsUpdated: 0,
    lastUpdateTime: null,
    isRunning: true,
  };

  // Build glob patterns for supported files
  const watchPatterns = [
    path.join(repoRoot, '**/*.ts'),
    path.join(repoRoot, '**/*.tsx'),
    path.join(repoRoot, '**/*.js'),
    path.join(repoRoot, '**/*.jsx'),
    path.join(repoRoot, '**/*.py'),
  ];

  const ignorePatterns = [
    '**/node_modules/**',
    '**/.sifthook/**',
    '**/dist/**',
    '**/coverage/**',
    '**/__pycache__/**',
    '**/.git/**',
    ...config.exclude_patterns,
  ];

  // Debounce map to avoid processing rapid saves
  const debounceTimers = new Map<string, NodeJS.Timeout>();
  const DEBOUNCE_MS = 300;

  const watcher = watch(watchPatterns, {
    ignored: ignorePatterns,
    persistent: true,
    ignoreInitial: true, // Don't fire for existing files on startup
    awaitWriteFinish: {
      stabilityThreshold: 200,
      pollInterval: 100,
    },
  });

  async function handleFileChange(filePath: string): Promise<void> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const language = detectLanguage(normalizedPath);
    if (!language) return;

    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const hash = crypto.createHash('sha256').update(source).digest('hex');

      // Check if file actually changed
      if (!store.needsReindex(normalizedPath, hash)) return;

      logFn(`  🔄 Updating: ${path.relative(repoRoot, filePath)}`);

      // Parse the file
      const parsed = await parseFile(normalizedPath, source);
      if (!parsed) return;

      // Update the store
      const fileId = store.storeFile(
        normalizedPath,
        language,
        hash,
        parsed.symbols.map(s => ({
          name: s.name,
          kind: s.kind,
          startLine: s.startLine,
          endLine: s.endLine,
          signature: s.signature,
        }))
      );

      stats.filesUpdated++;

      // Update embeddings
      try {
        const embCount = await updateFileEmbeddings(store, fileId, normalizedPath);
        stats.embeddingsUpdated += embCount;
      } catch {
        // Embedding update is best-effort
      }

      stats.lastUpdateTime = new Date();
      logFn(`  ✅ Updated: ${path.relative(repoRoot, filePath)} (${parsed.symbols.length} symbols)`);
    } catch (err) {
      logFn(`  ⚠️  Error processing ${path.relative(repoRoot, filePath)}: ${(err as Error).message}`);
    }
  }

  // File change handler with debouncing
  function onFileChange(filePath: string): void {
    const existing = debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    debounceTimers.set(
      filePath,
      setTimeout(() => {
        debounceTimers.delete(filePath);
        handleFileChange(filePath).catch(() => {});
      }, DEBOUNCE_MS)
    );
  }

  watcher.on('change', onFileChange);
  watcher.on('add', onFileChange);
  watcher.on('unlink', (filePath) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    store.clearFile(normalizedPath);
    logFn(`  🗑️  Removed: ${path.relative(repoRoot, filePath)}`);
  });

  watcher.on('error', (err) => {
    logFn(`  ❌ Watcher error: ${(err as Error).message}`);
  });

  return { watcher, stats };
}
