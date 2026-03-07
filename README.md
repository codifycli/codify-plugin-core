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
getSettings()
:
ResourceSettings < BrewConfig > {
  return {
    id: 'homebrew',
    parameterSettings: {
      formulas: {
        type: 'stateful',
        implementation: new BrewFormulaParameter()
      }
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
getSettings()
:
ResourceSettings < MyConfig > {
  return {
    // Required: unique type identifier
    id: 'my-resource',

    // Required: supported operating systems
    operatingSystems: ['darwin', 'linux', 'win32'],

    // Optional: supported Linux distributions
    linuxDistros: ['ubuntu', 'debian', 'fedora'],

    // Schema for validation (JSON Schema or Zod)
    schema: {
      type: 'object',
      properties: {
        version: { type: 'string' },
        path: { type: 'string' }
      },
      required: ['version']
    },

    // Allow multiple instances
    allowMultiple: {
      identifyingParameters: ['name', 'path'],
      matcher: (desired, current) => desired.name === current.name
    },

    // Prevent resource from being destroyed
    canDestroy: false,

    // Mark as sensitive (prevents auto-import)
    isSensitive: true,

    // Resource dependencies
    dependencies: ['other-resource-id'],

    // Per-parameter settings
    parameterSettings: {
      path: {
        inputTransformation: {
          to: (input) => untildify(input),    // Expand ~
          from: (current) => tildify(current)  // Convert to ~
        }
      },
      apiKey: {
        isSensitive: true  // Hide in plan output
      },
      tags: {
        type: 'array',
        isElementEqual: (a, b) => a.name === b.name
      }
    }
  };
}
```

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
getPty()
:
IPty

// Path utilities
tildify(absolutePath
:
string
):
string
untildify(pathWithTilde
:
string
):
string
resolvePathWithVariables(path
:
string
):
string
addVariablesToPath(absolutePath
:
string
):
string

// File utilities
fileExists(path
:
string
):
Promise<boolean>
directoryExists(path
:
string
):
Promise<boolean>

// Array utilities
areArraysEqual<T>(a
:
T[], b
:
T[], isEqual ? : (a: T, b: T) => boolean
):
boolean
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
