# @codifycli/plugin-core

Core library for building [Codify](https://codifycli.com) plugins. Codify is an infrastructure-as-code tool that
manages system resources (applications, CLI tools, and settings) through declarative JSON configuration files.

## Overview

This library provides the foundational abstractions and runtime for creating Codify plugins. Plugins extend Codify's
capabilities by implementing resources that can be created, modified, and destroyed on a system. Examples of resources
include:

- **CLI Tools**: Homebrew, Docker, Git
- **Applications**: Google Chrome, VS Code, Zoom
- **Settings**: Git configs, AWS profiles, system preferences

## Installation

```bash
npm install @codifycli/plugin-core
```

**Requirements:**

- Node.js >= 22.0.0
- TypeScript 5.x (for development)

## Quick Start

Here's a minimal example of creating a plugin with a single resource:

```typescript
import { Resource, ResourceSettings, Plugin, runPlugin, getPty } from '@codifycli/plugin-core';
import { StringIndexedObject } from '@codifycli/schemas';

// Define the resource configuration type
interface GitConfig extends StringIndexedObject {
  userName?: string;
  userEmail?: string;
}

// Implement the Resource abstract class
class GitConfigResource extends Resource<GitConfig> {
  getSettings(): ResourceSettings<GitConfig> {
    return {
      id: 'git-config',
      operatingSystems: ['darwin', 'linux'],
      schema: {
        type: 'object',
        properties: {
          userName: { type: 'string' },
          userEmail: { type: 'string' }
        }
      }
    };
  }

  async refresh(parameters: Partial<GitConfig>) {
    const pty = getPty();

    const nameResult = await pty.spawnSafe('git config --global user.name');
    const emailResult = await pty.spawnSafe('git config --global user.email');

    return {
      userName: nameResult.status === 'success' ? nameResult.data.trim() : undefined,
      userEmail: emailResult.status === 'success' ? emailResult.data.trim() : undefined
    };
  }

  async create(plan) {
    const pty = getPty();
    const config = plan.desiredConfig!;

    if (config.userName) {
      await pty.spawn(`git config --global user.name "${config.userName}"`);
    }
    if (config.userEmail) {
      await pty.spawn(`git config --global user.email "${config.userEmail}"`);
    }
  }

  async destroy(plan) {
    const pty = getPty();

    await pty.spawn('git config --global --unset user.name');
    await pty.spawn('git config --global --unset user.email');
  }
}

// Create and run the plugin
const plugin = Plugin.create('my-plugin', [new GitConfigResource()]);
runPlugin(plugin);
```

## Core Concepts

### Plugin

The top-level container that manages multiple resource types. Handles IPC communication with the Codify CLI.

```typescript
const plugin = Plugin.create('plugin-name', [
  new Resource1(),
  new Resource2(),
  // ... more resources
]);

runPlugin(plugin);
```

### Resource

The fundamental building block representing a manageable system entity. Resources must implement:

- **`getSettings()`**: Return resource configuration (id, schema, OS support, etc.)
- **`refresh(parameters, context)`**: Query the current system state
- **`create(plan)`**: Install/create the resource
- **`destroy(plan)`**: Uninstall/remove the resource
- **`modify(parameterChange, plan)`**: Update individual parameters (optional)

### Plan

Represents a set of changes needed to transform the current state into the desired state. Plans contain:

- **Resource Operation**: CREATE, DESTROY, MODIFY, RECREATE, or NOOP
- **Parameter Changes**: Individual parameter-level operations (ADD, REMOVE, MODIFY, NOOP)

The planning workflow:

1. **Validate**: Check user configuration against schema
2. **Plan**: Compare desired vs. current state, generate change set
3. **Apply**: Execute the plan to make changes

### Stateful vs Stateless Modes

**Stateless Mode** (default):

- Plans computed by comparing desired config against current system state
- Only manages parameters explicitly declared in config
- No destroy operations (removing from config = ignored by Codify)

**Stateful Mode**:

- Tracks previous state between runs
- Supports destroy operations
- Plans compare desired vs. state, then match state to current system
- Enables granular change detection

### Stateful Parameters

Parameters with their own lifecycle, tied to the parent resource. Examples:

- Homebrew formulas (can be installed/uninstalled within Homebrew)
- NVM Node versions (managed within NVM)

```typescript
import { StatefulParameter } from '@codifycli/plugin-core';

class BrewFormulaParameter extends StatefulParameter<BrewConfig, string[]> {
  async refresh(desired, config) {
    const pty = getPty();
    const result = await pty.spawn('brew list --formula');
    return result.data.split('\n').filter(Boolean);
  }

  async add(formulas, plan) {
    const pty = getPty();
    await pty.spawn(`brew install --formula ${formulas.join(' ')}`);
  }

  async remove(formulas, plan) {
    const pty = getPty();
    await pty.spawn(`brew uninstall --formula ${formulas.join(' ')}`);
  }

  async modify(newValue, previousValue, plan) {
    // Handle formula updates
  }
}
```

Register in resource settings:

```typescript
getSettings(): ResourceSettings<BrewConfig> {
  return {
    id: 'homebrew',
    parameterSettings: {
      formulas: { stateful: new BrewFormulaParameter(), order: 1 },
    }
  };
}
```

### PTY Abstraction

Execute shell commands through the PTY abstraction:

```typescript
import { getPty } from '@codifycli/plugin-core';

const pty = getPty();

// Spawn command (throws on non-zero exit)
const result = await pty.spawn('brew install jq');

// Spawn safely (returns result with status)
const safeResult = await pty.spawnSafe('which jq');
if (safeResult.status === 'success') {
  console.log(safeResult.data);
}

// With options
await pty.spawn('npm install', {
  cwd: '/path/to/project',
  env: { NODE_ENV: 'production' },
  interactive: true,
  requiresRoot: false
});
```

Two PTY implementations:

- **BackgroundPty**: Async execution during refresh/plan (killed after planning)
- **SequentialPty**: Sync execution during apply operations

## Resource Settings

Configure resource behavior via `ResourceSettings<T>`:

```typescript
getSettings(): ResourceSettings<MyConfig> {
  return {
    // Required: unique type identifier
    id: 'my-resource',

    // Required: supported operating systems
    operatingSystems: ['darwin', 'linux', 'win32'],

    // Optional: supported Linux distributions
    linuxDistros: ['ubuntu', 'debian', 'fedora'],

    // Schema for validation. Zod is preferred: the config type is inferred from it and
    // .describe() text is used for docs and the editor.
    schema: z.object({
      version: z.string().describe('The version to install'),
      path: z.string().optional().describe('Install location'),
      apiKey: z.string().optional().describe('API key used to authenticate'),
      envFiles: z.array(z.object({
        name: z.string().describe('File name'),
        contents: z.array(z.object({
          key: z.string().describe('Variable name'),
          value: z.string().describe('Variable value'),
        })).describe('Variables in the file'),
      })).optional().describe('Env files to manage'),
    }),

    // Allow multiple instances
    allowMultiple: {
      identifyingParameters: ['name', 'path'],
      matcher: (desired, current) => desired.name === current.name
    },

    // Mark as sensitive (prevents auto-import)
    isSensitive: true,

    // Resource dependencies
    dependencies: ['other-resource-id'],

    // Per-parameter settings. Only declare what the schema can't express.
    parameterSettings: {
      path: { type: 'directory' },          // ~ expansion + path aware equality
      apiKey: { isSensitive: true },        // hidden in plan output
      envFiles: { canModify: true, key: 'name' },
      // Nested paths (typed, they autocomplete) for nested values that need settings
      'envFiles[*].contents': { key: 'key' },
      'envFiles[*].contents[*].value': { isSensitive: true },
    }
  };
}
```

### Parameter settings

Keys are top level parameter names or typed paths into the config (`a[*]` = every array element,
`a.*` = every record value). Typos in paths fail to compile and paths are validated against the schema at runtime.

| Setting | Where | Description |
|---|---|---|
| `type` | any | `string`, `number`, `boolean`, `directory`, `version`, `array`, `object`, `any`. Picks the equality (and for `directory`/`string`/`boolean` the input transformation). `array`/`object` are inferred from the schema. |
| `isSensitive` | any | Mask in the plan and gate imports. On a nested path only those values are sensitive. |
| `isEqual` | any | Custom equality. `ParameterEquals.<type>` exposes the built in ones. |
| `itemType`, `isElementEqual` | arrays | Element type / element equality. Arrays are compared ignoring order. |
| `key` | arrays of objects | Field(s) identifying an element. Drives stateless filtering, so a changed element is a modify. |
| `filterInStatelessMode` | arrays, objects | Defaults to true: arrays keep matching elements, objects keep the desired keys. Function or `false` to customize. |
| `default`, `transformation`, `canModify`, `setting` | top level | Default value, bi-directional input transformation, modify instead of recreate, exclude from the plan. |
| `stateful`, `order` | top level | Attach a `StatefulParameter`/`ArrayStatefulParameter` and its apply order. Its own `getSettings()` provides defaults. |

Nested settings affect equality, element identity and sensitivity. Defaults, transformations, `canModify` and
stateful parameters stay on top level parameters.

### Zod schemas

- `.describe()` / `.meta({ title, description, examples, deprecated })` must come **after** checks like `.min()`:
  Zod drops metadata when a check is chained after it. `findUndescribedFields(jsonSchema)` reports undocumented
  fields (including ones lost this way) so build scripts can enforce documentation.
- Fields with `.default()` are optional for users (the schema is converted in input mode).
- `.refine()` / `.superRefine()` are run during validation in addition to the JSON schema checks.

### Migrating from 1.x

| 1.x | 2.x |
|---|---|
| `{ type: 'stateful', definition: new X(), order: 1 }` | `{ stateful: new X(), order: 1 }` |
| `{ type: 'string', isEqual: 'version' }` | `{ type: 'version' }` (or `isEqual: ParameterEquals.version`) |
| `{ isElementEqual: 'object' }` | `{ itemType: 'object' }` |
| `isElementEqual` + `filterInStatelessMode` comparing an id field | `key: 'id'` |
| `isSensitive` on a whole array/object to hide nested secrets | `'param[*].secret': { isSensitive: true }` |
| `ArrayParameterSetting`, `DefaultParameterSetting` types | `ParameterSetting` (`StatefulParameterSetting` for `getSettings()` of stateful parameters) |

Behaviour changes: parameters whose schema type is `array`/`object` now use set/deep equality even without settings;
object parameters are filtered to the declared keys in stateless mode; plan parameter changes carry `sensitivePaths`
for nested sensitive values (`isSensitive` stays true so older CLIs mask the whole value).

## API Reference

### Core Classes

#### `Plugin`

- `static create(name: string, resources: Resource[]): Plugin`
- `async initialize(data): Promise<InitializeResponseData>`
- `async plan(data): Promise<PlanResponseData>`
- `async apply(data): Promise<void>`
- `async validate(data): Promise<ValidateResponseData>`
- `async import(data): Promise<ImportResponseData>`
- `async match(data): Promise<MatchResponseData>`

#### `Resource<T>`

- `abstract getSettings(): ResourceSettings<T>`
- `async initialize(): Promise<void>`
- `async validate(parameters): Promise<void>`
- `abstract refresh(parameters, context): Promise<T | T[] | null>`
- `abstract create(plan: CreatePlan<T>): Promise<void>`
- `abstract destroy(plan: DestroyPlan<T>): Promise<void>`
- `async modify(change: ParameterChange<T>, plan: ModifyPlan<T>): Promise<void>`

#### `Plan<T>`

- `id: string`
- `changeSet: ChangeSet<T>`
- `coreParameters: ResourceConfig`
- `isStateful: boolean`
- `desiredConfig: T | null`
- `currentConfig: T | null`
- `requiresChanges(): boolean`
- `toResponse(): PlanResponseData`

#### `StatefulParameter<T, V>`

- `getSettings(): ParameterSetting`
- `abstract refresh(desired, config): Promise<V | null>`
- `abstract add(value, plan): Promise<void>`
- `abstract modify(newValue, previousValue, plan): Promise<void>`
- `abstract remove(value, plan): Promise<void>`

### Utility Functions

```typescript
// PTY access
getPty(): IPty

// Path utilities
tildify(absolutePath: string): string
untildify(pathWithTilde: string): string
resolvePathWithVariables(path: string): string
addVariablesToPath(absolutePath: string): string

// File utilities
fileExists(path: string): Promise<boolean>
directoryExists(path: string): Promise<boolean>

// Array utilities
areArraysEqual<T>(a: T[], b: T[], isEqual?: (a: T, b: T) => boolean): boolean
```

## Building Plugins

The library includes a `codify-build` CLI tool for plugin development:

```bash
# Generate plugin documentation and validate schemas
npx codify-build
```

This tool expects a plugin implementation with a `src/resources/` directory structure.

## Development

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build
npx tsc

# Lint
npx eslint src/
```

## Examples

See the `@codifycli/plugin-core` tests for more examples:

- `src/plugin/plugin.test.ts` - Plugin lifecycle
- `src/resource/resource-controller.test.ts` - Resource operations
- `src/plan/plan.test.ts` - Plan calculation
- `src/stateful-parameter/stateful-parameter-controller.test.ts` - Stateful parameters

## License

ISC
