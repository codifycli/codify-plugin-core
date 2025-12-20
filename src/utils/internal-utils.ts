import { ResourceConfig, StringIndexedObject } from 'codify-schemas';
import os from 'node:os';
import path from 'node:path';

export const VerbosityLevel = new class {
  level = 0;

  get() {
    return this.level;
  }

  set(level: number) {
    this.level = level;
  }
}

export function isDebug(): boolean {
  return process.env.DEBUG != null && process.env.DEBUG.includes('codify'); // TODO: replace with debug library
}

export function splitUserConfig<T extends StringIndexedObject>(
  config: ResourceConfig & T
): { parameters: T; coreParameters: ResourceConfig } {
  const coreParameters = {
    type: config.type,
    ...(config.name ? { name: config.name } : {}),
    ...(config.dependsOn ? { dependsOn: config.dependsOn } : {}),
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { type, name, dependsOn, ...parameters } = config;

  return {
    parameters: parameters as T,
    coreParameters,
  };
}

export function setsEqual(set1: Set<unknown>, set2: Set<unknown>): boolean {
  return set1.size === set2.size && [...set1].every((v) => set2.has(v));
}

const homeDirectory = os.homedir();

export function untildify(pathWithTilde: string) {
  return homeDirectory ? pathWithTilde.replace(/^~(?=$|\/|\\)/, homeDirectory) : pathWithTilde;
}

export function tildify(pathWithTilde: string) {
  return homeDirectory ? pathWithTilde.replace(homeDirectory, '~') : pathWithTilde;
}

export function resolvePathWithVariables(pathWithVariables: string) {
  // @ts-expect-error Ignore this for now
  return pathWithVariables.replace(/\$([A-Z_]+[A-Z0-9_]*)|\${([A-Z0-9_]*)}/ig, (_, a, b) => process.env[a || b])
}

export function addVariablesToPath(pathWithoutVariables: string) {
  let result = pathWithoutVariables;
  for (const [key, value] of Object.entries(process.env)) {
    if (!value || !path.isAbsolute(value) || value === '/' || key === 'HOME' || key === 'PATH' || key === 'SHELL' || key === 'PWD') {
      continue;
    }

    result = result.replaceAll(value, `$${key}`)
  }

  return result;
}

export function unhome(pathWithHome: string): string {
  return pathWithHome.includes('$HOME') ? pathWithHome.replaceAll('$HOME', os.homedir()) : pathWithHome;
}

export function areArraysEqual(
  isElementEqual: ((desired: unknown, current: unknown) => boolean) | undefined,
  desired: unknown,
  current: unknown
): boolean {
  if (!desired || !current) {
    return false;
  }

  if (!Array.isArray(desired) || !Array.isArray(current)) {
    throw new Error(`A non-array value:
          
Desired: ${JSON.stringify(desired, null, 2)}

Current: ${JSON.stringify(desired, null, 2)}

Was provided even though type array was specified.
`)
  }

  if (desired.length !== current.length) {
    return false;
  }

  const desiredCopy = [...desired];
  const currentCopy = [...current];

  // Algorithm for to check equality between two un-ordered; un-hashable arrays using
  // an isElementEqual method. Time: O(n^2)
  for (let counter = desiredCopy.length - 1; counter >= 0; counter--) {
    const idx = currentCopy.findIndex((e2) => (
      isElementEqual
      ?? ((a, b) => a === b))(desiredCopy[counter], e2
    ))

    if (idx === -1) {
      return false;
    }

    desiredCopy.splice(counter, 1)
    currentCopy.splice(idx, 1)
  }

  return currentCopy.length === 0;
}
