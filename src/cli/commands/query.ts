/**
 * `sieve query` — Query the blast radius of a file or symbol.
 */

import { Command } from 'commander';
import path from 'node:path';
import { SieveStore } from '../../indexer/store.js';
import { computeBlastRadius, formatBlastRadiusTree } from '../../analyzer/blast-radius.js';
import { loadConfig } from '../../config.js';

export const queryCommand = new Command('query')
  .description('Query the blast radius of a file or symbol')
  .argument('<file>', 'File path to query')
  .option('--symbol <name>', 'Specific symbol to query')
  .option('--depth <n>', 'Max traversal depth', '2')
  .option('--no-temporal', 'Exclude temporal coupling edges')
  .option('--path <dir>', 'Repository root path', '.')
  .action(async (file: string, options) => {
    const repoRoot = path.resolve(options.path);
    const config = loadConfig(repoRoot);
    const depth = parseInt(options.depth, 10) || config.max_depth;

    // Normalize the file path
    const filePath = path.resolve(repoRoot, file).replace(/\\/g, '/');

    const store = new SieveStore(repoRoot);

    try {
      const nodes = computeBlastRadius(
        store,
        filePath,
        options.symbol,
        depth,
        options.temporal !== false
      );

      const output = formatBlastRadiusTree(
        path.relative(repoRoot, filePath),
        options.symbol,
        nodes.map(n => ({
          ...n,
          file: path.relative(repoRoot, n.file),
        }))
      );

      console.log(output);
    } finally {
      store.close();
    }
  });
