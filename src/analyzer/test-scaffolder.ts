/**
 * Test Scaffolder — generates boilerplate test files for affected symbols.
 * Supports both Jest and Vitest, auto-detects from project config.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { BlastRadiusNode } from '../types.js';
import type { SifthookdevStore } from '../indexer/store.js';

type TestFramework = 'vitest' | 'jest';

/**
 * Detect which test framework the project uses.
 */
function detectTestFramework(repoRoot: string): TestFramework {
  const packageJsonPath = path.join(repoRoot, 'package.json');

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      const allDeps = {
        ...(pkg.dependencies ?? {}),
        ...(pkg.devDependencies ?? {}),
      };

      if (allDeps['vitest']) return 'vitest';
      if (allDeps['jest']) return 'jest';

      // Check for vitest config files
      const vitestConfigs = ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mts'];
      for (const config of vitestConfigs) {
        if (fs.existsSync(path.join(repoRoot, config))) return 'vitest';
      }

      // Check for jest config files
      const jestConfigs = ['jest.config.ts', 'jest.config.js', 'jest.config.json'];
      for (const config of jestConfigs) {
        if (fs.existsSync(path.join(repoRoot, config))) return 'jest';
      }
    } catch {
      // Fall through to default
    }
  }

  return 'vitest'; // Default to vitest
}

/**
 * Generate test scaffold files for blast radius symbols.
 */
export function scaffoldTests(
  blastRadius: BlastRadiusNode[],
  store: SifthookdevStore,
  repoRoot: string
): Array<{ filePath: string; content: string }> {
  const framework = detectTestFramework(repoRoot);
  const testFiles: Array<{ filePath: string; content: string }> = [];

  // Group affected symbols by file
  const byFile = new Map<string, BlastRadiusNode[]>();
  for (const node of blastRadius) {
    if (node.relation === 'temporal') continue; // Skip temporal-only nodes
    const existing = byFile.get(node.file) ?? [];
    existing.push(node);
    byFile.set(node.file, existing);
  }

  for (const [filePath, nodes] of byFile.entries()) {
    const relPath = path.relative(repoRoot, filePath);
    const testPath = generateTestPath(relPath);
    const content = generateTestContent(relPath, nodes, store, framework, repoRoot);
    testFiles.push({
      filePath: path.join(repoRoot, testPath),
      content,
    });
  }

  return testFiles;
}

/**
 * Generate the test file path from the source file path.
 */
function generateTestPath(relPath: string): string {
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);

  // Place test next to source file
  const testExt = ext === '.py' ? '.py' : '.test' + ext;
  const testName = ext === '.py' ? `test_${base}${testExt}` : `${base}${testExt}`;

  return path.join(dir, testName);
}

/**
 * Generate test file content for a set of affected symbols.
 */
function generateTestContent(
  sourceRelPath: string,
  nodes: BlastRadiusNode[],
  store: SifthookdevStore,
  framework: TestFramework,
  repoRoot: string
): string {
  const ext = path.extname(sourceRelPath);
  const isPython = ext === '.py';

  if (isPython) {
    return generatePythonTestContent(sourceRelPath, nodes, store, repoRoot);
  }

  return generateTSTestContent(sourceRelPath, nodes, store, framework, repoRoot);
}

function generateTSTestContent(
  sourceRelPath: string,
  nodes: BlastRadiusNode[],
  store: SifthookdevStore,
  framework: TestFramework,
  repoRoot: string
): string {
  const lines: string[] = [];
  const importPath = './' + path.basename(sourceRelPath, path.extname(sourceRelPath));

  // Determine unique importable symbols
  const symbolNames = [...new Set(nodes.map(n => {
    // Strip class prefix for import
    const parts = n.symbol.split('.');
    return parts[0]!;
  }))];

  // Framework-specific imports
  if (framework === 'vitest') {
    lines.push(`import { describe, it, expect, vi } from 'vitest';`);
  }

  // Import from source
  if (symbolNames.length > 0) {
    lines.push(`import { ${symbolNames.join(', ')} } from '${importPath}';`);
  }

  lines.push('');

  // Get full symbol info from the store
  const fullPath = path.resolve(repoRoot, sourceRelPath).replace(/\\/g, '/');
  const dbSymbols = store.getSymbolsByFilePath(fullPath);

  lines.push(`describe('${path.basename(sourceRelPath)} — Blast Radius Tests', () => {`);

  for (const node of nodes) {
    const dbSymbol = dbSymbols.find(s => s.name === node.symbol);
    const sig = dbSymbol?.signature ?? node.signature ?? '';

    lines.push(`  describe('${node.symbol}', () => {`);
    lines.push(`    // Affected by change: ${node.relation} (distance: ${node.distance})`);
    if (sig) {
      lines.push(`    // Signature: ${sig}`);
    }
    lines.push('');

    // Generate test stubs based on symbol kind
    if (node.symbolKind === 'function' || node.symbolKind === 'method') {
      lines.push(`    it('should still work correctly after upstream changes', () => {`);
      lines.push(`      // TODO: Test that ${node.symbol} still behaves correctly`);
      lines.push(`      // after changes to its ${node.relation} dependency`);
      if (framework === 'vitest') {
        lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      } else {
        lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      }
      lines.push(`    });`);
      lines.push('');
      lines.push(`    it('should handle edge cases from dependency changes', () => {`);
      lines.push(`      // TODO: Test edge cases that may arise from the change`);
      lines.push(`      // Consider: null inputs, type mismatches, missing fields`);
      if (framework === 'vitest') {
        lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      } else {
        lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      }
      lines.push(`    });`);
    } else if (node.symbolKind === 'class') {
      lines.push(`    it('should maintain contract after upstream changes', () => {`);
      lines.push(`      // TODO: Verify class ${node.symbol} still satisfies its contract`);
      lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      lines.push(`    });`);
      lines.push('');
      lines.push(`    it('should handle construction with updated dependencies', () => {`);
      lines.push(`      // TODO: Test class instantiation with potentially changed deps`);
      lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      lines.push(`    });`);
    } else {
      lines.push(`    it('should maintain expected value/type after upstream changes', () => {`);
      lines.push(`      // TODO: Verify ${node.symbol} is still valid`);
      lines.push(`      expect(true).toBe(true); // Replace with actual assertion`);
      lines.push(`    });`);
    }

    lines.push(`  });`);
    lines.push('');
  }

  lines.push(`});`);
  lines.push('');

  return lines.join('\n');
}

function generatePythonTestContent(
  sourceRelPath: string,
  nodes: BlastRadiusNode[],
  store: SifthookdevStore,
  repoRoot: string
): string {
  const lines: string[] = [];
  const moduleName = path.basename(sourceRelPath, '.py');

  lines.push(`"""Blast Radius Tests for ${path.basename(sourceRelPath)}"""`);
  lines.push(`import pytest`);
  lines.push(`from ${moduleName} import *  # TODO: Replace with specific imports`);
  lines.push('');
  lines.push('');

  const fullPath = path.resolve(repoRoot, sourceRelPath).replace(/\\/g, '/');
  const dbSymbols = store.getSymbolsByFilePath(fullPath);

  for (const node of nodes) {
    const safeName = node.symbol.replace(/\./g, '_');
    const dbSymbol = dbSymbols.find(s => s.name === node.symbol);
    const sig = dbSymbol?.signature ?? node.signature ?? '';

    lines.push(`class Test${capitalize(safeName)}:`);
    lines.push(`    """Tests for ${node.symbol} — affected by ${node.relation} change (distance: ${node.distance})"""`);
    if (sig) {
      lines.push(`    # Signature: ${sig}`);
    }
    lines.push('');

    if (node.symbolKind === 'function' || node.symbolKind === 'method') {
      lines.push(`    def test_still_works_after_upstream_changes(self):`);
      lines.push(`        """Test that ${node.symbol} still behaves correctly after changes to its ${node.relation} dependency."""`);
      lines.push(`        # TODO: Add actual test assertions`);
      lines.push(`        assert True  # Replace with actual assertion`);
      lines.push('');
      lines.push(`    def test_edge_cases_from_dependency_changes(self):`);
      lines.push(`        """Test edge cases that may arise from the change."""`);
      lines.push(`        # TODO: Consider null inputs, type mismatches, missing fields`);
      lines.push(`        assert True  # Replace with actual assertion`);
    } else if (node.symbolKind === 'class') {
      lines.push(`    def test_maintains_contract(self):`);
      lines.push(`        """Verify class ${node.symbol} still satisfies its contract."""`);
      lines.push(`        # TODO: Add actual test assertions`);
      lines.push(`        assert True  # Replace with actual assertion`);
    } else {
      lines.push(`    def test_maintains_expected_value(self):`);
      lines.push(`        """Verify ${node.symbol} is still valid after upstream changes."""`);
      lines.push(`        # TODO: Add actual test assertions`);
      lines.push(`        assert True  # Replace with actual assertion`);
    }

    lines.push('');
    lines.push('');
  }

  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
