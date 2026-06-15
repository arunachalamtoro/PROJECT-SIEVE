/**
 * Daemon — background process lifecycle management.
 * Manages PID files, start/stop/status operations.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { SifthookdevStore } from '../indexer/store.js';
import { startWatcher } from './watcher.js';

const PID_FILE = 'daemon.pid';
const LOG_FILE = 'daemon.log';

/**
 * Get the path to the PID file.
 */
function getPidPath(repoRoot: string): string {
  return path.join(repoRoot, '.sifthookdev', PID_FILE);
}

/**
 * Get the path to the daemon log file.
 */
function getLogPath(repoRoot: string): string {
  return path.join(repoRoot, '.sifthookdev', LOG_FILE);
}

/**
 * Check if a daemon is currently running.
 */
export function isDaemonRunning(repoRoot: string): { running: boolean; pid?: number } {
  const pidPath = getPidPath(repoRoot);
  if (!fs.existsSync(pidPath)) {
    return { running: false };
  }

  const pid = parseInt(fs.readFileSync(pidPath, 'utf-8').trim(), 10);
  if (isNaN(pid)) {
    fs.unlinkSync(pidPath);
    return { running: false };
  }

  // Check if process is still alive
  try {
    process.kill(pid, 0);
    return { running: true, pid };
  } catch {
    // Process no longer exists, clean up stale PID file
    fs.unlinkSync(pidPath);
    return { running: false };
  }
}

/**
 * Start the daemon in the foreground (used when called directly).
 */
export async function startDaemonForeground(repoRoot: string): Promise<void> {
  const sifthookdevDir = path.join(repoRoot, '.sifthookdev');
  fs.mkdirSync(sifthookdevDir, { recursive: true });

  // Write PID file
  const pidPath = getPidPath(repoRoot);
  fs.writeFileSync(pidPath, process.pid.toString());

  // Set up log file
  const logPath = getLogPath(repoRoot);
  const logStream = fs.createWriteStream(logPath, { flags: 'a' });
  const logFn = (msg: string) => {
    const timestamp = new Date().toISOString();
    const line = `[${timestamp}] ${msg}`;
    logStream.write(line + '\n');
    console.log(line);
  };

  logFn('Sifthookdev daemon started');
  logFn(`Repository: ${repoRoot}`);
  logFn(`PID: ${process.pid}`);

  const store = new SifthookdevStore(repoRoot);
  const { watcher, stats } = startWatcher(repoRoot, store, logFn);

  logFn('Watching for file changes...');

  // Handle shutdown
  const cleanup = () => {
    logFn('Shutting down daemon...');
    logFn(`Stats: ${stats.filesUpdated} files updated, ${stats.embeddingsUpdated} embeddings updated`);
    watcher.close();
    store.close();
    logStream.end();

    // Remove PID file
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // Ignore
    }

    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep process alive
  await new Promise(() => { }); // Never resolves — daemon runs forever
}

/**
 * Start the daemon as a background process.
 */
export function startDaemonBackground(repoRoot: string): number {
  const { running, pid: existingPid } = isDaemonRunning(repoRoot);
  if (running) {
    console.log(`Daemon is already running (PID: ${existingPid})`);
    return existingPid!;
  }

  // Spawn a new detached process
  const child = spawn(
    process.execPath,
    [
      '--import', 'tsx',
      path.join(repoRoot, 'src', 'daemon', 'index.ts'),
      '--path', repoRoot,
    ],
    {
      detached: true,
      stdio: 'ignore',
      cwd: repoRoot,
      env: { ...process.env },
    }
  );

  child.unref();

  if (child.pid) {
    // Write PID file immediately
    const pidPath = getPidPath(repoRoot);
    fs.mkdirSync(path.dirname(pidPath), { recursive: true });
    fs.writeFileSync(pidPath, child.pid.toString());
    return child.pid;
  }

  throw new Error('Failed to start daemon process');
}

/**
 * Stop a running daemon.
 */
export function stopDaemon(repoRoot: string): boolean {
  const { running, pid } = isDaemonRunning(repoRoot);
  if (!running || !pid) {
    return false;
  }

  try {
    process.kill(pid, 'SIGTERM');
    // Clean up PID file
    const pidPath = getPidPath(repoRoot);
    try {
      fs.unlinkSync(pidPath);
    } catch {
      // May already be cleaned up by the daemon itself
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get daemon status info.
 */
export function getDaemonStatus(repoRoot: string): {
  running: boolean;
  pid?: number;
  logPath?: string;
  logTail?: string;
} {
  const { running, pid } = isDaemonRunning(repoRoot);
  const logPath = getLogPath(repoRoot);
  let logTail: string | undefined;

  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    logTail = lines.slice(-10).join('\n');
  }

  return { running, pid, logPath, logTail };
}

// If this file is executed directly (as the daemon process)
const isDirectExec = process.argv[1]?.includes('daemon/index');
if (isDirectExec) {
  const pathArg = process.argv.indexOf('--path');
  const repoRoot = pathArg !== -1 && process.argv[pathArg + 1]
    ? process.argv[pathArg + 1]!
    : process.cwd();

  startDaemonForeground(repoRoot).catch(console.error);
}
