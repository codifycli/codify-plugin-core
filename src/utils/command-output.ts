import { VerbosityLevel } from './verbosity-level.js';

/** Set by the Codify CLI when it wants the output of every command, to decide itself what to show. */
export const FORWARD_COMMAND_OUTPUT_ENV = 'CODIFY_FORWARD_COMMAND_OUTPUT';

/** IPC message the output of commands is sent with. Fire and forget: the CLI does not reply. */
export const COMMAND_OUTPUT_MESSAGE_CMD = 'command_output';

/**
 * Output of the commands a plugin runs (installers, package managers, ...).
 *
 * CLIs that set CODIFY_FORWARD_COMMAND_OUTPUT=1 receive all of it over IPC and decide what to show (for ex: the output
 * of a resource that is taking a while, even in non-verbose mode). Older CLIs only get it on stdout in verbose mode.
 */
export const CommandOutput = new class {
  isForwarding(): boolean {
    return process.env[FORWARD_COMMAND_OUTPUT_ENV] === '1' && typeof process.send === 'function' && process.connected;
  }

  write(data: Buffer | string): void {
    const text = data.toString();
    if (text.length === 0) {
      return;
    }

    if (this.isForwarding()) {
      try {
        process.send!({ cmd: COMMAND_OUTPUT_MESSAGE_CMD, requestId: '', data: { data: text } });
      } catch {
        // The channel closed (the CLI is exiting). The output is not needed anymore.
      }

      return;
    }

    if (VerbosityLevel.get() > 0) {
      process.stdout.write(text);
    }
  }
}
