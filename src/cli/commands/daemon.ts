/**
 * `sieve daemon` — Manage the background pre-computation daemon.
 */

import { Command } from 'commander';
import path from 'node:path';
import {
  startDaemonBackground,
  startDaemonForeground,
  stopDaemon,
  getDaemonStatus,
  isDaemonRunning,
} from '../../daemon/index.js';

export const daemonCommand = new Command('daemon')
  .description('Manage the Sieve background daemon for pre-computation');

daemonCommand
  .command('start')
  .description('Start the background daemon')
  .option('--foreground', 'Run in foreground instead of background')
  .option('--path <dir>', 'Repository root path', '.')
  .action(async (options) => {
    const repoRoot = path.resolve(options.path);

    if (options.foreground) {
      console.log('🔬 Sieve Daemon — Running in foreground (Ctrl+C to stop)\n');
      await startDaemonForeground(repoRoot);
    } else {
      console.log('🔬 Sieve Daemon');
      console.log('');

      const { running, pid: existingPid } = isDaemonRunning(repoRoot);
      if (running) {
        console.log(`   Already running (PID: ${existingPid})`);
        return;
      }

      try {
        const pid = startDaemonBackground(repoRoot);
        console.log(`   ✅ Started (PID: ${pid})`);
        console.log(`   Repository: ${repoRoot}`);
        console.log(`   Log: ${path.join(repoRoot, '.sieve', 'daemon.log')}`);
        console.log('');
        console.log('   The daemon will silently update the graph as you edit files.');
        console.log('   Run "sieve daemon stop" to stop it.');
      } catch (err) {
        console.error(`   ❌ Failed to start: ${(err as Error).message}`);
      }
    }
  });

daemonCommand
  .command('stop')
  .description('Stop the background daemon')
  .option('--path <dir>', 'Repository root path', '.')
  .action((options) => {
    const repoRoot = path.resolve(options.path);

    const stopped = stopDaemon(repoRoot);
    if (stopped) {
      console.log('🔬 Sieve Daemon — Stopped');
    } else {
      console.log('🔬 Sieve Daemon — Not running');
    }
  });

daemonCommand
  .command('status')
  .description('Check daemon status')
  .option('--path <dir>', 'Repository root path', '.')
  .action((options) => {
    const repoRoot = path.resolve(options.path);

    const status = getDaemonStatus(repoRoot);

    console.log('🔬 Sieve Daemon Status');
    console.log('━'.repeat(40));

    if (status.running) {
      console.log(`   Status:  🟢 Running`);
      console.log(`   PID:     ${status.pid}`);
    } else {
      console.log(`   Status:  🔴 Stopped`);
    }

    if (status.logPath) {
      console.log(`   Log:     ${status.logPath}`);
    }

    if (status.logTail) {
      console.log('');
      console.log('   Recent log:');
      console.log('   ─'.repeat(20));
      for (const line of status.logTail.split('\n')) {
        console.log(`   ${line}`);
      }
    }

    console.log('━'.repeat(40));
  });
