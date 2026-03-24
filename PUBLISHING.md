# Publishing Plugins to Codify Registry

This guide explains how to publish your Codify plugin to the public registry at [codifycli.com/registry](https://codifycli.com/registry).

## Prerequisites

1. **Build your plugin** - Your plugin must be built and have a `dist/` folder with:
   - `index.js` - Bundled plugin code
   - `manifest.json` - Plugin metadata
   - `schemas.json` - Resource schemas

2. **Authentication** - You need an API token stored in `~/.codify/credentials.json`:
   ```json
   {
     "apiToken": "your-token-here"
   }
   ```

   Get a token by running `codify login` (CLI command) or manually creating the file.

3. **Package.json metadata** - Ensure your `package.json` has:
   ```json
   {
     "name": "@your-org/plugin-name",
     "version": "1.0.0",
     "description": "Clear description of what your plugin does",
     "repository": {
       "type": "git",
       "url": "https://github.com/your-org/plugin-name"
     },
     "license": "MIT",
     "keywords": ["codify", "plugin", "your", "tags"],
     "homepage": "https://your-plugin-website.com"
   }
   ```

## Publishing Workflow

### 1. Build Your Plugin

```bash
npm run build
```

This runs `bin/build.js` which:
- Bundles your plugin with Rollup
- Generates `dist/manifest.json` with plugin metadata
- Generates `dist/schemas.json` with resource schemas
- Copies documentation from `src/resources/*/README.md` to `dist/documentation/`

### 2. Run the Publish Wizard

```bash
npm run publish-plugin
```

Or using the global command:

```bash
npx codify-publish
```

The interactive wizard will:

1. **Verify build artifacts** - Checks for `dist/index.js` and `dist/manifest.json`
2. **Suggest version bump** - Offers patch/minor/major or custom version
3. **Collect keywords** - Optional tags for searchability
4. **Collect categories** - Tags like "developer-tools", "productivity", etc.
5. **Scan README** - Includes `README.md` if present
6. **Scan /docs folder** - Includes all `.md` and `.mdx` files from `/docs`
7. **Show summary** - Reviews all metadata before publishing
8. **Confirm publish** - Final confirmation before upload

### 3. Upload to Registry

The wizard uploads:
- `manifest` (JSON) - Plugin metadata
- `source` (File) - `dist/index.js` bundle
- `readme` (File) - `README.md` (optional)
- `/documentation/*` (Files) - All docs from `/docs` folder (optional)

The API endpoint validates:
- Semantic versioning (must be > latest version)
- Reserved plugin names (e.g., "core", "official", "codify")
- Manifest schema
- Computes SHA256 checksum of bundle

## Documentation Structure

### README.md (Plugin-Level)

Place a `README.md` in your plugin root:

```
my-plugin/
├── README.md         # Plugin overview, installation, usage
├── package.json
├── src/
└── docs/             # Optional: Additional documentation
```

This README is displayed on the plugin's main page in the registry.

### Resource Documentation

Resource-specific docs go in `src/resources/{resource-type}/README.md`:

```
src/
└── resources/
    ├── homebrew/
    │   └── README.md     # Homebrew resource docs
    ├── git/
    │   └── README.md     # Git resource docs
    └── python/
        └── README.md     # Python resource docs
```

These are automatically copied to `dist/documentation/` during build and uploaded to R2.

### /docs Folder (Fumadocs Integration)

For comprehensive documentation with navigation, create a `/docs` folder:

```
docs/
├── index.mdx          # Overview
├── getting-started.mdx
├── resources/
│   ├── homebrew.mdx
│   ├── git.mdx
│   └── python.mdx
└── examples/
    ├── basic.mdx
    └── advanced.mdx
```

All `.md` and `.mdx` files are uploaded and rendered on the registry using Fumadocs.

**Frontmatter example:**
```mdx
---
title: Homebrew Resource
description: Manage Homebrew formulas with Codify
---

# Homebrew Resource

The Homebrew resource allows you to...
```

## Versioning

Follow [Semantic Versioning](https://semver.org/):

- **Patch (1.0.1)** - Bug fixes, documentation updates
- **Minor (1.1.0)** - New resources, backward-compatible features
- **Major (2.0.0)** - Breaking changes to resource schemas or behavior

### Pre-release Versions

Use suffixes for pre-releases:
- `1.0.0-alpha.1` - Early testing
- `1.0.0-beta.1` - Feature complete, testing
- `1.0.0-rc.1` - Release candidate

Pre-release versions are automatically detected (via regex: `version ~ '-'`) and marked in the database.

## Metadata Fields

### Manifest Structure

```json
{
  "name": "@your-org/plugin-name",
  "version": "1.0.0",
  "description": "Plugin description",
  "displayName": "Your Plugin Name",
  "homepage": "https://plugin-website.com",
  "repository": "https://github.com/your-org/plugin-name",
  "license": "MIT",
  "keywords": ["codify", "plugin", "homebrew"],
  "tags": ["developer-tools", "productivity"],
  "resources": [
    {
      "type": "homebrew",
      "description": "Manage Homebrew formulas",
      "schema": { ... },
      "documentationKey": "homebrew"
    }
  ]
}
```

### Keywords vs Tags

- **Keywords** - Free-form search terms (from `package.json`)
- **Tags** - Predefined categories for filtering:
  - `developer-tools`
  - `productivity`
  - `devops`
  - `security`
  - `web-dev`
  - `data-science`

## Best Practices

### 1. Comprehensive README

Include:
- Clear description of what the plugin does
- Installation instructions
- Configuration examples
- List of resources provided
- System requirements (OS, dependencies)

### 2. Resource Documentation

Each resource should have:
- Description of what it manages
- Configuration schema reference
- Example configurations
- Common use cases
- Troubleshooting tips

### 3. Version Changelog

Maintain a `CHANGELOG.md`:

```markdown
# Changelog

## [1.1.0] - 2025-03-24
### Added
- New Python resource for managing Python versions

### Fixed
- Homebrew formula installation on macOS 14+

## [1.0.0] - 2025-03-01
- Initial release
```

### 4. Testing Before Publishing

1. **Build locally**: `npm run build`
2. **Test plugin**: Use it in a real Codify project
3. **Validate schemas**: Ensure resources validate correctly
4. **Check documentation**: Review generated docs in `dist/documentation/`

### 5. Keywords for Discoverability

Choose keywords that users would search for:
- Technology names: "homebrew", "git", "docker"
- Use cases: "development", "automation", "devops"
- Platforms: "macos", "linux"

## Troubleshooting

### "Plugin name is reserved"

Some names are reserved: `core`, `official`, `codify`, `default`, `admin`, `api`, `docs`, `registry`, `system`, `internal`.

Choose a different name or prefix with your organization (e.g., `@myorg/core`).

### "Version not greater than latest"

Your version must be semantically greater than the latest published version. Check the registry for the current version and bump accordingly.

### "Invalid manifest"

Ensure your manifest follows the schema:
- `name` (string, required)
- `version` (string, semver, required)
- `resources` (array, required)
- Each resource must have `type` and `schema`

### "No API token found"

Create `~/.codify/credentials.json`:

```json
{
  "apiToken": "your-token-here"
}
```

Or run `codify login` to authenticate.

## Registry URLs

After publishing, your plugin will be available at:

- **Main page**: `https://codifycli.com/registry/{plugin-name}`
- **Specific version**: `https://codifycli.com/registry/{plugin-name}/{version}`
- **Documentation**: `https://codifycli.com/registry/{plugin-name}/docs`
- **Download URL**: `https://plugins.codifycli.com/{name}/{version}/index.js`

## Example: Publishing Workflow

```bash
# 1. Make changes to your plugin
vim src/resources/my-resource/index.ts

# 2. Update tests
npm test

# 3. Build
npm run build

# 4. Publish (interactive)
npm run publish-plugin

# Output:
# 🚀 Codify Plugin Publisher
# 📦 Plugin: @myorg/my-plugin
# 📄 Description: My awesome plugin
# 🔖 Current version in manifest: 1.0.0
#
# 📌 Suggested versions:
#    1. Patch (1.0.1) - Bug fixes, minor changes
#    2. Minor (1.1.0) - New features, backward compatible
#    3. Major (2.0.0) - Breaking changes
#    4. Custom version
#
# 🔢 Select version increment (1-4): 2
# ✅ Publishing version: 1.1.0
# ...
# ✅ Successfully published!
# 🔗 View at: https://codifycli.com/registry/@myorg/my-plugin
```

## Support

For issues or questions:
- GitHub: [github.com/codifycli/codify](https://github.com/codifycli/codify)
- Discord: [discord.gg/codify](https://discord.gg/codify)
- Docs: [codifycli.com/docs/publishing-plugins](https://codifycli.com/docs/publishing-plugins)
