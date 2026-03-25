#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stdin as input, stdout as output } from 'node:process';
import readline from 'node:readline/promises';
import semver from 'semver';

const CREDENTIALS_PATH = path.join(os.homedir(), '.codify', 'credentials.json');
const API_URL = process.env.CODIFY_API_URL || 'https://api.codifycli.com';

/**
 * Interactive publish wizard for Codify plugins
 */
async function publish() {
  console.log('🚀 Codify Plugin Publisher\n');

  // Check if we're in a plugin directory
  if (!fs.existsSync('./package.json')) {
    console.error('❌ Error: No package.json found. Are you in a plugin directory?');
    process.exit(1);
  }

  if (!fs.existsSync('./dist/manifest.json')) {
    console.error('❌ Error: No dist/manifest.json found. Did you run `npm run build` first?');
    process.exit(1);
  }

  if (!fs.existsSync('./dist/index.js')) {
    console.error('❌ Error: No dist/index.js found. Did you run `npm run build` first?');
    process.exit(1);
  }

  // Load package.json and manifest
  const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('./dist/manifest.json', 'utf8'));

  console.log(`📦 Plugin: ${manifest.name}`);
  console.log(`📄 Description: ${manifest.description || 'N/A'}`);
  console.log(`🔖 Current version in manifest: ${manifest.version}\n`);

  // Check for required fields
  if (!packageJson.repository) {
    console.warn('⚠️  Warning: No repository URL in package.json. Consider adding one.');
  }

  if (!packageJson.license) {
    console.warn('⚠️  Warning: No license in package.json. Consider adding one.');
  }

  if (!packageJson.keywords || packageJson.keywords.length === 0) {
    console.warn('⚠️  Warning: No keywords in package.json. Consider adding some for better discoverability.');
  }

  // Interactive prompts
  const rl = readline.createInterface({ input, output });

  try {
    // Suggest next version
    const currentVersion = manifest.version;
    const suggestedPatch = semver.inc(currentVersion, 'patch');
    const suggestedMinor = semver.inc(currentVersion, 'minor');
    const suggestedMajor = semver.inc(currentVersion, 'major');

    console.log('📌 Suggested versions:');
    console.log(`   1. Patch (${suggestedPatch}) - Bug fixes, minor changes`);
    console.log(`   2. Minor (${suggestedMinor}) - New features, backward compatible`);
    console.log(`   3. Major (${suggestedMajor}) - Breaking changes`);
    console.log('   4. Custom version');

    const versionChoice = await rl.question('\n🔢 Select version increment (1-4): ');
    let newVersion;

    switch (versionChoice.trim()) {
      case '1': {
        newVersion = suggestedPatch;
        break;
      }

      case '2': {
        newVersion = suggestedMinor;
        break;
      }

      case '3': {
        newVersion = suggestedMajor;
        break;
      }

      case '4': {
        newVersion = await rl.question('Enter custom version (e.g., 1.0.0-beta.1): ');
        if (!semver.valid(newVersion)) {
          console.error('❌ Invalid semantic version. Aborting.');
          process.exit(1);
        }

        break;
      }

      default: {
        console.error('❌ Invalid choice. Aborting.');
        process.exit(1);
      }
    }

    console.log(`\n✅ Publishing version: ${newVersion}\n`);

    // Ask for keywords (optional)
    let keywords = packageJson.keywords || [];
    const addKeywords = await rl.question('➕ Add keywords for discoverability? (y/N): ');
    if (addKeywords.toLowerCase() === 'y') {
      const keywordInput = await rl.question('Enter keywords (comma-separated): ');
      keywords = keywordInput.split(',').map(k => k.trim()).filter(Boolean);
    }

    // Ask for tags (categories)
    const addTags = await rl.question('🏷️  Add tags/categories? (y/N): ');
    let tags = [];
    if (addTags.toLowerCase() === 'y') {
      console.log('Suggested categories: developer-tools, productivity, devops, security, web-dev, data-science');
      const tagInput = await rl.question('Enter tags (comma-separated): ');
      tags = tagInput.split(',').map(t => t.trim()).filter(Boolean);
    }

    // Check for README
    let readmeFile = null;
    if (fs.existsSync('./README.md')) {
      console.log('\n📖 README.md found');
      readmeFile = fs.readFileSync('./README.md');
    } else {
      console.warn('⚠️  Warning: No README.md found. Consider adding one.');
    }

    // Check for /docs folder
    let docsFiles = [];
    if (fs.existsSync('./docs')) {
      console.log('📚 /docs folder found');
      docsFiles = scanDocsFolder('./docs');
      console.log(`   Found ${docsFiles.length} documentation files`);
    }

    // Confirm publish
    console.log('\n' + '='.repeat(60));
    console.log('📋 Publish Summary:');
    console.log('='.repeat(60));
    console.log(`Plugin:      ${manifest.name}`);
    console.log(`Version:     ${newVersion}`);
    console.log(`Description: ${manifest.description || 'N/A'}`);
    console.log(`Keywords:    ${keywords.join(', ') || 'None'}`);
    console.log(`Tags:        ${tags.join(', ') || 'None'}`);
    console.log(`Resources:   ${manifest.resources.length} resource types`);
    console.log(`README:      ${readmeFile ? 'Yes' : 'No'}`);
    console.log(`Docs:        ${docsFiles.length} files`);
    console.log('='.repeat(60));

    const confirm = await rl.question('\n✅ Proceed with publish? (y/N): ');
    if (confirm.toLowerCase() !== 'y') {
      console.log('❌ Publish cancelled.');
      process.exit(0);
    }

    // Update manifest with new version and metadata
    manifest.version = newVersion;
    manifest.keywords = keywords;
    manifest.tags = tags;
    manifest.homepage = packageJson.homepage;
    manifest.repository = typeof packageJson.repository === 'string'
      ? packageJson.repository
      : packageJson.repository?.url;
    manifest.license = packageJson.license;
    manifest.displayName = packageJson.displayName || manifest.name;

    // Get API token
    const token = getApiToken();
    if (!token) {
      console.error('\n❌ Error: No API token found.');
      console.log('💡 Run `codify login` to authenticate, or create ~/.codify/credentials.json with:');
      console.log(JSON.stringify({ apiToken: 'your-token-here' }, null, 2));
      process.exit(1);
    }

    // Upload to registry
    console.log('\n📤 Uploading to registry...');
    await uploadPlugin(manifest, token, readmeFile, docsFiles);

    console.log('\n✅ Successfully published!');
    console.log(`🔗 View at: https://codifycli.com/registry/${manifest.name}`);

  } catch (error) {
    console.error('\n❌ Publish failed:', error.message);
    if (error.response) {
      console.error('Response:', await error.response.text());
    }

    process.exit(1);
  } finally {
    rl.close();
  }
}

/**
 * Scan /docs folder for MDX files
 */
function scanDocsFolder(docsPath) {
  const files = [];

  function scan(dir, relativePath = '') {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relPath = path.join(relativePath, entry.name);

      if (entry.isDirectory()) {
        scan(fullPath, relPath);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.mdx'))) {
        files.push({
          path: relPath,
          fullPath,
        });
      }
    }
  }

  scan(docsPath);
  return files;
}

/**
 * Get API token from credentials file
 */
function getApiToken() {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      return null;
    }

    const credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
    return credentials.apiToken;
  } catch {
    return null;
  }
}

/**
 * Upload plugin to registry
 */
async function uploadPlugin(manifest, token, readmeFile, docsFiles) {
  const formData = new FormData();

  // Add manifest
  formData.append('manifest', JSON.stringify(manifest));

  // Add bundled plugin source
  const sourceFile = new Blob([fs.readFileSync('./dist/index.js')], { type: 'application/javascript' });
  formData.append('source', sourceFile, 'index.js');

  // Add README if exists
  if (readmeFile) {
    const readmeBlob = new Blob([readmeFile], { type: 'text/markdown' });
    formData.append('readme', readmeBlob, 'README.md');
  }

  // Add documentation files
  for (const doc of docsFiles) {
    const docBlob = new Blob([fs.readFileSync(doc.fullPath)], { type: 'text/markdown' });
    formData.append(`/documentation/${doc.path}`, docBlob, doc.path);
  }

  // Upload to API
  const response = await fetch(`${API_URL}/v1/plugins`, {
    method: 'POST',
    headers: {
      'Authorization': token,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = new Error(`Upload failed: ${response.status} ${response.statusText}`);
    error.response = response;
    throw error;
  }

  return await response.json();
}

// Run publish
publish().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
