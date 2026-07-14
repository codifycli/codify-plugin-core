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

export enum PackageManager {
  BREW = 'brew',
  APT = 'apt',
  DNF = 'dnf',
  YUM = 'yum',
  PACMAN = 'pacman',
}

export interface BasePkgMgrOptions {
  flags?: string[];
}

export interface BrewOptions extends BasePkgMgrOptions {
  cask?: boolean;
  adopt?: boolean;
}

export interface AptOptions extends BasePkgMgrOptions {}
export interface DnfOptions extends BasePkgMgrOptions {}
export interface YumOptions extends BasePkgMgrOptions {}
export interface PacmanOptions extends BasePkgMgrOptions {}

export type PkgMgrOptionsMap = {
  [PackageManager.BREW]?: BrewOptions;
  [PackageManager.APT]?: AptOptions;
  [PackageManager.DNF]?: DnfOptions;
  [PackageManager.YUM]?: YumOptions;
  [PackageManager.PACMAN]?: PacmanOptions;
};

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

  /**
   * Resolves the shell binary to launch commands with. `process.env.SHELL` is
   * only set when Codify is launched from a terminal — GUI launches (e.g. the
   * Codify desktop app via launchd) do not export it, in which case
   * `node-pty` would fall back to `/bin/sh`, which does not source the user's
   * `~/.zshrc`/`~/.bash_profile`. That drops user env (e.g. TART_HOME, PATH
   * additions), breaking resource refresh. Fall back to the login shell from
   * the passwd database (os.userInfo().shell) so we always use the user's real
   * shell regardless of how Codify was started.
   */
  getDefaultShell(): string {
    return process.env.SHELL || os.userInfo().shell || '/bin/zsh';
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
   * Installs a package via the system package manager. Auto-detects the PM from the OS unless
   * forcePackageManager is specified. Per-PM options (flags, cask, etc.) can be passed via the
   * options map.
   */
  async installViaPkgMgr(
    packageName: string,
    options?: PkgMgrOptionsMap,
    forcePackageManager?: PackageManager,
  ): Promise<void> {
    const $ = getPty();

    const useBrew = forcePackageManager === PackageManager.BREW || (!forcePackageManager && Utils.isMacOS());
    if (useBrew) {
      await this.assertBrewInstalled();
      const brewOpts = options?.[PackageManager.BREW];
      const flags: string[] = [];
      if (brewOpts?.cask || brewOpts?.adopt) flags.push('--cask');
      if (brewOpts?.adopt) flags.push('--adopt');
      if (brewOpts?.flags) flags.push(...brewOpts.flags);
      const flagStr = flags.length > 0 ? `${flags.join(' ')} ` : '';
      // Redirect stdin from /dev/null so Homebrew's ask.rb detects a non-TTY stdin
      // and skips any [y/n] confirmation prompts (e.g. "Do you want to proceed with the installation?").
      // NONINTERACTIVE=1 alone is not sufficient — Homebrew's prompt only checks tty?, not that var.
      await $.spawn(`brew install ${flagStr}${packageName} < /dev/null`, { interactive: true, env: { HOMEBREW_NO_AUTO_UPDATE: 1, NONINTERACTIVE: 1 } });
      return;
    }

    const useApt = forcePackageManager === PackageManager.APT || (!forcePackageManager && Utils.isLinux());
    if (useApt) {
      const aptOpts = options?.[PackageManager.APT];
      const extraFlags = aptOpts?.flags ?? [];

      const isAptInstalled = await $.spawnSafe('which apt');
      if (isAptInstalled.status === SpawnStatus.SUCCESS) {
        await $.spawn('apt-get update', { requiresRoot: true });
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        const { status, data } = await $.spawnSafe(`apt-get -y -qq install -o Dpkg::Use-Pty=0 -o Dpkg::Progress-Fancy=0 ${flagStr}${packageName}`, {
          requiresRoot: true,
          env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
        });

        if (status === SpawnStatus.ERROR && data.includes('E: dpkg was interrupted, you must manually run \'sudo dpkg --configure -a\' to correct the problem.')) {
          await $.spawn('dpkg --configure -a', { requiresRoot: true });
          await $.spawn(`apt-get -y install ${flagStr}${packageName}`, {
            requiresRoot: true,
            env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
          });
          return;
        }

        if (status === SpawnStatus.ERROR) {
          // Attempt to fix broken dependencies then retry
          const fixResult = await $.spawnSafe('apt-get install -f -y -o Dpkg::Use-Pty=0 -o Dpkg::Progress-Fancy=0', {
            requiresRoot: true,
            env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
          });

          if (fixResult.status === SpawnStatus.ERROR) {
            throw new Error(`Failed to install package ${packageName} via apt: ${data}`);
          }

          const retryResult = await $.spawnSafe(`apt-get -y -qq install -o Dpkg::Use-Pty=0 -o Dpkg::Progress-Fancy=0 ${flagStr}${packageName}`, {
            requiresRoot: true,
            env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
          });

          if (retryResult.status === SpawnStatus.ERROR) {
            throw new Error(`Failed to install package ${packageName} via apt after fixing dependencies: ${retryResult.data}`);
          }
        }
        return;
      }
    }

    if (forcePackageManager === PackageManager.DNF || !forcePackageManager) {
      const dnfOpts = options?.[PackageManager.DNF];
      const extraFlags = dnfOpts?.flags ?? [];
      const isDnfInstalled = await $.spawnSafe('which dnf');
      if (isDnfInstalled.status === SpawnStatus.SUCCESS) {
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        await $.spawn('dnf update', { requiresRoot: true });
        await $.spawn(`dnf install ${flagStr}${packageName} -y`, { requiresRoot: true });
        return;
      }
    }

    if (forcePackageManager === PackageManager.YUM || !forcePackageManager) {
      const yumOpts = options?.[PackageManager.YUM];
      const extraFlags = yumOpts?.flags ?? [];
      const isYumInstalled = await $.spawnSafe('which yum');
      if (isYumInstalled.status === SpawnStatus.SUCCESS) {
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        await $.spawn('yum update', { requiresRoot: true });
        await $.spawn(`yum install ${flagStr}${packageName} -y`, { requiresRoot: true });
        return;
      }
    }

    if (forcePackageManager === PackageManager.PACMAN || !forcePackageManager) {
      const pacmanOpts = options?.[PackageManager.PACMAN];
      const extraFlags = pacmanOpts?.flags ?? [];
      const isPacmanInstalled = await $.spawnSafe('which pacman');
      if (isPacmanInstalled.status === SpawnStatus.SUCCESS) {
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        await $.spawn('pacman -Syu', { requiresRoot: true });
        await $.spawn(`pacman -S ${flagStr}${packageName} --noconfirm`, { requiresRoot: true });
        return;
      }
    }
  },

  async uninstallViaPkgMgr(
    packageName: string,
    options?: PkgMgrOptionsMap,
    forcePackageManager?: PackageManager,
  ): Promise<boolean> {
    const $ = getPty();

    const useBrew = forcePackageManager === PackageManager.BREW || (!forcePackageManager && Utils.isMacOS());
    if (useBrew) {
      await this.assertBrewInstalled();
      const brewOpts = options?.[PackageManager.BREW];
      const flags: string[] = [];
      if (brewOpts?.cask || brewOpts?.adopt) flags.push('--cask');
      if (brewOpts?.flags) flags.push(...brewOpts.flags);
      flags.push('--zap');
      const flagStr = flags.length > 0 ? `${flags.join(' ')} ` : '';
      const { status } = await $.spawnSafe(`brew uninstall ${flagStr}${packageName}`, {
        interactive: true,
        env: { HOMEBREW_NO_AUTO_UPDATE: 1, NONINTERACTIVE: 1 }
      });
      return status === SpawnStatus.SUCCESS;
    }

    const useApt = forcePackageManager === PackageManager.APT || (!forcePackageManager && Utils.isLinux());
    if (useApt) {
      const aptOpts = options?.[PackageManager.APT];
      const extraFlags = aptOpts?.flags ?? [];
      const isAptInstalled = await $.spawnSafe('which apt');
      if (isAptInstalled.status === SpawnStatus.SUCCESS) {
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        const { status } = await $.spawnSafe(`apt-get -qq autoremove -y -o Dpkg::Use-Pty=0 -o Dpkg::Progress-Fancy=0 --purge ${flagStr}${packageName}`, {
          requiresRoot: true,
          env: { DEBIAN_FRONTEND: 'noninteractive', NEEDRESTART_MODE: 'a' }
        });
        return status === SpawnStatus.SUCCESS;
      }
    }

    if (forcePackageManager === PackageManager.DNF || !forcePackageManager) {
      const dnfOpts = options?.[PackageManager.DNF];
      const extraFlags = dnfOpts?.flags ?? [];
      const isDnfInstalled = await $.spawnSafe('which dnf');
      if (isDnfInstalled.status === SpawnStatus.SUCCESS) {
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        const { status } = await $.spawnSafe(`dnf autoremove ${flagStr}${packageName} -y`, { requiresRoot: true });
        return status === SpawnStatus.SUCCESS;
      }
    }

    if (forcePackageManager === PackageManager.YUM || !forcePackageManager) {
      const yumOpts = options?.[PackageManager.YUM];
      const extraFlags = yumOpts?.flags ?? [];
      const isYumInstalled = await $.spawnSafe('which yum');
      if (isYumInstalled.status === SpawnStatus.SUCCESS) {
        const flagStr = extraFlags.length > 0 ? `${extraFlags.join(' ')} ` : '';
        const { status } = await $.spawnSafe(`yum autoremove ${flagStr}${packageName} -y`, { requiresRoot: true });
        return status === SpawnStatus.SUCCESS;
      }
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



