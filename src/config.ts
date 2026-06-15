/**
 * Config loader — reads sieve.config.json and merges with defaults.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { SieveConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Load configuration from sieve.config.json, merging with defaults.
 */
export function loadConfig(repoRoot: string): SieveConfig {
  const configPath = path.join(repoRoot, 'sieve.config.json');

  if (!fs.existsSync(configPath)) {
    return { ...DEFAULT_CONFIG };
  }

  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const userConfig = JSON.parse(raw) as Partial<SieveConfig>;
    return { ...DEFAULT_CONFIG, ...userConfig };
  } catch (err) {
    console.warn(`⚠️  Failed to parse sieve.config.json: ${(err as Error).message}`);
    console.warn('   Using default configuration.\n');
    return { ...DEFAULT_CONFIG };
  }
}

/**
 * Write a default config file.
 */
export function writeDefaultConfig(repoRoot: string): void {
  const configPath = path.join(repoRoot, 'sieve.config.json');
  if (fs.existsSync(configPath)) return;

  const config = {
    max_depth: DEFAULT_CONFIG.max_depth,
    languages: DEFAULT_CONFIG.languages,
    provider: DEFAULT_CONFIG.provider,
    api_key_env_var: DEFAULT_CONFIG.api_key_env_var,
    api_base_url: DEFAULT_CONFIG.api_base_url,
    model: DEFAULT_CONFIG.model,
    max_cost_per_review: DEFAULT_CONFIG.max_cost_per_review,
    temporal_coupling_threshold: DEFAULT_CONFIG.temporal_coupling_threshold,
    temporal_commit_limit: DEFAULT_CONFIG.temporal_commit_limit,
    exclude_patterns: DEFAULT_CONFIG.exclude_patterns,
  };

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
}
