import * as fsSync from 'node:fs';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';

import { Utils } from './index.js';

const SPACE_REGEX = /^\s*$/

export class FileUtils {
  static async downloadFile(url: string, destination: string): Promise<void> {
    console.log(`Downloading file from ${url} to ${destination}`);
    const { body } = await fetch(url)

    const dirname = path.dirname(destination);
    if (!await fs.stat(dirname).then((s) => s.isDirectory()).catch(() => false)) {
      await fs.mkdir(dirname, { recursive: true });
    }

    const ws = fsSync.createWriteStream(destination)
    // Different type definitions here for readable stream (NodeJS vs DOM). Small hack to fix that
    await finished(Readable.fromWeb(body as never).pipe(ws));

    console.log(`Finished downloading to ${destination}`);
  }

  static async addToShellRc(line: string): Promise<void> {
    const lineToInsert = addLeadingSpacer(
      addTrailingSpacer(line)
    );

    await fs.appendFile(Utils.getPrimaryShellRc(), lineToInsert)

    function addLeadingSpacer(line: string): string {
      return line.startsWith('\n')
        ? line
        : '\n' + line;
    }

    function addTrailingSpacer(line: string): string {
      return line.endsWith('\n')
        ? line
        : line + '\n';
    }
  }

  static async addAllToShellRc(lines: string[]): Promise<void> {
    const formattedLines = '\n' + lines.join('\n') + '\n';
    const shellRc = Utils.getPrimaryShellRc();

    console.log(`Adding to ${path.basename(shellRc)}:
${lines.join('\n')}`)

    await fs.appendFile(shellRc, formattedLines)
  }

  /**
   * This method adds a directory path to the shell rc file if it doesn't already exist.
   *
   * @param value - The directory path to add.
   * @param prepend - Whether to prepend the path to the existing PATH variable.
   */
  static async addPathToShellRc(value: string, prepend: boolean): Promise<void> {
    if (await Utils.isDirectoryOnPath(value)) {
      return;
    }

    const shellRc = Utils.getPrimaryShellRc();
    console.log(`Saving path: ${value} to ${shellRc}`);

    if (prepend) {
      await fs.appendFile(shellRc, `\nexport PATH=$PATH:${value};`, { encoding: 'utf8' });
      return;
    }

    await fs.appendFile(shellRc, `\nexport PATH=${value}:$PATH;`, { encoding: 'utf8' });
  }

  static async removeFromFile(filePath: string, search: string): Promise<void> {
    const contents = await fs.readFile(filePath, 'utf8');
    const newContents = contents.replaceAll(search, '');

    await fs.writeFile(filePath, newContents, 'utf8');
  }

  static async removeLineFromFile(filePath: string, search: RegExp | string): Promise<void> {
    const file = await fs.readFile(filePath, 'utf8')
    const lines = file.split('\n');

    let searchRegex;
    let searchString;

    if (typeof search === 'object') {
      const startRegex = /^([\t ]*)?/;
      const endRegex = /([\t ]*)?/;

      // Augment regex with spaces criteria to make sure this function is not deleting lines that are comments or has other content.
      searchRegex = search
        ? new RegExp(
          startRegex.source + search.source + endRegex.source,
          search.flags
        )
        : search;
    }

    if (typeof search === 'string') {
      searchString = search;
    }

    for (let counter = lines.length; counter >= 0; counter--) {
      if (!lines[counter]) {
        continue;
      }

      if (searchString && lines[counter].includes(searchString)) {
        lines.splice(counter, 1);
        continue;
      }

      if (searchRegex && lines[counter].search(searchRegex) !== -1) {
        lines.splice(counter, 1);
      }
    }

    await fs.writeFile(filePath, lines.join('\n'));
    console.log(`Removed line: ${search} from ${filePath}`)
  }

  static async removeLineFromShellRc(search: RegExp | string): Promise<void> {
    return FileUtils.removeLineFromFile(Utils.getPrimaryShellRc(), search);
  }

  static async removeAllLinesFromShellRc(searches: Array<RegExp | string>): Promise<void> {
    for (const search of searches) {
      await FileUtils.removeLineFromFile(Utils.getPrimaryShellRc(), search);
    }
  }

  // Append the string to the end of a file ensuring at least 1 lines of space between.
  // Ex result:
  // something something;
  //
  // newline;
  static appendToFileWithSpacing(file: string, textToInsert: string): string {
    const lines = file.trimEnd().split(/\n/);
    if (lines.length === 0) {
      return textToInsert;
    }

    const endingNewLines = FileUtils.calculateEndingNewLines(lines);
    const numNewLines = endingNewLines === -1
      ? 0
      : Math.max(0, 2 - endingNewLines);
    return lines.join('\n') + '\n'.repeat(numNewLines) + textToInsert
  }

  static async dirExists(path: string): Promise<boolean> {
    let stat;
    try {
      stat = await fs.stat(path);
      return stat.isDirectory();
    } catch {
      return false;
    }
  }

  static async fileExists(path: string): Promise<boolean> {
    let stat;
    try {
      stat = await fs.stat(path);
      return stat.isFile();
    } catch {
      return false;
    }
  }

  static async exists(path: string): Promise<boolean> {
    try {
      await fs.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  static async checkDirExistsOrThrowIfFile(path: string): Promise<boolean> {
    let stat;
    try {
      stat = await fs.stat(path);
    } catch {
      return false;
    }

    if (stat.isDirectory()) {
      return true;
    }

    throw new Error(`Directory ${path} already exists and is a file`);
  }

  static async createDirIfNotExists(path: string): Promise<void> {
    if (!fsSync.existsSync(path)) {
      await fs.mkdir(path, { recursive: true });
    }
  }

  // This is overly complicated but it can be used to insert into any
  // position in the future
  private static calculateEndingNewLines(lines: string[]): number {
    let counter = 0;
    while (true) {
      const line = lines.at(-counter - 1);

      if (!line) {
        return -1
      }

      if (!SPACE_REGEX.test(line)) {
        return counter;
      }

      counter++;

      // Short circuit here because we don't need to check over 2;
      if (counter > 2) {
        return counter;
      }
    }
  }
}
