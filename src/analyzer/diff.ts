/**
 * Diff — fetches and parses diffs from local git or GitHub PRs.
 */

import { execSync } from 'node:child_process';
import parseDiff from 'parse-diff';
import type { DiffFile } from '../types.js';

/**
 * Get a local git diff (staged + unstaged).
 */
export function getLocalDiff(repoRoot: string, baseRef?: string): DiffFile[] {
  let diffText: string;

  try {
    if (baseRef) {
      diffText = execSync(`git diff ${baseRef}`, {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });
    } else {
      // Get diff of staged + unstaged changes
      diffText = execSync('git diff HEAD', {
        cwd: repoRoot,
        encoding: 'utf-8',
        maxBuffer: 50 * 1024 * 1024,
      });

      // If no diff against HEAD, try staged only
      if (!diffText.trim()) {
        diffText = execSync('git diff --cached', {
          cwd: repoRoot,
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
        });
      }

      // If still nothing, try diff against last commit
      if (!diffText.trim()) {
        diffText = execSync('git diff HEAD~1', {
          cwd: repoRoot,
          encoding: 'utf-8',
          maxBuffer: 50 * 1024 * 1024,
        });
      }
    }
  } catch {
    throw new Error('Failed to get git diff. Make sure you are in a git repository with changes.');
  }

  if (!diffText.trim()) {
    throw new Error('No changes detected. Make sure there are uncommitted changes or specify a base ref.');
  }

  return parseDiffText(diffText);
}

/**
 * Get diff from a GitHub PR using Octokit.
 */
export async function getGitHubPRDiff(
  owner: string,
  repo: string,
  prNumber: number,
  token: string
): Promise<DiffFile[]> {
  const { Octokit } = await import('octokit');
  const octokit = new Octokit({ auth: token });

  const response = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
    mediaType: {
      format: 'diff',
    },
  });

  const diffText = response.data as unknown as string;
  return parseDiffText(diffText);
}

/**
 * Parse raw diff text into structured DiffFile objects.
 */
export function parseDiffText(diffText: string): DiffFile[] {
  const parsed = parseDiff(diffText);

  return parsed.map((file) => ({
    from: file.from ?? null,
    to: file.to ?? null,
    chunks: (file.chunks ?? []).map((chunk) => ({
      file: file.to ?? file.from ?? '',
      oldStart: chunk.oldStart,
      oldLines: chunk.oldLines,
      newStart: chunk.newStart,
      newLines: chunk.newLines,
      addedLines: chunk.changes
        .filter((c) => c.type === 'add')
        .map((c) => c.content),
      removedLines: chunk.changes
        .filter((c) => c.type === 'del')
        .map((c) => c.content),
    })),
    additions: file.additions,
    deletions: file.deletions,
  }));
}

/**
 * Extract the GitHub owner/repo from a git remote URL.
 */
export function getGitHubRepo(repoRoot: string): { owner: string; repo: string } | null {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).trim();

    // Handle SSH format: git@github.com:owner/repo.git
    const sshMatch = remoteUrl.match(/git@github\.com:(.+?)\/(.+?)(?:\.git)?$/);
    if (sshMatch) {
      return { owner: sshMatch[1]!, repo: sshMatch[2]! };
    }

    // Handle HTTPS format: https://github.com/owner/repo.git
    const httpsMatch = remoteUrl.match(/github\.com\/(.+?)\/(.+?)(?:\.git)?$/);
    if (httpsMatch) {
      return { owner: httpsMatch[1]!, repo: httpsMatch[2]! };
    }

    return null;
  } catch {
    return null;
  }
}
