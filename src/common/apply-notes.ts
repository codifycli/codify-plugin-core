import path from 'node:path';

import { Utils } from '../utils/index.js';

export const ApplyNotes = {
  RESTART_REQUIRED: 'A system restart is required for changes to take effect.',
  NEW_SHELL_REQUIRED: 'Open a new terminal session for the changes to be reflected.',
  sourceShellRc(): string {
    const rc = path.basename(Utils.getPrimaryShellRc());
    return `Source '~/${rc}' for the changes to be reflected.`;
  },
} as const;
