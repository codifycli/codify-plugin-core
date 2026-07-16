import {
  CommandRequestResponseData,
  CommandRequestResponseDataSchema,
  IpcMessageV2,
  MessageCmd
} from '@codifycli/schemas';
import pty from '@homebridge/node-pty-prebuilt-multiarch';
import { Ajv } from 'ajv';
import { nanoid } from 'nanoid';
import { EventEmitter } from 'node:events';
import stripAnsi from 'strip-ansi';

import { Shell, Utils } from '../utils/index.js';
import { VerbosityLevel } from '../utils/verbosity-level.js';
import { IPty, SpawnError, SpawnOptions, SpawnResult, SpawnStatus } from './index.js';

EventEmitter.defaultMaxListeners = 1000;

const ajv = new Ajv({
  strict: true,
});
const validateSudoRequestResponse = ajv.compile(CommandRequestResponseDataSchema);

/**
 * The background pty is a specialized pty designed for speed. It can launch multiple tasks
 * in parallel by moving them to the background. It attaches unix FIFO pipes to each process
 * to listen to stdout and stderr. One limitation of the BackgroundPty is that the tasks run
 * without a tty (or even a stdin) attached so interactive commands will not work.
 */
export class SequentialPty implements IPty {
  private logBuffer: string[] = [];
  private static readonly MAX_LOG_LINES = 30;

  getLogs(): string[] {
    return [...this.logBuffer];
  }

  private appendLog(data: string): void {
    const lines = data.split('\n');
    this.logBuffer.push(...lines);
    if (this.logBuffer.length > SequentialPty.MAX_LOG_LINES) {
      this.logBuffer = this.logBuffer.slice(-SequentialPty.MAX_LOG_LINES);
    }
  }

  async spawn(cmd: string | string[], options?: SpawnOptions): Promise<SpawnResult> {
    const spawnResult = await this.spawnSafe(cmd, options);

    if (spawnResult.status !== 'success') {
      throw new SpawnError(Array.isArray(cmd) ? cmd.join('\n') : cmd, spawnResult.exitCode, spawnResult.data, this.logBuffer);
    }

    return spawnResult;
  }

  async spawnSafe(cmd: string | string[], options?: SpawnOptions): Promise<SpawnResult> {
    cmd = Array.isArray(cmd) ? cmd.join(' ') : cmd;

    if (cmd.includes('sudo')) {
      throw new Error('Do not directly use sudo. Use the option { requiresRoot: true } instead')
    }

    // If sudo is required, we must delegate to the main codify process.
    if (options?.stdin || options?.requiresRoot || options?.requiresSudoAskpass) {
      return this.externalSpawn(cmd, options);
    }

    const cmdLine = `Running command: ${Array.isArray(cmd) ? cmd.join('\\\n') : cmd}` + (options?.cwd ? `(${options?.cwd})` : '');
    console.log(cmdLine);
    this.appendLog(cmdLine);

    return new Promise((resolve) => {
      const output: string[] = [];
      const historyIgnore = Utils.getShell() === Shell.ZSH ? { HISTORY_IGNORE: '*' } : { HISTIGNORE: '*' };

      // If TERM_PROGRAM=Apple_Terminal is set then ANSI escape characters may be included
      // in the response.
      const env = {
        ...process.env, ...options?.env,
        TERM_PROGRAM: 'codify',
        COMMAND_MODE: 'unix2003',
        COLORTERM: 'truecolor',
        ...historyIgnore
      }

      // Initial terminal dimensions
      // Set to a really large value to prevent wrapping
      const initialCols = options?.disableWrapping ? 10_000 : process.stdout.columns ?? 80
      const initialRows = process.stdout.rows ?? 24;

      // zsh autocorrect prompts (e.g. "zsh: correct 'config' to '.config' [nyae]?") will hang
      // the pty waiting for interactive input. Can't be disabled via env var; must unset the options explicitly.
      const disableAutocorrect = Utils.getShell() === Shell.ZSH ? 'unsetopt CORRECT CORRECT_ALL 2>/dev/null; ' : '';
      const wrappedCmd = `${disableAutocorrect}${cmd}`;
      // Add -l (login shell) only for GUI launches (e.g. the Codify desktop app),
      // detected via the absence of process.env.SHELL, so rc files sourced via
      // ~/.zshrc/~/.zprofile are picked up. On terminal/CI launches, avoid -l:
      // it sources ~/.profile/~/.bash_profile instead of ~/.bashrc on Linux,
      // hiding PATH exports written by FileUtils.addToShellRc().
      const loginFlag = Utils.needsLoginShell() ? ['-l'] : [];
      const args = options?.interactive ? [...loginFlag, '-i', '-c', wrappedCmd] : ['-c', wrappedCmd]

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
        this.appendLog(data.toString());
      })

      const resizeListener = () => {
        const { columns, rows } = process.stdout;
        mPty.resize(columns, options?.disableWrapping ? 10_000 : rows);
      }

      // Listen to resize events for the terminal window;
      process.stdout.on('resize', resizeListener);

      mPty.onExit((result) => {
        process.stdout.off('resize', resizeListener);

        const raw = stripAnsi(output.join('')).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
        
        resolve({
          status: result.exitCode === 0 ? SpawnStatus.SUCCESS : SpawnStatus.ERROR,
          exitCode: result.exitCode,
          data: raw,
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

  // For safety reasons, requests that require sudo or are interactive must be run via the main client
  async externalSpawn(
    cmd: string,
    opts: SpawnOptions
  ): Promise<SpawnResult> {
    return new Promise((resolve) => {
      const requestId = nanoid(8);

      const listener = (data: IpcMessageV2) => {
        if (data.requestId === requestId) {
          process.removeListener('message', listener);

          if (!validateSudoRequestResponse(data.data)) {
            throw new Error(`Invalid response for sudo request: ${JSON.stringify(validateSudoRequestResponse.errors, null, 2)}`);
          }

          resolve(data.data as unknown as CommandRequestResponseData);
        }
      }

      process.on('message', listener);

      process.send!(<IpcMessageV2>{
        cmd: MessageCmd.COMMAND_REQUEST,
        data: {
          command: cmd,
          options: opts ?? {},
        },
        requestId
      })
    });
  }

  private getDefaultShell(): string {
    return Utils.getDefaultShell();
  }
}
