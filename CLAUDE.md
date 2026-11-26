# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

`@codifycli/plugin-core` is a TypeScript library for building Codify plugins. Codify is an infrastructure-as-code tool
that manages system resources (applications, CLI tools, settings) through a declarative JSON configuration. This library
provides the core abstractions and runtime for implementing plugins that can create, modify, and destroy system
resources.

## Development Commands

### Testing

```bash
# Run all tests with Vitest
npm test

# Note: `npm test` also runs TypeScript compilation as a posttest step
```

### Building

```bash
# Compile TypeScript to dist/
npm run prepublishOnly

# Or just compile directly
npx tsc
```

### Linting

```bash
# Lint with ESLint (oclif + oclif-typescript + prettier configs)
npx eslint src/
```

### CLI Tool

The package includes a `codify-build` CLI tool (in `bin/build.js`) used by plugin implementations to generate
documentation and validate schemas.

## Architecture

### Core Concepts

**Plugin System Architecture:**

- **Plugin** (`src/plugin/plugin.ts`): Top-level container that manages multiple resource types and handles IPC
  communication with the Codify CLI via the MessageHandler
- **Resource** (`src/resource/resource.ts`): Abstract base class representing a manageable system resource (e.g.,
  homebrew, git config, applications). Each resource must implement:
    - `refresh()`: Query current system state
    - `create()`: Install/create the resource
    - `destroy()`: Uninstall/remove the resource
    - `modify()`: Update individual parameters (optional)
- **Plan** (`src/plan/plan.ts`): Represents a set of changes to transform current state into desired state, similar to
  Terraform plans. Contains a ChangeSet with parameter-level operations (ADD/REMOVE/MODIFY/NO-OP) and resource-level
  operation (CREATE/DESTROY/MODIFY/RECREATE/NO-OP)
- **ResourceController** (`src/resource/resource-controller.ts`): Orchestrates the full lifecycle: validation →
  planning → application. Handles both stateful mode (tracks state between runs) and stateless mode (declarative only)

**Stateful vs Stateless Modes:**

- **Stateless**: Plans computed by comparing desired config against current system state. Only manages parameters
  explicitly declared in config.
- **Stateful**: Tracks previous state. Enables destroy operations and more granular change detection. Plans compare
  desired vs state, then match state to current system state.

**Stateful Parameters** (`src/stateful-parameter/stateful-parameter.ts`):

- Parameters that have their own lifecycle tied to the parent resource (e.g., homebrew formulas, nvm node versions)
- Implement their own `refresh()`, `add()`, `modify()`, `remove()` methods
- Can be array-based (`ArrayStatefulParameter`) for managing collections

**PTY Abstraction** (`src/pty/`):

- `BackgroundPty`: Executes commands asynchronously during refresh/plan operations. Multiple commands can run in
  parallel. Killed after planning completes.
- `SequentialPty`: Executes commands synchronously during apply operations to ensure ordered execution and proper error
  handling
- `getPty()`: Access current PTY from async local storage context
- All shell execution goes through this abstraction for consistent output handling and root privilege escalation
- Command output goes through `CommandOutput.write()` (`src/utils/command-output.ts`). When the CLI sets
  `CODIFY_FORWARD_COMMAND_OUTPUT=1`, all of it is sent as `command_output` IPC messages (`{ data }`, no reply) and the CLI
  decides what to show (verbose mode, or a resource apply that is taking a while). Otherwise (older CLIs) it is written
  to stdout only when `VerbosityLevel > 0`. Plugins that run commands themselves should use it too. `console.log`
  lines (ex: `Running command: ...`) stay on stdout and are always shown.

**IPC Communication** (`src/messages/`):

- `MessageHandler`: Processes messages from Codify CLI (initialize, plan, apply, validate, import, match)
- `MessageSender`: Sends responses and requests (e.g., sudo password prompts) back to CLI
- Messages validated against schemas from `@codifycli/schemas`

### Directory Structure

```
src/
├── plugin/          - Plugin class and main entry point
├── resource/        - Resource base class, settings, controller
├── plan/            - Plan calculation and change set logic
├── stateful-parameter/ - Stateful parameter abstractions
├── pty/             - Pseudo-terminal abstraction for shell commands
├── messages/        - IPC message handlers and senders
├── utils/           - File utilities, path resolution, debug logging
└── common/          - Shared errors and types
```

### Key Files

- `src/index.ts`: Main entry point with `runPlugin()` function
- `src/plugin/plugin.ts`: Core plugin implementation (~290 lines)
- `src/resource/resource.ts`: Abstract Resource class
- `src/resource/resource-controller.ts`: Resource lifecycle orchestration
- `src/resource/resource-settings.ts`: Configuration schema for resources (parameter settings, OS support, allow
  multiple, etc.)
- `src/plan/plan.ts`: Plan calculation logic (~500 lines)
- `src/plan/change-set.ts`: Parameter-level diff algorithm
- `src/resource/parameter-paths.ts`: Typed parameter paths (`ConfigPath<T>`), path parsing and JSON schema lookup
- `src/resource/parsed-parameter-setting.ts`: Parameter settings parser (equality, filtering, sensitivity, stateful)
- `src/utils/schema-utils.ts`: `findUndescribedFields()` for enforcing schema documentation in plugin builds
- `bin/build.js`: Documentation/schema builder for plugin implementations

### Resource Settings

Resources are configured via `ResourceSettings<T>` returned by `getSettings()`:

- `id`: Unique type identifier
- `schema`: JSON Schema or Zod schema for validation
- `operatingSystems`: Supported OS platforms (darwin/linux/win32)
- `linuxDistros`: Supported Linux distributions (optional)
- `allowMultiple`: Whether multiple instances can coexist (requires `matcher` function)
- `parameterSettings`: Per-parameter configuration (types, equals functions, transformations, stateful parameters,
  sensitivity). Keys are top level parameter names or typed nested paths (`'envFiles[*].contents[*].value'`) used only
  when a nested value needs a setting. Parsed into one normalized `ParsedParameterSetting` per top level parameter by
  `src/resource/parsed-parameter-setting.ts` (merges stateful parameter defaults, infers array/object types from the
  schema, resolves equality/filtering/sensitive paths). Nothing outside that file should special case stateful,
  array or nested parameters.
- `isSensitive`: Marks resource as sensitive (prevents auto-import, hides values)
- `dependencies`: Resource IDs this resource depends on (soft: only orders resources present in the config)
- `requires`: Resource IDs that must exist (ex: `homebrew`, `xcode-tools` on macOS). The CLI adds a default config for
  missing ones. Sent in the initialize response (`ResourceDefinition.requires`, `@codifycli/schemas` 1.8.0)
- `canDestroy`: Whether resource can be destroyed (default: true)

## Implementation Notes

### Testing

- Uses Vitest with `pool: 'forks'` configuration for isolated test execution
- Test files use `.test.ts` suffix and are excluded from compilation
- TypeScript compilation runs as a posttest step to catch type errors

### Module System

- Uses ES modules (`"type": "module"` in package.json)
- Module resolution: `Node16` with `.js` extensions in imports (even for `.ts` files)
- Target: ES2022
- Requires Node.js >=22.0.0

### Parameter Matching and Filtering

Array parameters support custom matching logic:

- `isElementEqual`: Function to compare array elements
- `filterInStatelessMode`: Controls how current state is filtered against desired state in stateless mode
- Default behavior: filters current arrays to only include elements matching desired config (prevents spurious deletes)

### Path Handling

Utility functions in `src/utils/functions.ts`:

- `tildify()`: Convert absolute paths to use `~`
- `untildify()`: Expand `~` to home directory
- `resolvePathWithVariables()`: Resolve paths with variables like `$CODIFY_*`
- Path transformations are commonly used in `InputTransformation` for file/directory parameters

### CI/CD

GitHub Actions workflow (`.github/workflows/unit-test-ci.yaml`):

- Runs on push to any branch
- Tests on: `ubuntu-latest`, `macos-latest`
- Node.js version: 22.x
- Commands: `npm ci` → `npm run test`

### Dependencies

Key dependencies:

- `@codifycli/schemas`: Shared schema definitions and types
- `node-pty`: PTY (1.2 betas bundle prebuilt binaries for all platforms, so no install script is needed) for shell command execution
- `ajv`: JSON Schema validation
- `zod`: Alternative schema validation (v4)
- `clean-deep`: Remove null/undefined from objects
- `lodash.isequal`: Deep equality checks
