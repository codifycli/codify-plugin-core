import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  buildPathDeclaration,
  isSafeDoubleQuotedShellValue,
  toSafeDoubleQuotedShellValue,
  UnsafeShellValueError
} from './shell-escape.js';

const INJECTIONS = [
  '$(touch /tmp/pwned)',
  '`touch /tmp/pwned`',
  'a"; touch /tmp/pwned; echo "',
  'a\ntouch /tmp/pwned',
  'a\rtouch /tmp/pwned',
  'a\\"; touch /tmp/pwned; #',
  '$((1+1))',
  '${(e)EVIL}',
  '${EVIL@P}',
  '${EVIL:-$(touch /tmp/pwned)}',
  '$',
  '$1',
  '${}',
];

describe('shell-escape', () => {
  it('allows plain values and simple variable references', () => {
    for (const value of [
      '/usr/local/bin',
      '/Applications/My App/bin',
      '$HOME/.local/bin',
      '${PNPM_HOME}/bin',
      '$HOME/a:$OTHER_VAR/b',
      "it's;fine|really&(yes)",
      '',
    ]) {
      expect(isSafeDoubleQuotedShellValue(value), value).toBe(true);
    }
  });

  it('rejects command substitution, quotes, backslashes, new lines and complex expansions', () => {
    for (const value of INJECTIONS) {
      expect(isSafeDoubleQuotedShellValue(value), value).toBe(false);
      expect(() => toSafeDoubleQuotedShellValue(value), value).toThrow(UnsafeShellValueError);
    }
  });

  it('converts a leading tilde to $HOME', () => {
    expect(toSafeDoubleQuotedShellValue('~')).toBe('$HOME');
    expect(toSafeDoubleQuotedShellValue('~/bin')).toBe('$HOME/bin');
    expect(toSafeDoubleQuotedShellValue('/a/~b')).toBe('/a/~b');
  });

  it('builds quoted PATH declarations (prepend behaviour unchanged)', () => {
    expect(buildPathDeclaration('/opt/bin', false)).toBe('export PATH="/opt/bin:$PATH";');
    expect(buildPathDeclaration('/opt/bin', true)).toBe('export PATH="$PATH:/opt/bin";');
    expect(buildPathDeclaration('~/.local/bin', false)).toBe('export PATH="$HOME/.local/bin:$PATH";');
    expect(() => buildPathDeclaration('/opt/bin; touch /tmp/pwned', false)).not.toThrow();
    expect(() => buildPathDeclaration('$(touch /tmp/pwned)', false)).toThrow(UnsafeShellValueError);
  });

  it('produces declarations that the shell evaluates without running anything', () => {
    // A value that is allowed but would be dangerous unquoted
    const declaration = buildPathDeclaration('/opt/my dir;echo INJECTED', false);
    const output = execFileSync('sh', ['-c', `PATH=/usr/bin:/bin; ${declaration} printf '%s' "$PATH"`], { encoding: 'utf8' });
    expect(output).toBe('/opt/my dir;echo INJECTED:/usr/bin:/bin');
  });
});
