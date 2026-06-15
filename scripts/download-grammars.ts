/**
 * Setup tree-sitter WASM grammars for supported languages.
 * Copies pre-built WASM files from tree-sitter-wasms package.
 * Run with: npm run download-grammars (or npm run prepare)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const grammarsDir = path.join(__dirname, '..', 'grammars');
const wasmsDir = path.join(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out');

const GRAMMARS = [
  'tree-sitter-typescript.wasm',
  'tree-sitter-javascript.wasm',
  'tree-sitter-python.wasm',
];

function main(): void {
  fs.mkdirSync(grammarsDir, { recursive: true });

  console.log('📦 Setting up tree-sitter WASM grammars...\n');

  for (const file of GRAMMARS) {
    const srcPath = path.join(wasmsDir, file);
    const destPath = path.join(grammarsDir, file);

    if (!fs.existsSync(srcPath)) {
      console.error(`  ❌ Missing source grammar: ${file} (did you run npm install?)`);
      continue;
    }

    try {
      fs.copyFileSync(srcPath, destPath);
      console.log(`  ✅ ${file}`);
    } catch (err) {
      console.error(`  ❌ Failed to copy ${file}: ${(err as Error).message}`);
    }
  }

  console.log('\n✨ Done!');
}

main();
