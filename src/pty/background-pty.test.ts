import { describe, expect, it } from 'vitest';
import { BackgroundPty } from './background-pty.js';

describe('BackgroundPty tests', () => {
  it('Can launch a simple command', async () => {
    const pty = new BackgroundPty();

    const result = await pty.spawnSafe('ls');
    expect(result).toMatchObject({
      status: 'success',
      exitCode: 0,
    })


    const exitCode = await pty.kill();
    expect(exitCode).toMatchObject({
      exitCode: 0,
    });
  })

  // This test takes forever so going to disable for now.
  // it('Can launch 100 commands in parallel', { timeout: 15000 }, async () => {
  //   const pty = new BackgroundPty();
  //
  //   const fn = async () => pty.spawnSafe('ls');
  //
  //   const results = await Promise.all(
  //     Array.from({ length: 100 }, (_, i) => i + 1)
  //       .map(() => fn())
  //   )
  //
  //   expect(results.length).to.eq(100);
  //   expect(results.every((r) => r.exitCode === 0))
  //
  //   await pty.kill();
  // })

  it('Reports back the correct exit code and status', async () => {
    const pty = new BackgroundPty();

    const resultSuccess = await pty.spawnSafe('ls');
    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
    })

    const resultFailed = await pty.spawnSafe('which sjkdhsakjdhjkash');
    expect(resultFailed).toMatchObject({
      status: 'error',
      exitCode: 1,
    })

    await pty.kill();
  });

  it('Can use a different cwd', async () => {
    const pty = new BackgroundPty();

    const resultSuccess = await pty.spawnSafe('pwd', { cwd: '/tmp' });
    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
      data: '/tmp'
    })

    await pty.kill();
  });
})
