/**
 * `sifthook serve` — Start the MCP server.
 */

import { Command } from 'commander';
import path from 'node:path';
import { startMCPServer } from '../../mcp/server.js';

export const serveCommand = new Command('serve')
  .description('Start the Sifthook MCP server (stdio transport)')
  .option('--path <dir>', 'Repository root path', '.')
  .action(async (options) => {
    const repoRoot = path.resolve(options.path);

    // When running as MCP server, suppress all console.log
    // (MCP uses stdio for communication)
    console.error('🔬 Sifthook MCP Server starting...');
    console.error(`   Repository: ${repoRoot}`);
    console.error('   Transport:  stdio');
    console.error('   Tools:      get_blast_radius, search_codebase, analyze_diff, get_dependency_graph');
    console.error('');
    console.error('   Waiting for MCP client connection...');

    await startMCPServer(repoRoot);
  });
