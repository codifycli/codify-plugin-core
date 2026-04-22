import { LinuxDistro, OS } from '@codifycli/schemas';
import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
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
    const shell = process.env.SHELL || os.userInfo().shell || '';

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
    const shell = process.env.SHELL || os.userInfo().shell || '';
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

  async assertBrewInstalled(): Promise<void> {
    const $ = getPty();
    const brewCheck = await $.spawnSafe('which brew', { interactive: true });
    if (brewCheck.status === SpawnStatus.ERROR) {
      throw new Error(
        `Homebrew is not installed. Cannot install git-lfs without Homebrew installed.

Brew can be installed using Codify:
{
  "type": "homebrew",
}`
      );
    }
  },

  /**
   * Installs a package via the system package manager. This will use Homebrew on macOS and apt on Ubuntu/Debian or dnf on Fedora.
   * @param packageName
   */
  async installViaPkgMgr(packageName: string): Promise<void> {
    const $ = getPty();

    if (Utils.isMacOS()) {
      await this.assertBrewInstalled();
      await $.spawn(`brew install ${packageName}`, { interactive: true, env: { HOMEBREW_NO_AUTO_UPDATE: 1 } });
    }

    if (Utils.isLinux()) {
      const isAptInstalled = await $.spawnSafe('which apt');
      if (isAptInstalled.status === SpawnStatus.SUCCESS) {
        await $.spawn('apt-get update', { requiresRoot: true });
        const { status, data } = await $.spawnSafe(`apt-get -y -qq install -o Dpkg::Use-Pty=0 -o Dpkg::Progress-Fancy=0 ${packageName}`, {
          requiresRoot: true,
          env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a',  }
        });

        if (status === SpawnStatus.ERROR && data.includes('E: dpkg was interrupted, you must manually run \'sudo dpkg --configure -a\' to correct the problem.')) {
          await $.spawn('dpkg --configure -a', { requiresRoot: true });
          await $.spawn(`apt-get -y install ${packageName}`, {
            requiresRoot: true,
            env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
          });

          return;
        }

        if (status === SpawnStatus.ERROR) {
          throw new Error(`Failed to install package ${packageName} via apt: ${data}`);
        }
      }

      const isDnfInstalled = await $.spawnSafe('which dnf');
      if (isDnfInstalled.status === SpawnStatus.SUCCESS) {
        await $.spawn('dnf update', { requiresRoot: true });
        await $.spawn(`dnf install ${packageName} -y`, { requiresRoot: true });
      }

      const isYumInstalled = await $.spawnSafe('which yum');
      if (isYumInstalled.status === SpawnStatus.SUCCESS) {
        await $.spawn('yum update', { requiresRoot: true });
        await $.spawn(`yum install ${packageName} -y`, { requiresRoot: true });
      }

      const isPacmanInstalled = await $.spawnSafe('which pacman');
      if (isPacmanInstalled.status === SpawnStatus.SUCCESS) {
        await $.spawn('pacman -Syu', { requiresRoot: true });
        await $.spawn(`pacman -S ${packageName} --noconfirm`, { requiresRoot: true });
      }

    }
  },

  async uninstallViaPkgMgr(packageName: string): Promise<boolean> {
    const $ = getPty();

    if (Utils.isMacOS()) {
      await this.assertBrewInstalled();
      const { status } = await $.spawnSafe(`brew uninstall --zap ${packageName}`, {
        interactive: true,
        env: { HOMEBREW_NO_AUTO_UPDATE: 1 }
      });
      return status === SpawnStatus.SUCCESS;
    }

    if (Utils.isLinux()) {
      const isAptInstalled = await $.spawnSafe('which apt');
      if (isAptInstalled.status === SpawnStatus.SUCCESS) {
        const { status } = await $.spawnSafe(`apt-get -qq autoremove -y -o Dpkg::Use-Pty=0 -o Dpkg::Progress-Fancy=0 --purge ${packageName}`, {
          requiresRoot: true,
          env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
        });
        return status === SpawnStatus.SUCCESS;
      }

      const isDnfInstalled = await $.spawnSafe('which dnf');
      if (isDnfInstalled.status === SpawnStatus.SUCCESS) {
        const { status } = await $.spawnSafe(`dnf autoremove ${packageName} -y`, { requiresRoot: true });
        return status === SpawnStatus.SUCCESS;
      }

      const isYumInstalled = await $.spawnSafe('which yum');
      if (isYumInstalled.status === SpawnStatus.SUCCESS) {
        const { status } = await $.spawnSafe(`yum autoremove ${packageName} -y`, { requiresRoot: true });
        return status === SpawnStatus.SUCCESS;
      }

      return false;
    }

    return false;
  },

  async getLinuxDistro(): Promise<LinuxDistro | undefined> {
    const osRelease = await fs.readFile('/etc/os-release', 'utf8');
    const lines = osRelease.split('\n');
    for (const line of lines) {
      if (line.startsWith('ID=')) {
        const distroId = line.slice(3).trim().replaceAll('"', '');
        return Object.values(LinuxDistro).includes(distroId as LinuxDistro) ? distroId as LinuxDistro : undefined;
      }
    }

    return undefined;
  },

  async isUbuntu(): Promise<boolean> {
    return (await this.getLinuxDistro()) === LinuxDistro.UBUNTU;
  },

  async isDebian(): Promise<boolean> {
    return (await this.getLinuxDistro()) === LinuxDistro.DEBIAN;
  },

  async isArch(): Promise<boolean> {
    return (await this.getLinuxDistro()) === LinuxDistro.ARCH;
  },

  async isCentOS(): Promise<boolean> {
    return (await this.getLinuxDistro()) === LinuxDistro.CENTOS;
  },

  async isFedora(): Promise<boolean> {
    return (await this.getLinuxDistro()) === LinuxDistro.FEDORA;
  },

  async isRHEL(): Promise<boolean> {
    return (await this.getLinuxDistro()) === LinuxDistro.RHEL;
  },

  isDebianBased(): boolean {
    return fsSync.existsSync('/etc/debian_version');
  },

  isRedhatBased(): boolean {
    return fsSync.existsSync('/etc/redhat-release');
  }
};



