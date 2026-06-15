/**
 * MCP Server — bootstraps an MCP server over stdio.
 * Registers all 4 Sifthookdev tools for any MCP client (Claude Code, Cursor, Brick).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  createToolHandlers,
  getBlastRadiusSchema,
  searchCodebaseSchema,
  analyzeDiffSchema,
  getDependencyGraphSchema,
} from './tools.js';

/**
 * Start the MCP server over stdio.
 */
export async function startMCPServer(repoRoot: string): Promise<void> {
  const server = new McpServer({
    name: 'sifthookdev',
    version: '1.0.0',
  });

  const handlers = createToolHandlers(repoRoot);

  // Register tools
  server.tool(
    'get_blast_radius',
    'Get the blast radius of a file or symbol — find everything that depends on it',
    getBlastRadiusSchema.shape,
    async (input) => {
      const result = await handlers.get_blast_radius(input as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'search_codebase',
    'Semantic search over the codebase using embeddings',
    searchCodebaseSchema.shape,
    async (input) => {
      const result = await handlers.search_codebase(input as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'analyze_diff',
    'Analyze a unified diff with blast-radius-aware AI review',
    analyzeDiffSchema.shape,
    async (input) => {
      const result = await handlers.analyze_diff(input as any);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  server.tool(
    'get_dependency_graph',
    'Get the dependency graph as JSON or Mermaid diagram',
    getDependencyGraphSchema.shape,
    async (input) => {
      const result = await handlers.get_dependency_graph(input as any);
      return {
        content: [{ type: 'text' as const, text: result.graph }],
      };
    }
  );

  // Start the server over stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Handle cleanup
  process.on('SIGINT', () => {
    handlers.cleanup();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    handlers.cleanup();
    process.exit(0);
  });
}
