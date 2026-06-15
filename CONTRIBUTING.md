# Contributing to Project Sifthookdev

First off, thanks for taking the time to contribute! 🎉

## How Can I Contribute?

### 🌍 Adding New Language Support

This is the **highest-value contribution** you can make. Sifthookdev uses tree-sitter for parsing, and adding a new language is straightforward:

1. **Add the grammar**: Place the WASM grammar file in `grammars/tree-sitter-<language>.wasm`
2. **Register the language**: Update `src/indexer/parser.ts`:
   - Add the language to `detectLanguage()` (file extension mapping)
   - Add the grammar name to `grammarName()`
   - Add extraction functions (`extract<Lang>Symbols`, `extract<Lang>Imports`, etc.)
3. **Update types**: Add the language to `SupportedLanguage` in `src/types.ts`
4. **Write tests**: Add a fixture project in `test-fixtures/<language>/` with known imports and calls

The pattern is always the same:
- Walk the tree-sitter AST
- Extract symbols (functions, classes, types)
- Extract imports and calls
- The graph builder handles the rest

### 🐛 Bug Reports

Open an issue with:
- What you expected to happen
- What actually happened
- Steps to reproduce
- Output of `sifthookdev init` and relevant commands
- Your Node.js version (`node -v`)

### 💡 Feature Requests

Open an issue with the `enhancement` label. Describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you've considered

### 🔧 Code Contributions

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`npm test`)
5. Commit with a clear message
6. Open a PR

## Development Setup

```bash
# Clone the repo
git clone https://github.com/your-fork/project-sifthookdev.git
cd project-sifthookdev

# Install dependencies
npm install

# Download tree-sitter grammars
npm run download-grammars

# Run the CLI in dev mode
npm run sifthookdev -- init

# Run tests
npm test
```

## Code Style

- TypeScript strict mode
- ESM modules
- Keep CLI output as structured data + pretty-printer
- Every Claude API call must log token usage and estimated cost
- Test with Vitest

## Architecture

```
src/
├── indexer/     # AST parsing, graph building, embeddings, storage
├── analyzer/    # Diff parsing, blast radius, context building, review
├── mcp/         # MCP server and tool definitions
├── daemon/      # Background file watching and pre-computation
├── cli/         # Commander commands
└── types.ts     # Shared interfaces
```

The key principle: **the dependency graph is the product**. Every feature should keep it correct and queryable.
