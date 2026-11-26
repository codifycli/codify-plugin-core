import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { COMMAND_OUTPUT_MESSAGE_CMD, CommandOutput, FORWARD_COMMAND_OUTPUT_ENV } from './command-output.js';
import { VerbosityLevel } from './verbosity-level.js';

describe('CommandOutput', () => {
  const originalSend = process.send;
  const originalConnected = Object.getOwnPropertyDescriptor(process, 'connected');
  let send: ReturnType<typeof vi.fn>;
  let stdoutWrite: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    send = vi.fn();
    process.send = send as unknown as typeof process.send;
    Object.defineProperty(process, 'connected', { configurable: true, value: true });
    stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.send = originalSend;
    if (originalConnected) {
      Object.defineProperty(process, 'connected', originalConnected);
    } else {
      delete (process as any).connected;
    }

    delete process.env[FORWARD_COMMAND_OUTPUT_ENV];
    VerbosityLevel.set(0);
    stdoutWrite.mockRestore();
  });

  it('Sends all output over IPC when the CLI asks for it, whatever the verbosity', () => {
    process.env[FORWARD_COMMAND_OUTPUT_ENV] = '1';
    VerbosityLevel.set(0);

    CommandOutput.write('Downloading...\n');
    VerbosityLevel.set(1);
    CommandOutput.write(Buffer.from('Done\n'));

    expect(send).toHaveBeenNthCalledWith(1, { cmd: COMMAND_OUTPUT_MESSAGE_CMD, requestId: '', data: { data: 'Downloading...\n' } });
    expect(send).toHaveBeenNthCalledWith(2, { cmd: COMMAND_OUTPUT_MESSAGE_CMD, requestId: '', data: { data: 'Done\n' } });
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('Falls back to stdout in verbose mode for CLIs that do not ask for it', () => {
    CommandOutput.write('hidden\n');
    expect(stdoutWrite).not.toHaveBeenCalled();

    VerbosityLevel.set(1);
    CommandOutput.write('shown\n');

    expect(stdoutWrite).toHaveBeenCalledWith('shown\n');
    expect(send).not.toHaveBeenCalled();
  });

  it('Ignores a closed IPC channel', () => {
    process.env[FORWARD_COMMAND_OUTPUT_ENV] = '1';
    send.mockImplementation(() => { throw new Error('Channel closed'); });

    expect(() => CommandOutput.write('output')).not.toThrow();
  });
});
