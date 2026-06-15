/**
 * Graph Builder — transforms parsed AST data into a dependency graph.
 * Resolves cross-file symbol references and builds edges.
 */

import path from 'node:path';
import type {
  ParsedFile,
  ParsedSymbol,
  ParsedImport,
  ParsedCall,
  ParsedInheritance,
  EdgeType,
} from '../types.js';

export interface ResolvedSymbol {
  filePath: string;
  symbol: ParsedSymbol;
}

export interface ResolvedEdge {
  fromFile: string;
  fromSymbol: string;
  toFile: string;
  toSymbol: string;
  edgeType: EdgeType;
}

export interface DependencyGraph {
  files: string[];
  symbols: Map<string, ResolvedSymbol[]>; // filePath -> symbols
  edges: ResolvedEdge[];
}

/**
 * Build a complete dependency graph from a set of parsed files.
 */
export function buildGraph(parsedFiles: ParsedFile[]): DependencyGraph {
  // Build a global symbol table: symbolName -> [{ filePath, symbol }]
  const symbolTable = new Map<string, ResolvedSymbol[]>();
  const fileSymbols = new Map<string, ResolvedSymbol[]>();

  for (const file of parsedFiles) {
    const resolved: ResolvedSymbol[] = [];
    for (const sym of file.symbols) {
      const entry = { filePath: file.filePath, symbol: sym };
      resolved.push(entry);

      // Register in global lookup (by base name, without class prefix)
      const baseName = sym.name.includes('.') ? sym.name.split('.').pop()! : sym.name;
      const existing = symbolTable.get(baseName) ?? [];
      existing.push(entry);
      symbolTable.set(baseName, existing);

      // Also register with full name
      if (sym.name.includes('.')) {
        const fullExisting = symbolTable.get(sym.name) ?? [];
        fullExisting.push(entry);
        symbolTable.set(sym.name, fullExisting);
      }
    }
    fileSymbols.set(file.filePath, resolved);
  }

  // Build a module map for import resolution: resolved path -> filePath
  const moduleMap = buildModuleMap(parsedFiles.map(f => f.filePath));

  const edges: ResolvedEdge[] = [];

  for (const file of parsedFiles) {
    // 1. Resolve imports → import edges
    resolveImports(file, moduleMap, symbolTable, edges);

    // 2. Resolve calls → call edges
    resolveCalls(file, symbolTable, edges);

    // 3. Resolve inheritance → extends/implements edges
    resolveInheritance(file, symbolTable, edges);
  }

  return {
    files: parsedFiles.map(f => f.filePath),
    symbols: fileSymbols,
    edges: deduplicateEdges(edges),
  };
}

/**
 * Build a map from module specifiers to actual file paths.
 * Handles relative imports like './utils' → '/abs/path/utils.ts'
 */
function buildModuleMap(filePaths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const fp of filePaths) {
    // Register without extension
    const noExt = fp.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, '');
    map.set(noExt, fp);
    // Register with extension too
    map.set(fp, fp);
    // Register basename without extension
    const baseName = path.basename(noExt);
    if (!map.has(baseName)) {
      map.set(baseName, fp);
    }
  }
  return map;
}

/**
 * Resolve a module specifier relative to a file's directory.
 */
function resolveModulePath(
  importSource: string,
  importingFile: string,
  moduleMap: Map<string, string>
): string | null {
  // Relative import
  if (importSource.startsWith('.')) {
    const dir = path.dirname(importingFile);
    const resolved = path.resolve(dir, importSource).replace(/\\/g, '/');
    // Try exact match, then without extension
    return moduleMap.get(resolved) ??
      moduleMap.get(resolved.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, '')) ??
      null;
  }

  // Non-relative: try to find in module map by basename
  return moduleMap.get(importSource) ?? null;
}

function resolveImports(
  file: ParsedFile,
  moduleMap: Map<string, string>,
  symbolTable: Map<string, ResolvedSymbol[]>,
  edges: ResolvedEdge[]
): void {
  for (const imp of file.imports) {
    const targetFile = resolveModulePath(imp.source, file.filePath, moduleMap);
    if (!targetFile) continue;

    for (const importedName of imp.importedNames) {
      if (importedName === '*' || importedName === 'default') {
        // Namespace or default import — create a file-level edge
        // Use the first symbol from the target file as representative
        const targetSymbols = symbolTable.get(importedName);
        const fromSymbol = file.symbols[0]?.name ?? path.basename(file.filePath);
        edges.push({
          fromFile: file.filePath,
          fromSymbol,
          toFile: targetFile,
          toSymbol: importedName,
          edgeType: 'imports',
        });
      } else {
        // Named import — find the specific symbol
        const candidates = symbolTable.get(importedName) ?? [];
        const match = candidates.find(c => c.filePath === targetFile);
        if (match) {
          const fromSymbol = file.symbols[0]?.name ?? path.basename(file.filePath);
          edges.push({
            fromFile: file.filePath,
            fromSymbol,
            toFile: targetFile,
            toSymbol: match.symbol.name,
            edgeType: 'imports',
          });
        }
      }
    }
  }
}

function resolveCalls(
  file: ParsedFile,
  symbolTable: Map<string, ResolvedSymbol[]>,
  edges: ResolvedEdge[]
): void {
  for (const call of file.calls) {
    const candidates = symbolTable.get(call.calleeName) ?? [];

    // Prefer symbols in other files (cross-file calls are the interesting edges)
    const crossFile = candidates.filter(c => c.filePath !== file.filePath);
    const target = crossFile[0] ?? candidates[0];

    if (target) {
      // Find the enclosing function for this call
      const callingSymbol = findEnclosingSymbol(file.symbols, call.line);
      const fromSymbol = callingSymbol?.name ?? path.basename(file.filePath);

      edges.push({
        fromFile: file.filePath,
        fromSymbol,
        toFile: target.filePath,
        toSymbol: target.symbol.name,
        edgeType: 'calls',
      });
    }
  }
}

function resolveInheritance(
  file: ParsedFile,
  symbolTable: Map<string, ResolvedSymbol[]>,
  edges: ResolvedEdge[]
): void {
  for (const inh of file.inheritances) {
    const candidates = symbolTable.get(inh.parentName) ?? [];
    const target = candidates[0];
    if (target) {
      edges.push({
        fromFile: file.filePath,
        fromSymbol: inh.childName,
        toFile: target.filePath,
        toSymbol: target.symbol.name,
        edgeType: inh.kind,
      });
    }
  }
}

/**
 * Find the symbol that encloses a given line number.
 */
function findEnclosingSymbol(symbols: ParsedSymbol[], line: number): ParsedSymbol | null {
  let best: ParsedSymbol | null = null;
  for (const sym of symbols) {
    if (sym.startLine <= line && sym.endLine >= line) {
      // Prefer the most specific (smallest range) enclosing symbol
      if (!best || (sym.endLine - sym.startLine) < (best.endLine - best.startLine)) {
        best = sym;
      }
    }
  }
  return best;
}

/**
 * Remove duplicate edges.
 */
function deduplicateEdges(edges: ResolvedEdge[]): ResolvedEdge[] {
  const seen = new Set<string>();
  return edges.filter(e => {
    const key = `${e.fromFile}:${e.fromSymbol}->${e.toFile}:${e.toSymbol}:${e.edgeType}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
