/**
 * Context Builder — assembles the Claude prompt payload from diff + blast radius.
 * Only includes signatures and summaries, NOT full file contents.
 */

import path from 'node:path';
import type { SieveStore } from '../indexer/store.js';
import type { DiffFile, BlastRadiusNode } from '../types.js';
import { estimateTokens } from '../types.js';

/**
 * Build the prompt for Claude, including diff context and blast radius.
 */
export function buildReviewPrompt(
  diffFiles: DiffFile[],
  blastRadius: BlastRadiusNode[],
  store: SieveStore,
  repoRoot: string
): { prompt: string; estimatedTokens: number } {
  const sections: string[] = [];

  // 1. System instruction
  sections.push(`You are an expert code reviewer. Analyze the following code changes and their blast radius (dependencies affected by the changes).

Respond ONLY with valid JSON matching this exact shape:
{
  "summary": "Brief summary of what the changes do",
  "risk_level": "low" | "medium" | "high",
  "breaking_changes": ["list of breaking changes, empty if none"],
  "blast_radius": [{"file": "path", "reason": "why it's affected"}],
  "suggestions": ["actionable improvement suggestions"]
}

Focus on:
- Whether the changes could break existing functionality (check the blast radius)
- Type mismatches, missing null checks, API contract violations
- Performance implications
- Security concerns
- Whether temporal (ghost) dependencies are respected`);

  // 2. The diff itself
  sections.push('\n## Changed Files\n');
  for (const file of diffFiles) {
    const fileName = file.to ?? file.from ?? 'unknown';
    sections.push(`### ${fileName} (+${file.additions} -${file.deletions})`);
    for (const chunk of file.chunks) {
      if (chunk.removedLines.length > 0) {
        sections.push('Removed:');
        sections.push(chunk.removedLines.join('\n'));
      }
      if (chunk.addedLines.length > 0) {
        sections.push('Added:');
        sections.push(chunk.addedLines.join('\n'));
      }
    }
  }

  // 3. Blast radius context (signatures + summaries, not full files)
  if (blastRadius.length > 0) {
    sections.push('\n## Blast Radius (affected dependencies)\n');
    sections.push('These symbols depend on the changed code and may be affected:\n');

    for (const node of blastRadius) {
      const relFile = path.relative(repoRoot, node.file);
      const ghostLabel = node.relation === 'temporal' ? ' 👻 TEMPORAL COUPLING' : '';
      sections.push(`- **${relFile}** → \`${node.symbol}\` (${node.symbolKind}, ${node.relation}, distance: ${node.distance})${ghostLabel}`);
      if (node.signature) {
        sections.push(`  Signature: \`${node.signature}\``);
      }
    }

    // Add additional context: signatures of changed symbols
    sections.push('\n## Symbol Signatures in Changed Files\n');
    const changedFiles = new Set(diffFiles.map(f => f.to ?? f.from).filter(Boolean) as string[]);

    for (const filePath of changedFiles) {
      const fullPath = path.resolve(repoRoot, filePath).replace(/\\/g, '/');
      const symbols = store.getSymbolsByFilePath(fullPath);

      if (symbols.length > 0) {
        sections.push(`### ${filePath}`);
        for (const sym of symbols) {
          sections.push(`- ${sym.kind} \`${sym.name}\` (lines ${sym.start_line}-${sym.end_line})`);
          if (sym.signature) {
            sections.push(`  \`${sym.signature}\``);
          }
        }
      }
    }
  }

  const prompt = sections.join('\n');
  const estimatedInputTokens = estimateTokens(prompt);

  return { prompt, estimatedTokens: estimatedInputTokens };
}
