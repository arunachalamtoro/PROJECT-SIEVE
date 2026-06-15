/**
 * `sieve init` — Index a repository and build the dependency graph.
 * Walks the repo, parses source files with tree-sitter, extracts symbols and edges,
 * and persists everything to .sieve/graph.db.
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import ignore from 'ignore';
import { parseFile, detectLanguage } from '../../indexer/parser.js';
import { buildGraph } from '../../indexer/graph-builder.js';
import { SieveStore } from '../../indexer/store.js';
import { generateAndStoreEmbeddings } from '../../indexer/embeddings.js';
import { analyzeTemporalCoupling } from '../../indexer/temporal.js';
import { loadConfig } from '../../config.js';
import type { ParsedFile } from '../../types.js';

export const initCommand = new Command('init')
  .description('Index the repository and build the dependency graph')
  .option('--path <dir>', 'Repository root path', '.')
  .option('--with-history', 'Analyze git history for temporal coupling')
  .option('--no-embeddings', 'Skip embedding generation')
  .action(async (options) => {
    const startTime = Date.now();
    const repoRoot = path.resolve(options.path);

    console.log('🔬 Sieve — Indexing repository...');
    console.log(`   Root: ${repoRoot}\n`);

    const config = loadConfig(repoRoot);

    // 1. Discover files
    const files = discoverFiles(repoRoot, config.exclude_patterns);
    console.log(`📁 Found ${files.length} source files\n`);

    if (files.length === 0) {
      console.log('⚠️  No supported source files found. Sieve supports: .ts, .tsx, .js, .jsx, .py');
      return;
    }

    // 2. Parse each file
    console.log('🌳 Parsing with tree-sitter...');
    const parsedFiles: ParsedFile[] = [];
    const contentHashes = new Map<string, string>();
    let parseErrors = 0;

    for (const file of files) {
      try {
        const source = fs.readFileSync(file, 'utf-8');
        const hash = crypto.createHash('sha256').update(source).digest('hex');
        contentHashes.set(file.replace(/\\/g, '/'), hash);

        const parsed = await parseFile(file.replace(/\\/g, '/'), source);
        if (parsed) {
          parsedFiles.push(parsed);
        }
      } catch (err) {
        parseErrors++;
        if (parseErrors <= 5) {
          console.log(`   ⚠️  Failed to parse: ${path.relative(repoRoot, file)}`);
        }
      }
    }

    if (parseErrors > 5) {
      console.log(`   ... and ${parseErrors - 5} more parse errors`);
    }

    console.log(`   Parsed ${parsedFiles.length} files successfully\n`);

    // 3. Build dependency graph
    console.log('🔗 Building dependency graph...');
    const graph = buildGraph(parsedFiles);

    // 4. Store in SQLite
    console.log('💾 Writing to .sieve/graph.db...');
    const store = new SieveStore(repoRoot);
    const stats = store.storeGraph(graph, contentHashes);

    console.log(`   ✅ ${stats.filesIndexed} files indexed`);
    console.log(`   ✅ ${stats.symbolsFound} symbols found`);
    console.log(`   ✅ ${stats.edgesFound} edges found\n`);

    // 5. Generate embeddings (unless --no-embeddings)
    if (options.embeddings !== false) {
      console.log('🧠 Generating local embeddings (all-MiniLM-L6-v2)...');
      try {
        const embeddingCount = await generateAndStoreEmbeddings(store, repoRoot);
        console.log(`   ✅ ${embeddingCount} symbol embeddings stored\n`);
      } catch (err) {
        console.log(`   ⚠️  Embedding generation failed (non-critical): ${(err as Error).message}`);
        console.log('   Semantic search will be unavailable. Run sieve init again to retry.\n');
      }
    }

    // 6. Temporal coupling (if --with-history)
    if (options.withHistory) {
      console.log('📜 Analyzing git history for temporal coupling...');
      try {
        const temporalCount = await analyzeTemporalCoupling(store, repoRoot, config);
        console.log(`   ✅ ${temporalCount} temporal edges found\n`);
      } catch (err) {
        console.log(`   ⚠️  Temporal analysis failed: ${(err as Error).message}\n`);
      }
    }

    // 7. Summary
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const finalStats = store.getStats();

    console.log('━'.repeat(50));
    console.log('✨ Indexing complete!\n');
    console.log(`   Files:           ${finalStats.files}`);
    console.log(`   Symbols:         ${finalStats.symbols}`);
    console.log(`   Edges:           ${finalStats.edges}`);
    if (finalStats.temporalEdges > 0) {
      console.log(`   Temporal Edges:  ${finalStats.temporalEdges}`);
    }
    console.log(`   Time:            ${elapsed}s`);
    console.log(`   Data:            ${store.getSieveDir()}`);
    console.log('━'.repeat(50));

    store.close();
  });

/**
 * Walk the repository and discover all supported source files,
 * respecting .gitignore patterns.
 */
function discoverFiles(repoRoot: string, excludePatterns: string[]): string[] {
  const ig = ignore();

  // Load .gitignore if it exists
  const gitignorePath = path.join(repoRoot, '.gitignore');
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
    ig.add(gitignoreContent);
  }

  // Add built-in exclude patterns
  ig.add(excludePatterns);

  const files: string[] = [];

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(repoRoot, fullPath).replace(/\\/g, '/');

      // Skip hidden directories and files
      if (entry.name.startsWith('.')) continue;

      if (ig.ignores(relativePath)) continue;

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const lang = detectLanguage(fullPath);
        if (lang) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(repoRoot);
  return files;
}
