import { describe, expect, it } from 'vitest';
import { SequentialPty } from './seqeuntial-pty.js';
import { VerbosityLevel } from '../utils/internal-utils.js';

describe('SequentialPty tests', () => {
  it('Can launch a simple command', async () => {
    const pty = new SequentialPty();

    VerbosityLevel.set(1);

    const result = await pty.spawnSafe('ls');
    expect(result).toMatchObject({
      status: 'success',
      exitCode: 0,
      data: expect.any(String),
    })

    const exitCode = await pty.kill();
    expect(exitCode).toMatchObject({
      exitCode: 0,
    });
  })

  it('Reports back the correct exit code and status', async () => {
    const pty = new SequentialPty();

    const resultSuccess = await pty.spawnSafe('ls');
    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
    })

    const resultFailed = await pty.spawnSafe('which sjkdhsakjdhjkash');
    expect(resultFailed).toMatchObject({
      status: 'error',
      exitCode: 127,
      data: 'zsh:1: command not found: which sjkdhsakjdhjkash' // This might change on different os or shells. Keep for now.
    })
  });

  it('Can use a different cwd', async () => {
    const pty = new SequentialPty();

    const resultSuccess = await pty.spawnSafe('pwd', { cwd: '/tmp' });
    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
      data: '/tmp'
    })
  });

  it('It can launch a command in interactive mode', async () => {
    const pty = new SequentialPty();

    const resultSuccess = await pty.spawnSafe('ls', { interactive: false });
    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
    })
  });
})
