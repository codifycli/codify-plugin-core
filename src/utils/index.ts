import { OS } from 'codify-schemas';
import os from 'node:os';
import path from 'node:path';

import { getPty, SpawnStatus } from '../pty/index.js';

export function isDebug(): boolean {
  return process.env.DEBUG != null && process.env.DEBUG.includes('codify'); // TODO: replace with debug library
}

export enum Shell {
  ZSH = 'zsh',
  BASH = 'bash',
  SH = 'sh',
  KSH = 'ksh',
  CSH = 'csh',
  FISH = 'fish',
}

export interface SystemInfo {
  os: OS;
  shell: Shell;
}

export const Utils = {
  getUser(): string {
    return os.userInfo().username;
  },

  getSystemInfo() {
    return {
      os: os.type(),
      shell: this.getShell(),
    }
  },

  isMacOS(): boolean {
    return os.platform() === 'darwin';
  },

  isLinux(): boolean {
    return os.platform() === 'linux';
  },

  async isArmArch(): Promise<boolean> {
    const $ = getPty();
    if (!Utils.isMacOS()) {
      // On Linux, check uname -m
      const query = await $.spawn('uname -m');
      return query.data.trim() === 'aarch64' || query.data.trim() === 'arm64';
    }

    const query = await $.spawn('sysctl -n machdep.cpu.brand_string');
    return /M(\d)/.test(query.data);
  },

  async isHomebrewInstalled(): Promise<boolean> {
    const $ = getPty();
    const query = await $.spawnSafe('which brew', { interactive: true });
    return query.status === SpawnStatus.SUCCESS;
  },

  async isRosetta2Installed(): Promise<boolean> {
    if (!Utils.isMacOS()) {
      return false;
    }

    const $ = getPty();
    const query = await $.spawnSafe('arch -x86_64 /usr/bin/true 2> /dev/null', { interactive: true });
    return query.status === SpawnStatus.SUCCESS;
  },

  getShell(): Shell | undefined {
    const shell = process.env.SHELL || '';

    if (shell.endsWith('bash')) {
      return Shell.BASH
    }

    if (shell.endsWith('zsh')) {
      return Shell.ZSH
    }

    if (shell.endsWith('sh')) {
      return Shell.SH
    }

    if (shell.endsWith('csh')) {
      return Shell.CSH
    }

    if (shell.endsWith('ksh')) {
      return Shell.KSH
    }

    if (shell.endsWith('fish')) {
      return Shell.FISH
    }

    return undefined;
  },


  getPrimaryShellRc(): string {
    return this.getShellRcFiles()[0];
  },

  getShellRcFiles(): string[] {
    const shell = process.env.SHELL || '';
    const homeDir = os.homedir();

    if (shell.endsWith('bash')) {
      // Linux typically uses .bashrc, macOS uses .bash_profile
      if (Utils.isLinux()) {
        return [
          path.join(homeDir, '.bashrc'),
          path.join(homeDir, '.bash_profile'),
          path.join(homeDir, '.profile'),
        ];
      }

      return [
        path.join(homeDir, '.bash_profile'),
        path.join(homeDir, '.bashrc'),
        path.join(homeDir, '.profile'),
      ];
    }

    if (shell.endsWith('zsh')) {
      return [
        path.join(homeDir, '.zshrc'),
        path.join(homeDir, '.zprofile'),
        path.join(homeDir, '.zshenv'),
      ];
    }

    if (shell.endsWith('sh')) {
      return [
        path.join(homeDir, '.profile'),
      ]
    }

    if (shell.endsWith('ksh')) {
      return [
        path.join(homeDir, '.profile'),
        path.join(homeDir, '.kshrc'),
      ]
    }

    if (shell.endsWith('csh')) {
      return [
        path.join(homeDir, '.cshrc'),
        path.join(homeDir, '.login'),
        path.join(homeDir, '.logout'),
      ]
    }

    if (shell.endsWith('fish')) {
      return [
        path.join(homeDir, '.config/fish/config.fish'),
      ]
    }

    // Default to bash-style files
    return [
      path.join(homeDir, '.bashrc'),
      path.join(homeDir, '.bash_profile'),
      path.join(homeDir, '.profile'),
    ];
  },

  async isDirectoryOnPath(directory: string): Promise<boolean> {
    const $ = getPty();
    const { data: pathQuery } = await $.spawn('echo $PATH', { interactive: true });
    const lines = pathQuery.split(':');
    return lines.includes(directory);
  },
};



