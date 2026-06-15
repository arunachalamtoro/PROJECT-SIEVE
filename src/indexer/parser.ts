/**
 * Tree-sitter parser setup using web-tree-sitter (WASM).
 * Parses TypeScript/JavaScript and Python files into structured AST data.
 */

import Parser from 'web-tree-sitter';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  SupportedLanguage,
  ParsedFile,
  ParsedSymbol,
  ParsedImport,
  ParsedCall,
  ParsedInheritance,
  SymbolKind,
} from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let parserInstance: Parser | null = null;
const languageCache = new Map<string, Parser.Language>();

/**
 * Resolve the path to the WASM file for a given grammar.
 * Grammars are stored in the `grammars/` directory relative to the project root.
 */
function grammarPath(name: string): string {
  // Check multiple possible locations
  const candidates = [
    path.resolve(__dirname, '..', '..', 'grammars', `tree-sitter-${name}.wasm`),
    path.resolve(__dirname, '..', '..', '..', 'grammars', `tree-sitter-${name}.wasm`),
    path.resolve(process.cwd(), 'grammars', `tree-sitter-${name}.wasm`),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[2]!; // default to cwd-relative
}

/**
 * Map file extensions to supported languages.
 */
export function detectLanguage(filePath: string): SupportedLanguage | null {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    default:
      return null;
  }
}

/**
 * Map language name to tree-sitter grammar name.
 */
function grammarName(lang: SupportedLanguage): string {
  switch (lang) {
    case 'typescript':
      return 'typescript';
    case 'javascript':
      return 'javascript';
    case 'python':
      return 'python';
  }
}

/**
 * Initialize the tree-sitter WASM parser (called once).
 */
async function getParser(): Promise<Parser> {
  if (parserInstance) return parserInstance;
  await Parser.init();
  parserInstance = new Parser();
  return parserInstance;
}

/**
 * Load and cache a language grammar.
 */
async function loadLanguage(lang: SupportedLanguage): Promise<Parser.Language> {
  const name = grammarName(lang);
  const cached = languageCache.get(name);
  if (cached) return cached;

  const wasmPath = grammarPath(name);
  if (!fs.existsSync(wasmPath)) {
    throw new Error(
      `Grammar file not found: ${wasmPath}\n` +
      `Run "npm run download-grammars" or place the WASM file in the grammars/ directory.`
    );
  }

  const language = await Parser.Language.load(wasmPath);
  languageCache.set(name, language);
  return language;
}

/**
 * Parse a single source file and extract symbols, imports, calls, and inheritance.
 */
export async function parseFile(filePath: string, source: string): Promise<ParsedFile | null> {
  const language = detectLanguage(filePath);
  if (!language) return null;

  const parser = await getParser();
  const lang = await loadLanguage(language);
  parser.setLanguage(lang);

  const tree = parser.parse(source);
  const rootNode = tree.rootNode;

  const symbols: ParsedSymbol[] = [];
  const imports: ParsedImport[] = [];
  const calls: ParsedCall[] = [];
  const inheritances: ParsedInheritance[] = [];

  if (language === 'typescript' || language === 'javascript') {
    extractTSSymbols(rootNode, symbols, source);
    extractTSImports(rootNode, imports);
    extractTSCalls(rootNode, calls);
    extractTSInheritance(rootNode, inheritances);
  } else if (language === 'python') {
    extractPythonSymbols(rootNode, symbols, source);
    extractPythonImports(rootNode, imports);
    extractPythonCalls(rootNode, calls);
    extractPythonInheritance(rootNode, inheritances);
  }

  tree.delete();

  return { filePath, language, symbols, imports, calls, inheritances };
}

// ─── TypeScript/JavaScript Extraction ──────────────────────────────

function extractTSSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[], source: string): void {
  walkNode(node, (n) => {
    // Function declarations
    if (n.type === 'function_declaration' || n.type === 'generator_function_declaration') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'function',
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          signature: extractSignatureLine(source, n.startPosition.row),
        });
      }
    }

    // Arrow functions / variable declarations with function values
    if (n.type === 'lexical_declaration' || n.type === 'variable_declaration') {
      for (let i = 0; i < n.childCount; i++) {
        const declarator = n.child(i);
        if (declarator?.type === 'variable_declarator') {
          const nameNode = declarator.childForFieldName('name');
          const valueNode = declarator.childForFieldName('value');
          if (nameNode && valueNode) {
            const isFunc = valueNode.type === 'arrow_function' || valueNode.type === 'function_expression';
            symbols.push({
              name: nameNode.text,
              kind: isFunc ? 'function' : 'variable',
              startLine: n.startPosition.row + 1,
              endLine: n.endPosition.row + 1,
              signature: extractSignatureLine(source, n.startPosition.row),
            });
          }
        }
      }
    }

    // Class declarations
    if (n.type === 'class_declaration') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'class',
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          signature: extractSignatureLine(source, n.startPosition.row),
        });

        // Extract methods
        extractTSClassMethods(n, symbols, source);
      }
    }

    // Interface declarations
    if (n.type === 'interface_declaration') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'interface',
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          signature: extractSignatureLine(source, n.startPosition.row),
        });
      }
    }

    // Type alias declarations
    if (n.type === 'type_alias_declaration') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'type',
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          signature: extractSignatureLine(source, n.startPosition.row),
        });
      }
    }

    // Exported functions/variables (export default function, export function, etc.)
    if (n.type === 'export_statement') {
      const decl = n.childForFieldName('declaration');
      if (decl) {
        // The child declarations will be picked up by other matchers
        return;
      }
    }
  });
}

function extractTSClassMethods(classNode: Parser.SyntaxNode, symbols: ParsedSymbol[], source: string): void {
  const body = classNode.childForFieldName('body');
  if (!body) return;
  const className = classNode.childForFieldName('name')?.text ?? '';

  for (let i = 0; i < body.childCount; i++) {
    const child = body.child(i);
    if (child?.type === 'method_definition' || child?.type === 'public_field_definition') {
      const nameNode = child.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: `${className}.${nameNode.text}`,
          kind: 'method',
          startLine: child.startPosition.row + 1,
          endLine: child.endPosition.row + 1,
          signature: extractSignatureLine(source, child.startPosition.row),
        });
      }
    }
  }
}

function extractTSImports(node: Parser.SyntaxNode, imports: ParsedImport[]): void {
  walkNode(node, (n) => {
    // import { a, b } from 'module'
    if (n.type === 'import_statement') {
      const sourceNode = n.childForFieldName('source');
      if (sourceNode) {
        const modulePath = sourceNode.text.replace(/['"]/g, '');
        const names: string[] = [];

        // Walk import clause to find named imports
        walkNode(n, (child) => {
          if (child.type === 'import_specifier') {
            const nameNode = child.childForFieldName('name');
            if (nameNode) names.push(nameNode.text);
          }
          if (child.type === 'identifier' && child.parent?.type === 'import_clause') {
            names.push(child.text);
          }
          if (child.type === 'namespace_import') {
            names.push('*');
          }
        });

        if (names.length === 0) names.push('default');
        imports.push({ source: modulePath, importedNames: names });
      }
    }

    // const x = require('module')
    if (n.type === 'call_expression') {
      const funcNode = n.childForFieldName('function');
      if (funcNode?.text === 'require') {
        const args = n.childForFieldName('arguments');
        if (args && args.childCount > 0) {
          const firstArg = args.child(1); // skip ( 
          if (firstArg?.type === 'string') {
            const modulePath = firstArg.text.replace(/['"]/g, '');
            imports.push({ source: modulePath, importedNames: ['default'] });
          }
        }
      }
    }
  });
}

function extractTSCalls(node: Parser.SyntaxNode, calls: ParsedCall[]): void {
  walkNode(node, (n) => {
    if (n.type === 'call_expression') {
      const funcNode = n.childForFieldName('function');
      if (funcNode) {
        let calleeName = funcNode.text;
        // Simplify member expressions to just the method name
        if (funcNode.type === 'member_expression') {
          const prop = funcNode.childForFieldName('property');
          const obj = funcNode.childForFieldName('object');
          if (prop && obj) {
            calleeName = `${obj.text}.${prop.text}`;
          }
        }
        calls.push({
          calleeName,
          line: n.startPosition.row + 1,
        });
      }
    }
  });
}

function extractTSInheritance(node: Parser.SyntaxNode, inheritances: ParsedInheritance[]): void {
  walkNode(node, (n) => {
    if (n.type === 'class_declaration') {
      const nameNode = n.childForFieldName('name');
      if (!nameNode) return;

      // Check for extends clause
      walkNode(n, (child) => {
        if (child.type === 'class_heritage') {
          walkNode(child, (hChild) => {
            if (hChild.type === 'extends_clause') {
              const parentNode = hChild.child(1); // the identifier after 'extends'
              if (parentNode) {
                inheritances.push({
                  childName: nameNode.text,
                  parentName: parentNode.text,
                  kind: 'extends',
                });
              }
            }
            if (hChild.type === 'implements_clause') {
              for (let i = 1; i < hChild.childCount; i++) {
                const iface = hChild.child(i);
                if (iface && iface.type !== ',') {
                  inheritances.push({
                    childName: nameNode.text,
                    parentName: iface.text,
                    kind: 'implements',
                  });
                }
              }
            }
          });
        }
      });
    }
  });
}

// ─── Python Extraction ─────────────────────────────────────────────

function extractPythonSymbols(node: Parser.SyntaxNode, symbols: ParsedSymbol[], source: string): void {
  walkNode(node, (n) => {
    if (n.type === 'function_definition') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) {
        // Check if this is a method (inside a class)
        const isMethod = n.parent?.type === 'block' &&
          n.parent.parent?.type === 'class_definition';
        const className = isMethod
          ? n.parent?.parent?.childForFieldName('name')?.text
          : null;

        symbols.push({
          name: className ? `${className}.${nameNode.text}` : nameNode.text,
          kind: isMethod ? 'method' : 'function',
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          signature: extractSignatureLine(source, n.startPosition.row),
        });
      }
    }

    if (n.type === 'class_definition') {
      const nameNode = n.childForFieldName('name');
      if (nameNode) {
        symbols.push({
          name: nameNode.text,
          kind: 'class',
          startLine: n.startPosition.row + 1,
          endLine: n.endPosition.row + 1,
          signature: extractSignatureLine(source, n.startPosition.row),
        });
      }
    }

    // Top-level assignments (e.g., MY_CONST = 42)
    if (n.type === 'expression_statement' && n.parent?.type === 'module') {
      const child = n.child(0);
      if (child?.type === 'assignment') {
        const left = child.childForFieldName('left');
        if (left?.type === 'identifier') {
          symbols.push({
            name: left.text,
            kind: 'variable',
            startLine: n.startPosition.row + 1,
            endLine: n.endPosition.row + 1,
            signature: extractSignatureLine(source, n.startPosition.row),
          });
        }
      }
    }
  });
}

function extractPythonImports(node: Parser.SyntaxNode, imports: ParsedImport[]): void {
  walkNode(node, (n) => {
    // import module
    if (n.type === 'import_statement') {
      for (let i = 0; i < n.childCount; i++) {
        const child = n.child(i);
        if (child?.type === 'dotted_name') {
          imports.push({ source: child.text, importedNames: [child.text] });
        }
      }
    }

    // from module import name1, name2
    if (n.type === 'import_from_statement') {
      const moduleNode = n.childForFieldName('module_name');
      const moduleName = moduleNode?.text ?? '';
      const names: string[] = [];

      walkNode(n, (child) => {
        if (child.type === 'dotted_name' && child !== moduleNode) {
          names.push(child.text);
        }
        if (child.type === 'wildcard_import') {
          names.push('*');
        }
      });

      if (names.length === 0) names.push('default');
      imports.push({ source: moduleName, importedNames: names });
    }
  });
}

function extractPythonCalls(node: Parser.SyntaxNode, calls: ParsedCall[]): void {
  walkNode(node, (n) => {
    if (n.type === 'call') {
      const funcNode = n.childForFieldName('function');
      if (funcNode) {
        let calleeName = funcNode.text;
        if (funcNode.type === 'attribute') {
          const obj = funcNode.childForFieldName('object');
          const attr = funcNode.childForFieldName('attribute');
          if (obj && attr) {
            calleeName = `${obj.text}.${attr.text}`;
          }
        }
        calls.push({ calleeName, line: n.startPosition.row + 1 });
      }
    }
  });
}

function extractPythonInheritance(node: Parser.SyntaxNode, inheritances: ParsedInheritance[]): void {
  walkNode(node, (n) => {
    if (n.type === 'class_definition') {
      const nameNode = n.childForFieldName('name');
      const superclasses = n.childForFieldName('superclasses');
      if (nameNode && superclasses) {
        walkNode(superclasses, (child) => {
          if (child.type === 'identifier' || child.type === 'dotted_name') {
            inheritances.push({
              childName: nameNode.text,
              parentName: child.text,
              kind: 'extends',
            });
          }
        });
      }
    }
  });
}

// ─── Helpers ───────────────────────────────────────────────────────

function walkNode(node: Parser.SyntaxNode, callback: (n: Parser.SyntaxNode) => void): void {
  callback(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) walkNode(child, callback);
  }
}

function extractSignatureLine(source: string, lineIndex: number): string {
  const lines = source.split('\n');
  const line = lines[lineIndex];
  return line ? line.trim() : '';
}
