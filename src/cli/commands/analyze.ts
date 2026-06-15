/**
 * `sieve analyze` — Analyze a diff/PR with blast-radius-aware AI review.
 */

import { Command } from 'commander';
import path from 'node:path';
import fs from 'node:fs';
import { SieveStore } from '../../indexer/store.js';
import { getLocalDiff, getGitHubPRDiff, getGitHubRepo } from '../../analyzer/diff.js';
import { computeBlastRadius } from '../../analyzer/blast-radius.js';
import { buildReviewPrompt } from '../../analyzer/context-builder.js';
import { reviewWithClaude, formatReviewReport, formatReviewAsMarkdown } from '../../analyzer/reviewer.js';
import { checkBudget, formatBudgetError } from '../../analyzer/budget.js';
import { scaffoldTests } from '../../analyzer/test-scaffolder.js';
import { loadConfig } from '../../config.js';
import type { DiffFile, BlastRadiusNode } from '../../types.js';

export const analyzeCommand = new Command('analyze')
  .description('Analyze a diff or PR with blast-radius-aware AI review')
  .option('--diff', 'Analyze local git diff')
  .option('--pr <number>', 'Analyze a GitHub PR by number')
  .option('--base <ref>', 'Base git ref for diff comparison')
  .option('--depth <n>', 'Blast radius depth')
  .option('--test', 'Generate test scaffolds for affected symbols')
  .option('--force', 'Override token budget check')
  .option('--json', 'Output raw JSON instead of formatted report')
  .option('--path <dir>', 'Repository root path', '.')
  .action(async (options) => {
    const repoRoot = path.resolve(options.path);
    const config = loadConfig(repoRoot);
    const depth = parseInt(options.depth ?? '', 10) || config.max_depth;

    console.log('🔬 Sieve — Analyzing changes...\n');

    // 1. Get the diff
    let diffFiles: DiffFile[];

    if (options.pr) {
      // GitHub PR mode
      const token = process.env['GITHUB_TOKEN'];
      if (!token) {
        console.error('❌ GITHUB_TOKEN environment variable is not set.');
        console.error('   Set it with: export GITHUB_TOKEN=your-token-here');
        process.exit(1);
      }

      const ghRepo = getGitHubRepo(repoRoot);
      if (!ghRepo) {
        console.error('❌ Could not detect GitHub repository from git remote.');
        process.exit(1);
      }

      const prNumber = parseInt(options.pr, 10);
      console.log(`📥 Fetching PR #${prNumber} from ${ghRepo.owner}/${ghRepo.repo}...`);
      diffFiles = await getGitHubPRDiff(ghRepo.owner, ghRepo.repo, prNumber, token);
    } else {
      // Local diff mode (default)
      console.log('📥 Getting local git diff...');
      try {
        diffFiles = getLocalDiff(repoRoot, options.base);
      } catch (err) {
        console.error(`❌ ${(err as Error).message}`);
        process.exit(1);
      }
    }

    console.log(`   Found changes in ${diffFiles.length} files\n`);

    // 2. Compute blast radius for each changed file
    console.log('💥 Computing blast radius...');
    const store = new SieveStore(repoRoot);
    const allBlastRadius: BlastRadiusNode[] = [];

    try {
      const changedFiles = new Set<string>();
      for (const df of diffFiles) {
        const file = df.to ?? df.from;
        if (file) {
          changedFiles.add(path.resolve(repoRoot, file).replace(/\\/g, '/'));
        }
      }

      for (const filePath of changedFiles) {
        const nodes = computeBlastRadius(store, filePath, undefined, depth);
        for (const node of nodes) {
          // Avoid duplicates
          if (!allBlastRadius.some(n => n.file === node.file && n.symbol === node.symbol)) {
            allBlastRadius.push(node);
          }
        }
      }

      const temporalCount = allBlastRadius.filter(n => n.relation === 'temporal').length;
      console.log(`   ${allBlastRadius.length} affected symbols found`);
      if (temporalCount > 0) {
        console.log(`   (including ${temporalCount} temporal/ghost dependencies 👻)`);
      }
      console.log('');

      // 3. Build review prompt
      console.log('📝 Building review context...');
      const { prompt, estimatedTokens } = buildReviewPrompt(diffFiles, allBlastRadius, store, repoRoot);
      console.log(`   Estimated input tokens: ${estimatedTokens.toLocaleString()}\n`);

      // 4. Budget check
      const budgetCheck = checkBudget(prompt, config);
      if (!budgetCheck.withinBudget && !options.force) {
        console.error(formatBudgetError(budgetCheck));
        process.exit(1);
      }

      if (!budgetCheck.withinBudget && options.force) {
        console.log('⚠️  Token budget exceeded, but proceeding with --force flag.\n');
      }

      // 5. Call Claude / AI Provider
      console.log(`🤖 Sending to ${config.model} (via ${config.provider})...`);
      const review = await reviewWithClaude(prompt, config);

      // 6. Output
      if (options.json) {
        console.log(JSON.stringify(review, null, 2));
      } else {
        console.log(formatReviewReport(review));
      }

      // 7. Generate test scaffolds if --test
      if (options.test) {
        console.log('🧪 Generating test scaffolds...\n');
        const testFiles = scaffoldTests(allBlastRadius, store, repoRoot);

        if (testFiles.length === 0) {
          console.log('   No test scaffolds to generate (no function/class symbols in blast radius).');
        } else {
          for (const tf of testFiles) {
            const relPath = path.relative(repoRoot, tf.filePath);
            if (fs.existsSync(tf.filePath)) {
              console.log(`   ⏭️  Skipping ${relPath} (already exists)`);
            } else {
              fs.mkdirSync(path.dirname(tf.filePath), { recursive: true });
              fs.writeFileSync(tf.filePath, tf.content);
              console.log(`   ✅ Created ${relPath}`);
            }
          }
          console.log(`\n   Generated ${testFiles.length} test scaffold(s)`);
        }
      }
    } finally {
      store.close();
    }
  });
