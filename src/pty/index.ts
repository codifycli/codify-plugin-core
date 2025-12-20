import { ptyLocalStorage } from '../utils/pty-local-storage.js';

export interface SpawnResult {
  status: 'error' | 'success';
  exitCode: number;
  data: string;
}

export enum SpawnStatus {
  SUCCESS = 'success',
  ERROR = 'error',
}

/**
 * Represents the configuration options for spawning a child process.
 *
 * @interface SpawnOptions
 *
 * @property {string} [cwd] - Specifies the working directory of the child process.
 * If not provided, the current working directory of the parent process is used.
 *
 * @property {Record<string, unknown>} [env] - Defines environment key-value pairs
 * that will be available to the child process. If not specified, the child process
 * will inherit the environment variables of the parent process.
 *
 * @property {boolean} [interactive] - Indicates whether the spawned process needs
 * to be interactive. Only works within apply (not plan). Defaults to true.
 */
export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, unknown>,
  interactive?: boolean,
}

export class SpawnError extends Error {
  data: string;
  cmd: string;
  exitCode: number;

  constructor(cmd: string, exitCode: number, data: string) {
    super(`Spawn Error: on command "${cmd}" with exit code: ${exitCode}\nOutput:\n${data}`);

    this.data = data;
    this.cmd = cmd;
    this.exitCode = exitCode;
  }

}

export interface IPty {
  spawn(cmd: string, options?: SpawnOptions): Promise<SpawnResult>

  spawnSafe(cmd: string, options?: SpawnOptions): Promise<SpawnResult>

  kill(): Promise<{ exitCode: number, signal?: number | undefined }>
}

export function getPty(): IPty {
  return ptyLocalStorage.getStore() as IPty;
}
