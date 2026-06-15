/**
 * `sieve search` — Semantic search over the codebase using embeddings.
 */

import { Command } from 'commander';
import path from 'node:path';
import { SieveStore } from '../../indexer/store.js';
import { searchSymbols } from '../../indexer/embeddings.js';

export const searchCommand = new Command('search')
  .description('Semantic search over the codebase')
  .argument('<query>', 'Search query text')
  .option('--top <n>', 'Number of results to return', '8')
  .option('--path <dir>', 'Repository root path', '.')
  .action(async (query: string, options) => {
    const repoRoot = path.resolve(options.path);
    const topK = parseInt(options.top, 10) || 8;

    const store = new SieveStore(repoRoot);

    try {
      console.log(`🔍 Searching for: "${query}"\n`);

      const results = await searchSymbols(store.getSieveDir(), query, topK);

      if (results.length === 0) {
        console.log('  No results found. Make sure you\'ve run `sieve init` first.');
        return;
      }

      console.log(`Found ${results.length} results:\n`);

      for (let i = 0; i < results.length; i++) {
        const r = results[i]!;
        const relPath = path.relative(repoRoot, r.file_path);
        const scoreStr = (r.score * 100).toFixed(1);
        console.log(`  ${i + 1}. [${scoreStr}%] ${r.symbol_kind} ${r.symbol_name}`);
        console.log(`     📄 ${relPath}`);
        console.log(`     ${r.summary_text}\n`);
      }
    } finally {
      store.close();
    }
  });
