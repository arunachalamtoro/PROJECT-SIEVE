/**
 * Temporal Coupling — analyzes git history to find files that change together.
 * Creates "Ghost Dependency" edges for file pairs with high co-commit rates.
 */

import { execSync } from 'node:child_process';
import path from 'node:path';
import type { SifthookStore } from './store.js';
import type { SifthookConfig } from '../types.js';

interface CommitFileSet {
  hash: string;
  files: string[];
}

/**
 * Analyze git history for temporal coupling patterns.
 * Files modified in the same commit ≥ threshold% of the time get a temporal edge.
 */
export async function analyzeTemporalCoupling(
  store: SifthookStore,
  repoRoot: string,
  config: SifthookConfig
): Promise<number> {
  const threshold = config.temporal_coupling_threshold;
  const commitLimit = config.temporal_commit_limit;

  // 1. Get recent commits with their file lists
  const commits = getCommitHistory(repoRoot, commitLimit);
  if (commits.length === 0) {
    console.log('   No git history found.');
    return 0;
  }

  console.log(`   Analyzing ${commits.length} commits...`);

  // 2. Build co-occurrence matrix
  const fileCommitCounts = new Map<string, number>(); // file -> total commits
  const pairCoCommitCounts = new Map<string, number>(); // "fileA|||fileB" -> co-commit count

  for (const commit of commits) {
    // Only consider commits with 2+ files (single-file commits can't create coupling)
    if (commit.files.length < 2 || commit.files.length > 50) continue; // skip huge commits (merges)

    // Count individual file commits
    for (const file of commit.files) {
      fileCommitCounts.set(file, (fileCommitCounts.get(file) ?? 0) + 1);
    }

    // Count pair co-commits
    for (let i = 0; i < commit.files.length; i++) {
      for (let j = i + 1; j < commit.files.length; j++) {
        const key = makePairKey(commit.files[i]!, commit.files[j]!);
        pairCoCommitCounts.set(key, (pairCoCommitCounts.get(key) ?? 0) + 1);
      }
    }
  }

  // 3. Calculate coupling scores and filter by threshold
  const temporalEdges: Array<{
    fileA: string;
    fileB: string;
    coCommitCount: number;
    totalCommitsA: number;
    totalCommitsB: number;
    couplingScore: number;
  }> = [];

  for (const [pairKey, coCount] of pairCoCommitCounts.entries()) {
    const [fileA, fileB] = pairKey.split('|||');
    if (!fileA || !fileB) continue;

    const totalA = fileCommitCounts.get(fileA) ?? 0;
    const totalB = fileCommitCounts.get(fileB) ?? 0;

    if (totalA < 3 || totalB < 3) continue; // Need minimum commit history

    // Coupling score = co-commits / min(totalA, totalB)
    // This means if A changes 10 times and B changes 10 times,
    // and they co-occur 8 times, score = 8/10 = 0.8
    const score = coCount / Math.min(totalA, totalB);

    if (score >= threshold) {
      temporalEdges.push({
        fileA,
        fileB,
        coCommitCount: coCount,
        totalCommitsA: totalA,
        totalCommitsB: totalB,
        couplingScore: score,
      });
    }
  }

  // 4. Store in database
  if (temporalEdges.length > 0) {
    return store.storeTemporalEdges(temporalEdges);
  }

  return 0;
}

/**
 * Extract commit history from git log.
 */
function getCommitHistory(repoRoot: string, limit: number): CommitFileSet[] {
  try {
    // Use git log with --name-only to get files per commit
    const output = execSync(
      `git log --pretty=format:"COMMIT:%H" --name-only -n ${limit}`,
      {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024, // 50MB for large repos
        timeout: 30000,
      }
    );

    const commits: CommitFileSet[] = [];
    let currentCommit: CommitFileSet | null = null;

    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      if (trimmed.startsWith('COMMIT:')) {
        if (currentCommit && currentCommit.files.length > 0) {
          commits.push(currentCommit);
        }
        currentCommit = {
          hash: trimmed.replace('COMMIT:', ''),
          files: [],
        };
      } else if (currentCommit) {
        // Normalize path separators
        const normalizedPath = trimmed.replace(/\\/g, '/');
        currentCommit.files.push(normalizedPath);
      }
    }

    // Don't forget the last commit
    if (currentCommit && currentCommit.files.length > 0) {
      commits.push(currentCommit);
    }

    return commits;
  } catch (err) {
    // Not a git repo, or git not available
    return [];
  }
}

/**
 * Create a consistent key for a file pair (alphabetically sorted).
 */
function makePairKey(fileA: string, fileB: string): string {
  return fileA < fileB ? `${fileA}|||${fileB}` : `${fileB}|||${fileA}`;
}
