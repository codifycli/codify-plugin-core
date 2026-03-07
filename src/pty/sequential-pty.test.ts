import { describe, expect, it } from 'vitest';
import { SequentialPty } from './seqeuntial-pty.js';
import { VerbosityLevel } from '../utils/verbosity-level.js';
import { MessageStatus, SpawnStatus } from '@codifycli/schemas/src/types/index.js';
import { IpcMessageV2, MessageCmd } from '@codifycli/schemas';

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
      exitCode: 1,
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


  it('Can use multi-line commands', async () => {
    const pty = new SequentialPty();

    const resultSuccess = await pty.spawnSafe([
      'pwd',
      '&& ls',
    ], { cwd: '/tmp' });
    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
    })
  });


  it('It can launch a command in interactive mode', { timeout: 30_000 }, async () => {
    const originalSend = process.send;
    process.send = (req: IpcMessageV2) => {
      expect(req).toMatchObject({
        cmd: MessageCmd.COMMAND_REQUEST,
        requestId: expect.any(String),
        data: {
          command: 'ls',
          options: {
            cwd: '/tmp',
            interactive: true,
          }
        }
      })

      // This may look confusing but what we're doing here is directly finding the process listener and calling it without going through serialization
      const listeners = process.listeners('message');
      listeners[2](({
        cmd: MessageCmd.COMMAND_REQUEST,
        requestId: req.requestId,
        status: MessageStatus.SUCCESS,
        data: {
          status: SpawnStatus.SUCCESS,
          exitCode: 0,
          data: 'My data',
        }
      }))

      return true;
    }

    const $ = new SequentialPty();
    const resultSuccess = await $.spawnSafe('ls', { interactive: true, cwd: '/tmp' });

    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
    });

    process.send = originalSend;
  });

  it('It can work with root (sudo)', async () => {
    const originalSend = process.send;
    process.send = (req: IpcMessageV2) => {
      expect(req).toMatchObject({
        cmd: MessageCmd.COMMAND_REQUEST,
        requestId: expect.any(String),
        data: {
          command: 'ls',
          options: {
            interactive: true,
            requiresRoot: true,
          }
        }
      })

      // This may look confusing but what we're doing here is directly finding the process listener and calling it without going through serialization
      const listeners = process.listeners('message');
      listeners[2](({
        cmd: MessageCmd.COMMAND_REQUEST,
        requestId: req.requestId,
        status: MessageStatus.SUCCESS,
        data: {
          status: SpawnStatus.SUCCESS,
          exitCode: 0,
          data: 'My data',
        }
      }))

      return true;
    }

    const $ = new SequentialPty();
    const resultSuccess = await $.spawn('ls', { interactive: true, requiresRoot: true });

    expect(resultSuccess).toMatchObject({
      status: 'success',
      exitCode: 0,
    });

    process.send = originalSend;
  })

  it('It can handle errors when in sudo', async () => {
    const originalSend = process.send;
    process.send = (req: IpcMessageV2) => {
      expect(req).toMatchObject({
        cmd: MessageCmd.COMMAND_REQUEST,
        requestId: expect.any(String),
        data: {
          command: 'ls',
          options: {
            requiresRoot: true,
            interactive: true,
          }
        }
      })

      // This may look confusing but what we're doing here is directly finding the process listener and calling it without going through serialization
      const listeners = process.listeners('message');
      listeners[2](({
        cmd: MessageCmd.COMMAND_REQUEST,
        requestId: req.requestId,
        status: MessageStatus.SUCCESS,
        data: {
          status: SpawnStatus.ERROR,
          exitCode: 127,
          data: 'My data',
        }
      }))

      return true;
    }

    const $ = new SequentialPty();
    const resultSuccess = await $.spawnSafe('ls', { interactive: true, requiresRoot: true });

    expect(resultSuccess).toMatchObject({
      status: SpawnStatus.ERROR,
      exitCode: 127,
    });

    process.send = originalSend;
  })
})
