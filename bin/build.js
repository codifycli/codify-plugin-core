#!/usr/bin/env node
import { IpcMessageSchema, MessageStatus, ResourceSchema } from '@codifycli/schemas';
import commonjs from '@rollup/plugin-commonjs';
import json from '@rollup/plugin-json';
import nodeResolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import { Ajv } from 'ajv';
import mergeJsonSchemas from 'merge-json-schemas';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { rollup } from 'rollup';

const rollupConfig = {
  input: 'src/index.ts',
  output: {
    dir: 'dist',
    format: 'cjs',
    inlineDynamicImports: true,
  },
  treeshake: true,
  external: ['@homebridge/node-pty-prebuilt-multiarch'],
  plugins: [
    json(),
    nodeResolve({ exportConditions: ['node'] }),
    typescript({
      exclude: ['**/*.test.ts', '**/*.d.ts', 'test', 'bin']
    }),
    commonjs(),
    // terser()
  ]
};


const ajv = new Ajv({
  strict: true
});
const ipcMessageValidator = ajv.compile(IpcMessageSchema);

async function rollupProject() {
  await fs.mkdir('./dist', { recursive: true });

 const bundle = await rollup(rollupConfig);
  const { output } = await bundle.generate({ dir: 'dist', format: 'es' })

  for (const a of output) {
    if (a.type !== 'asset') {
      await fs.writeFile(path.join('dist', a.fileName), a.code);
    }
  }

  await bundle.close();
}

function sendMessageAndAwaitResponse(process, message) {
  return new Promise((resolve, reject) => {
    process.on('message', (response) => {
      if (!ipcMessageValidator(response)) {
        throw new Error(`Invalid message from plugin. ${JSON.stringify(message, null, 2)}`);
      }

      // Wait for the message response. Other messages such as sudoRequest may be sent before the response returns
      if (response.cmd === message.cmd + '_Response') {
        if (response.status === MessageStatus.SUCCESS) {
          resolve(response.data)
        } else {
          reject(new Error(String(response.data)))
        }
      }
    });

    // Send message last to ensure listeners are all registered
    process.send(message);
  });
}

async function findDocumentation() {
  console.log('Building documentation...');

  const results = new Map();
  const resourcesPath = path.resolve(process.cwd(), 'src', 'resources');

  // Helper function to recursively find README files
  async function findReadmeFiles(dir, relativePath = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const currentRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;

      if (entry.isDirectory()) {
        // Recurse into subdirectories
        await findReadmeFiles(fullPath, currentRelativePath);
      } else if (entry.isFile() && (entry.name === 'README.md' || entry.name === 'README.mdx')) {
        // Found a README file - determine its output path
        const sourceFile = path.join(dir, entry.name);
        const dirRelativePath = path.dirname(currentRelativePath);

        let outputPath;
        if (relativePath === '') {
          // Root README.md in /src/resources -> /dist/docs/index.md
          outputPath = 'index.md';
        } else if (dirRelativePath === '.') {
          // One level deep: /src/resources/git/README.md -> /dist/docs/resources/git.md
          outputPath = path.join('resources', path.basename(currentRelativePath, path.extname(currentRelativePath)) + '.md');
        } else {
          // Deeper nesting: maintain parent folders
          // /src/resources/package-managers/homebrew/README.md -> /dist/docs/resources/package-managers/homebrew.md
          const parentPath = path.dirname(dirRelativePath);
          const fileName = path.basename(dirRelativePath);
          outputPath = path.join('resources', parentPath, fileName + '.md');
        }

        results.set(sourceFile, outputPath);
      }
    }
  }

  await findReadmeFiles(resourcesPath);

  return results;
}

function isDirectory(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
}

async function main() {
  await fs.rm('./dist', { recursive: true, force: true });

  await fs.mkdir('./dist');
  await rollupProject();

  const plugin = fork(
    './dist/index.js',
    [],
    {
      // Use default true to test plugins in secure mode (un-able to request sudo directly)
      detached: true,
      env: { ...process.env },
      execArgv: ['--import', 'tsx/esm'],
    },
  )

  try {

    const initializeResult = await sendMessageAndAwaitResponse(plugin, {
      cmd: 'initialize',
      data: {}
    })

    const {resourceDefinitions} = initializeResult;
    const resourceTypes = resourceDefinitions.map((i) => i.type);
    const resourceInfoMap = new Map();

    const schemasMap = new Map()
    for (const type of resourceTypes) {
      const resourceInfo = await sendMessageAndAwaitResponse(plugin, {
        cmd: 'getResourceInfo',
        data: {type}
      })

      schemasMap.set(type, resourceInfo.schema);
      resourceInfoMap.set(type, resourceInfo);
    }

    console.log(resourceInfoMap);

    const mergedSchemas = [...schemasMap.entries()].map(([type, schema]) => {
      // const resolvedSchema = await $RefParser.dereference(schema)
      const resourceSchema = JSON.parse(JSON.stringify(ResourceSchema));

      delete resourceSchema.$id;
      delete resourceSchema.$schema;
      delete resourceSchema.title;
      delete resourceSchema.oneOf;
      delete resourceSchema.properties.type;

      if (schema) {
        delete schema.$id;
        delete schema.$schema;
        delete schema.title;
        delete schema.oneOf;
      }

      return mergeJsonSchemas([schema ?? {}, resourceSchema, {properties: {type: {const: type, type: 'string'}}}]);
    });


    await fs.rm('./dist', {recursive: true, force: true});
    await rollupProject();

    console.log('Generated JSON Schemas for all resources')

    const distFolder = path.resolve(process.cwd(), 'dist');
    const schemaOutputPath = path.resolve(distFolder, 'schemas.json');
    await fs.writeFile(schemaOutputPath, JSON.stringify(mergedSchemas, null, 2));

    console.log('Successfully wrote schema to ./dist/schemas.json');

    const documentationMap = await findDocumentation();
    console.log('Documentation Map:', documentationMap);

    // Build reverse map for resource type -> documentation path
    const resourceTypeToDocPath = new Map();
    for (const [sourceFile, outputPath] of documentationMap.entries()) {
      // Extract resource type from source file path
      // e.g., /src/resources/git/README.md -> git
      // e.g., /src/resources/package-managers/homebrew/README.md -> homebrew
      const relativePath = path.relative(path.resolve(process.cwd(), 'src', 'resources'), sourceFile);
      const parts = relativePath.split(path.sep);

      // Remove README.md/README.mdx from the end
      parts.pop();

      if (parts.length > 0) {
        // Use the last directory name as the resource type
        const resourceType = parts[parts.length - 1];
        resourceTypeToDocPath.set(resourceType, outputPath);
      }
    }

    const packageJson = JSON.parse(await fs.readFile('./package.json', 'utf8'));

    await fs.writeFile('./dist/manifest.json', JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      description: packageJson.description,
      resources: [...resourceInfoMap.values()].map((info) => ({
        type: info.type,
        description: info.description ?? info.schema?.description,
        sensitiveParameters: info.sensitiveParameters,
        schema: info.schema,
        operatingSystems: info.operatingSystems,
        documentationKey: resourceTypeToDocPath.get(info.type),
      })),
    }, null, 2), 'utf8');

    // Copy documentation files to /dist/docs
    const docsPath = path.join('dist', 'docs');
    await fs.mkdir(docsPath, { recursive: true });

    for (const [sourceFile, outputPath] of documentationMap.entries()) {
      const destFile = path.join(docsPath, outputPath);
      const destDir = path.dirname(destFile);

      await fs.mkdir(destDir, { recursive: true });
      await fs.copyFile(sourceFile, destFile);

      console.log(`Copied ${sourceFile} -> ${destFile}`);
    }
  } catch(e) {
    console.error(e);
  } finally {
    plugin.kill(9);
    process.exit(0);
  }
}

main();
