/**
 * Helpers for safely writing user supplied values into shell startup files (.zshrc, .bashrc, etc.).
 *
 * Values are written inside double quotes so that variable references such as `$HOME/bin` or `${PNPM_HOME}` keep
 * working. Everything else that the shell would evaluate inside double quotes (command substitution `$(...)`,
 * backticks, other `$` expansions such as `${(e)VAR}` or `${VAR@P}`, backslash escapes, closing quotes and new lines)
 * is rejected instead of escaped: escaping `$` would also break the intended variable references.
 */

// A safe value is made up of plain characters and simple variable references ($NAME or ${NAME}).
const SAFE_DOUBLE_QUOTED_VALUE_REGEX = /^(?:[^\n\r"$\\`]|\$[A-Z_a-z]\w*|\${[A-Z_a-z]\w*})*$/;

export class UnsafeShellValueError extends Error {
  constructor(value: string, description: string) {
    super(`Unsafe ${description}: ${JSON.stringify(value)}. Values written to shell startup files may only contain plain characters and simple variable references ($NAME or \${NAME}). Command substitution, backticks, quotes, backslashes and new lines are not allowed.`);
    this.name = 'UnsafeShellValueError';
  }
}

export function isSafeDoubleQuotedShellValue(value: string): boolean {
  return SAFE_DOUBLE_QUOTED_VALUE_REGEX.test(value);
}

/**
 * Validates that a value is safe to place between double quotes in a shell startup file. A leading `~` is converted
 * to `$HOME` since tildes are not expanded inside double quotes. Throws {@link UnsafeShellValueError} otherwise.
 *
 * @param value - The user supplied value.
 * @param description - What the value is, used in the error message.
 * @returns the value to place between the double quotes
 */
export function toSafeDoubleQuotedShellValue(value: string, description = 'value'): string {
  const converted = value === '~' || value.startsWith('~/')
    ? `$HOME${value.slice(1)}`
    : value;

  if (!isSafeDoubleQuotedShellValue(converted)) {
    throw new UnsafeShellValueError(value, description);
  }

  return converted;
}

/**
 * Builds the PATH declaration line written to the shell startup file. The behaviour of `prepend` is kept as it was
 * before quoting was added.
 *
 * @param value - The directory to add to PATH.
 * @param prepend - Kept with its existing semantics.
 * @returns the full `export PATH=...` line
 */
export function buildPathDeclaration(value: string, prepend: boolean): string {
  const safeValue = toSafeDoubleQuotedShellValue(value, 'path');

  return prepend
    ? `export PATH="$PATH:${safeValue}";`
    : `export PATH="${safeValue}:$PATH";`;
}
