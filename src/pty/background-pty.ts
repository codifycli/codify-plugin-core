import pty from '@homebridge/node-pty-prebuilt-multiarch';
import { nanoid } from 'nanoid';
import * as cp from 'node:child_process';
import { EventEmitter } from 'node:events';
import * as fs from 'node:fs/promises';
import stripAnsi from 'strip-ansi';

import { debugLog } from '../utils/debug.js';
import { Shell, Utils } from '../utils/index.js';
import { VerbosityLevel } from '../utils/verbosity-level.js';
import { IPty, SpawnError, SpawnOptions, SpawnResult } from './index.js';
import { PromiseQueue } from './promise-queue.js';

EventEmitter.defaultMaxListeners = 1000;

/**
 * The background pty is a specialized pty designed for speed. It can launch multiple tasks
 * in parallel by moving them to the background. It attaches unix FIFO pipes to each process
 * to listen to stdout and stderr. One limitation of the BackgroundPty is that the tasks run
 * without a tty (or even a stdin) attached so interactive commands will not work.
 */
export class BackgroundPty implements IPty {
  private basePty = pty.spawn(this.getDefaultShell(), ['-i'], {
    env: process.env, name: nanoid(6),
    handleFlowControl: true
  });

  private promiseQueue = new PromiseQueue();

  constructor() {
    this.initialize();
  }

  async spawn(cmd: string, options?: SpawnOptions): Promise<SpawnResult> {
    const spawnResult = await this.spawnSafe(cmd, options);

    if (spawnResult.status !== 'success') {
      throw new SpawnError(cmd, spawnResult.exitCode, spawnResult.data);
    }

    return spawnResult;
  }

  async spawnSafe(cmd: string, options?: SpawnOptions): Promise<SpawnResult> {
    // cid is command id
    const cid = nanoid(10);
    debugLog(cid);

    await new Promise((resolve) => {
      // 600 permissions means only the current user will be able to rw from the FIFO
      // Create in /tmp so it could be automatically cleaned up if the clean-up was missed
      const mkfifoSpawn = cp.spawn('mkfifo', ['-m', '600', `/tmp/${cid}`]);
      mkfifoSpawn.on('close', () => {
        resolve(null);
      })
    })

    return new Promise<SpawnResult>((resolve) => {
      const cat = cp.spawn('cat', [`/tmp/${cid}`])

      let output = '';
      cat.stdout.on('data', (data) => {
        output += data.toString();

        if (output.includes('%%%done%%%"')) {
          const truncOutput = output.replace('%%%done%%%"\n', '');
          const [data, exit] = truncOutput.split('%%%');

          // Clean up trailing \n newline if it exists
          let strippedData = stripAnsi(data);
          if (strippedData.endsWith('\n')) {
            strippedData = strippedData.slice(0, -1);
          }

          resolve(<SpawnResult>{
            status: Number.parseInt(exit ?? 1, 10) === 0 ? 'success' : 'error',
            exitCode: Number.parseInt(exit ?? 1, 10),
            data: strippedData,
          });
        } else {
          // Print to stdout if the verbosity level is above 0
          if (VerbosityLevel.get() > 0) {
            process.stdout.write(data);
          }
        }
      })

      this.promiseQueue.run(async () => new Promise((resolve) => {
        const cdCommand = options?.cwd ? `cd ${options.cwd}; ` : '';
        // Redirecting everything to the pipe and running in theb background avoids most if not all back-pressure problems
        // Done is used to denote the end of the command
        // Use the \\" at the end differentiate between command and response. \\" will evaluate to " in the terminal
        const command = ` ((${cdCommand}${cmd}; echo %%%$?%%%done%%%\\") > "/tmp/${cid}" 2>&1 &); echo %%%done%%%${cid}\\";`

        let output = '';
        const listener = this.basePty.onData((data: any) => {
          output += data;

          if (output.includes(`%%%done%%%${cid}"`)) {
            listener.dispose();
            resolve(null);
          }
        });

        console.log(`Running command ${cmd}${options?.cwd ? ` (cwd: ${options.cwd})` : ''}`)
        this.basePty.write(`${command}\r`);

      }));
    }).finally(async () => {
      await fs.rm(`/tmp/${cid}`);
    })
  }

  async kill(): Promise<{ exitCode: number, signal?: number | undefined }> {
    return new Promise((resolve) => {
      this.basePty.onExit((status) => {
        resolve(status);
      })

      this.basePty.kill('SIGKILL')
    })
  }

  private async initialize() {
    // this.basePty.onData((data: string) => process.stdout.write(data));

    await this.promiseQueue.run(async () => {
      let outputBuffer = '';

      return new Promise(resolve => {
        // zsh-specific commands
        switch (Utils.getShell()) {
          case Shell.ZSH: {
            this.basePty.write('setopt HIST_NO_STORE;\n');
            break;
          }

          default: {
            this.basePty.write('export HISTIGNORE=\'history*\';\n');
            break;
          }
        }

        this.basePty.write(' unset PS1;\n');
        this.basePty.write(' unset PS0;\n')
        this.basePty.write(' echo setup complete\\"\n')

        const listener = this.basePty.onData((data: string) => {
          outputBuffer += data;
          if (outputBuffer.includes('setup complete"')) {
            listener.dispose();
            resolve(null);
          }
        })
      })
    })
  }

  private getDefaultShell(): string {
    return process.env.SHELL!;
  }
}
