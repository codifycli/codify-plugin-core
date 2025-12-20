import pty from '@homebridge/node-pty-prebuilt-multiarch';
import { EventEmitter } from 'node:events';
import stripAnsi from 'strip-ansi';

import { Shell, Utils } from '../utils/index.js';
import { VerbosityLevel } from '../utils/internal-utils.js';
import { IPty, SpawnError, SpawnOptions, SpawnResult, SpawnStatus } from './index.js';

EventEmitter.defaultMaxListeners = 1000;

/**
 * The background pty is a specialized pty designed for speed. It can launch multiple tasks
 * in parallel by moving them to the background. It attaches unix FIFO pipes to each process
 * to listen to stdout and stderr. One limitation of the BackgroundPty is that the tasks run
 * without a tty (or even a stdin) attached so interactive commands will not work.
 */
export class SequentialPty implements IPty {
  async spawn(cmd: string, options?: SpawnOptions): Promise<SpawnResult> {
    const spawnResult = await this.spawnSafe(cmd, options);

    if (spawnResult.status !== 'success') {
      throw new SpawnError(cmd, spawnResult.exitCode, spawnResult.data);
    }

    return spawnResult;
  }

  async spawnSafe(cmd: string, options?: SpawnOptions): Promise<SpawnResult> {
    console.log(`Running command: ${cmd}` + (options?.cwd ? `(${options?.cwd})` : ''))

    return new Promise((resolve) => {
      const output: string[] = [];

      const historyIgnore = Utils.getShell() === Shell.ZSH ? { HISTORY_IGNORE: '*' } : { HISTIGNORE: '*' };

      // If TERM_PROGRAM=Apple_Terminal is set then ANSI escape characters may be included
      // in the response.
      const env = {
        ...process.env, ...options?.env,
        TERM_PROGRAM: 'codify',
        COMMAND_MODE: 'unix2003',
        COLORTERM: 'truecolor', ...historyIgnore
      }

      // Initial terminal dimensions
      const initialCols = process.stdout.columns ?? 80;
      const initialRows = process.stdout.rows ?? 24;

      const args = (options?.interactive ?? true) ? ['-i', '-c', `"${cmd}"`] : ['-c', `"${cmd}"`]

      // Run the command in a pty for interactivity
      const mPty = pty.spawn(this.getDefaultShell(), args, {
        ...options,
        cols: initialCols,
        rows: initialRows,
        env
      });

      mPty.onData((data) => {
        if (VerbosityLevel.get() > 0) {
          process.stdout.write(data);
        }

        output.push(data.toString());
      })

      const stdinListener = (data) => {
        mPty.write(data.toString());
      };

      const resizeListener = () => {
        const { columns, rows } = process.stdout;
        mPty.resize(columns, rows);
      }

      // Listen to resize events for the terminal window;
      process.stdout.on('resize', resizeListener);
      // Listen for user input
      process.stdin.on('data', stdinListener);

      mPty.onExit((result) => {
        process.stdout.off('resize', resizeListener);
        process.stdin.off('data', stdinListener);

        resolve({
          status: result.exitCode === 0 ? SpawnStatus.SUCCESS : SpawnStatus.ERROR,
          exitCode: result.exitCode,
          data: stripAnsi(output.join('\n').trim()),
        })
      })
    })
  }

  async kill(): Promise<{ exitCode: number, signal?: number | undefined }> {
    // No-op here. Each pty instance is stand alone and tied to the parent process. Everything should be killed as expected.
    return {
      exitCode: 0,
      signal: 0,
    }
  }

  private getDefaultShell(): string {
    return process.env.SHELL!;
  }
}
