#!/usr/bin/env node

/**
 * Sifthookdev CLI — AI-powered PR analyzer with semantic dependency graph.
 * Main entrypoint that registers all commands.
 */

import { Command } from 'commander';
import { initCommand } from './commands/init.js';
import { queryCommand } from './commands/query.js';
import { searchCommand } from './commands/search.js';
import { analyzeCommand } from './commands/analyze.js';
import { serveCommand } from './commands/serve.js';
import { daemonCommand } from './commands/daemon.js';

const program = new Command();

program
  .name('sifthookdev')
  .description('AI-powered PR analyzer with semantic dependency graph — knows the blast radius of every code change')
  .version('1.0.0');

// Register commands
program.addCommand(initCommand);
program.addCommand(queryCommand);
program.addCommand(searchCommand);
program.addCommand(analyzeCommand);
program.addCommand(serveCommand);
program.addCommand(daemonCommand);

program.parse();
