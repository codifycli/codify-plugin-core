#!/usr/bin/env node
import { Ajv } from 'ajv';
import { IpcMessageSchema, MessageStatus, ResourceSchema } from 'codify-schemas';
import mergeJsonSchemas from 'merge-json-schemas';
import { fork } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { SequentialPty, VerbosityLevel } from '../dist/index.js';

const ajv = new Ajv({
  strict: true
});
const ipcMessageValidator = ajv.compile(IpcMessageSchema);

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

function fetchDocumentationMaps() {
  console.log('Building documentation...');

  const results = new Map();
  const resourcesPath = path.resolve(process.cwd(), 'src', 'resources');
  const resourcesDir = fs.readdirSync(resourcesPath);

  for (const resource of resourcesDir) {
    const resourcePath = path.join(resourcesPath, resource);
    if (!isDirectory(resourcePath)) continue;

    const contents = fs.readdirSync(resourcePath);
    const isGroup = contents.some((content) => isDirectory(path.join(resourcePath, content)));
    const isAllDir = contents.every((content) => isDirectory(path.join(resourcePath, content)));

    if (isGroup && !isAllDir) {
      throw new Error(`Documentation groups must only contain directories. ${resourcePath} does not`);
    }

    if (!isGroup) {
      if (contents.includes('README.md')) {
        results.set(resource, resource);
      }
    } else {
      for (const innerDir of contents) {
        const innerDirReadme = path.join(resourcePath, innerDir, 'README.md');
        if (isFile(innerDirReadme)) {
          results.set(innerDir, path.relative('./src/resources', path.join(resourcePath, innerDir)));
        }
      }
    }
  }

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

VerbosityLevel.set(3);
const $ = new SequentialPty();

await $.spawn('rm -rf ./dist')
await $.spawn('npm run rollup -- -f es', { interactive: true });

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

const initializeResult = await sendMessageAndAwaitResponse(plugin, {
  cmd: 'initialize',
  data: {}
})

const { resourceDefinitions } = initializeResult;
const resourceTypes = resourceDefinitions.map((i) => i.type);
const resourceInfoMap = new Map();

const schemasMap = new Map()
for (const type of resourceTypes) {
  const resourceInfo = await sendMessageAndAwaitResponse(plugin, {
    cmd: 'getResourceInfo',
    data: { type }
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

  return mergeJsonSchemas([schema ?? {}, resourceSchema, { properties: { type: { const: type, type: 'string' } } }]);
});


await $.spawn('rm -rf ./dist')
await $.spawn('npm run rollup', { interactive: true }); // re-run rollup without building for es

console.log('Generated JSON Schemas for all resources')

const distFolder = path.resolve(process.cwd(), 'dist');
const schemaOutputPath = path.resolve(distFolder, 'schemas.json');
fs.writeFileSync(schemaOutputPath, JSON.stringify(mergedSchemas, null, 2));

console.log('Successfully wrote schema to ./dist/schemas.json');

const documentationMap = fetchDocumentationMaps();

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'));

fs.writeFileSync('./dist/manifest.json', JSON.stringify({
  name: packageJson.name,
  version: packageJson.version,
  description: packageJson.description,
  resources: [...resourceInfoMap.values()].map((info) => ({
    type: info.type,
    description: info.description ?? info.schema?.description,
    sensitiveParameters: info.sensitiveParameters,
    schema: info.schema,
    operatingSystems: info.operatingSystems,
    documentationKey: documentationMap.get(info.type),
  })),
}, null, 2), 'utf8');

for (const key of documentationMap.values()) {
  fs.mkdirSync(path.join('dist', 'documentation', key), { recursive: true })

  fs.copyFileSync(
    path.resolve(path.join('src', 'resources', key, 'README.md')),
    path.resolve(path.join('dist', 'documentation', key, 'README.md')),
  );
}

plugin.kill(9);
process.exit(0);
