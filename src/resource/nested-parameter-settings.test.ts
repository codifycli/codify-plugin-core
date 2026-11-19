import { OS, ParameterOperation, ResourceOperation } from '@codifycli/schemas';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { testPlan } from '../utils/test-utils.test.js';
import { ConfigPath, parseParameterPath } from './parameter-paths.js';
import { ParsedResourceSettings } from './parsed-resource-settings.js';
import { Resource } from './resource.js';
import { ResourceController } from './resource-controller.js';
import { ParameterSettings, ResourceSettings } from './resource-settings.js';
import { StatefulParameter } from '../stateful-parameter/stateful-parameter.js';

const envFilesSchema = z.object({
  dir: z.string(),
  envFiles: z.array(z.object({
    name: z.string(),
    contents: z.array(z.object({ key: z.string(), value: z.string() })).optional(),
  })),
});
type EnvFilesConfig = z.infer<typeof envFilesSchema>;

const mcpSchema = z.object({
  mcpServers: z.array(z.discriminatedUnion('type', [
    z.object({ name: z.string(), type: z.literal('stdio'), env: z.record(z.string(), z.string()).optional(), cwd: z.string().optional() }),
    z.object({ name: z.string(), type: z.literal('http'), httpHeaders: z.record(z.string(), z.string()).optional() }),
  ])).optional(),
});
type McpConfig = z.infer<typeof mcpSchema>;

describe('Parameter paths', () => {
  it('parses paths into segments', () => {
    expect(parseParameterPath('a')).toEqual([{ kind: 'property', name: 'a' }]);
    expect(parseParameterPath('a[*].b.*')).toEqual([
      { kind: 'property', name: 'a' },
      { kind: 'items' },
      { kind: 'property', name: 'b' },
      { kind: 'values' },
    ]);
  });

  it('rejects malformed paths', () => {
    expect(() => parseParameterPath('a[0]')).toThrow();
    expect(() => parseParameterPath('.a')).toThrow();
    expect(() => parseParameterPath('a..b')).toThrow();
    expect(() => parseParameterPath('[*]')).toThrow();
  });

  it('generates typed paths (compile time)', () => {
    const paths: Array<ConfigPath<EnvFilesConfig>> = [
      'dir', 'envFiles', 'envFiles[*]', 'envFiles[*].name', 'envFiles[*].contents[*].value',
    ];
    const mcpPaths: Array<ConfigPath<McpConfig>> = ['mcpServers[*].env.*', 'mcpServers[*].httpHeaders.*'];

    const settings: ParameterSettings<EnvFilesConfig> = {
      envFiles: { key: 'name' },
      // @ts-expect-error typos in nested paths don't compile
      'envFiles[*].contents[*].valeu': { isSensitive: true },
    };

    const nested: ParameterSettings<EnvFilesConfig> = {
      // @ts-expect-error top level only settings are not allowed on nested paths
      'envFiles[*].name': { canModify: true },
    };

    expect(paths.length + mcpPaths.length).to.be.greaterThan(0);
    expect(settings && nested).toBeTruthy();
  });
});

describe('Nested parameter settings', () => {
  it('marks only nested values as sensitive and reports their paths', () => {
    const settings = new ParsedResourceSettings<EnvFilesConfig>({
      id: 'env-files',
      operatingSystems: [OS.Darwin],
      schema: envFilesSchema,
      parameterSettings: {
        envFiles: { canModify: true, key: 'name' },
        'envFiles[*].contents[*].value': { isSensitive: true },
      },
    });

    expect(settings.sensitiveParameters).toEqual(['envFiles']);
    expect(settings.parameterSettings.envFiles.sensitivePaths).toEqual(['envFiles[*].contents[*].value']);
    expect(settings.parameterSettings.dir.isSensitive).to.be.false;

    const plan = testPlan<EnvFilesConfig>({
      desired: { dir: '/a', envFiles: [{ name: '.env', contents: [{ key: 'A', value: 'secret' }] }] },
      current: null,
      settings: settings as any,
    });

    expect(plan.changeSet.parameterChanges.find((p) => p.name === 'envFiles')).toMatchObject({
      isSensitive: true,
      sensitivePaths: ['envFiles[*].contents[*].value'],
    });
    expect(plan.changeSet.parameterChanges.find((p) => p.name === 'dir')!.isSensitive).to.be.false;
  });

  it('supports records and discriminated unions', () => {
    const settings = new ParsedResourceSettings<McpConfig>({
      id: 'codex',
      operatingSystems: [OS.Darwin],
      schema: mcpSchema,
      parameterSettings: {
        mcpServers: { key: 'name' },
        'mcpServers[*].env.*': { isSensitive: true },
        'mcpServers[*].httpHeaders.*': { isSensitive: true },
        'mcpServers[*].cwd': { type: 'directory' },
      },
    });

    expect(settings.parameterSettings.mcpServers.sensitivePaths).toEqual([
      'mcpServers[*].env.*',
      'mcpServers[*].httpHeaders.*',
    ]);

    // Nested directory equality
    const isEqual = settings.parameterSettings.mcpServers.isEqual;
    expect(isEqual(
      [{ name: 'a', type: 'stdio', cwd: '~/project' }],
      [{ name: 'a', type: 'stdio', cwd: `${process.env.HOME}/project` }],
    )).to.be.true;
    expect(isEqual(
      [{ name: 'a', type: 'stdio', cwd: '~/project' }],
      [{ name: 'a', type: 'stdio', cwd: '~/other' }],
    )).to.be.false;
  });

  it('uses key to filter arrays in stateless mode so changed items are modifies', () => {
    const plan = testPlan<EnvFilesConfig>({
      desired: { dir: '/a', envFiles: [{ name: '.env', contents: [{ key: 'A', value: 'new' }] }] },
      current: [{
        dir: '/a',
        envFiles: [
          { name: '.env', contents: [{ key: 'A', value: 'old' }] },
          { name: '.env.unmanaged', contents: [] },
        ]
      }],
      settings: {
        id: 'env-files',
        schema: envFilesSchema,
        operatingSystems: [OS.Darwin],
        parameterSettings: { envFiles: { canModify: true, key: 'name' } },
      },
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.MODIFY);
    expect(plan.changeSet.parameterChanges.find((p) => p.name === 'envFiles')).toMatchObject({
      operation: ParameterOperation.MODIFY,
      previousValue: [{ name: '.env', contents: [{ key: 'A', value: 'old' }] }],
    });
  });

  it('uses nested types for keys (ex: directory keys)', () => {
    const schema = z.object({ symlinks: z.array(z.object({ path: z.string(), target: z.string() })) });
    const plan = testPlan<z.infer<typeof schema>>({
      desired: { symlinks: [{ path: '~/a', target: '~/b' }] },
      current: [{ symlinks: [{ path: `${process.env.HOME}/a`, target: `${process.env.HOME}/b` }, { path: '/x', target: '/y' }] }],
      settings: {
        id: 'symlinks',
        schema,
        operatingSystems: [OS.Darwin],
        parameterSettings: {
          symlinks: { canModify: true, key: 'path' },
          'symlinks[*].path': { type: 'directory' },
          'symlinks[*].target': { type: 'directory' },
        },
      },
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  });

  it('infers array and object types from the schema', () => {
    const schema = z.object({ list: z.array(z.string()), obj: z.object({ a: z.string() }).optional() });
    const plan = testPlan<z.infer<typeof schema>>({
      desired: { list: ['a', 'b'], obj: { a: 'x' } },
      current: [{ list: ['b', 'a', 'c'], obj: { a: 'x' } }],
      settings: { id: 'type', schema, operatingSystems: [OS.Darwin] },
    });

    // No settings were declared: arrays are filtered + compared ignoring order, objects deep compared
    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  });

  it('filters object parameters by the desired keys in stateless mode', () => {
    class SettingsParameter extends StatefulParameter<any, Record<string, unknown>> {
      getSettings() { return { type: 'object' as const } }
      async refresh() { return null }
      async add() {}
      async modify() {}
      async remove() {}
    }

    const plan = testPlan<any>({
      desired: { settings: { 'editor.fontSize': 14 } },
      current: [{ settings: { 'editor.fontSize': 14, 'workbench.colorTheme': 'Dark' } }],
      settings: { id: 'vscode', operatingSystems: [OS.Darwin], parameterSettings: { settings: { stateful: new SettingsParameter() } } },
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  });

  it('only removes previously managed object keys when destroying in stateful mode', () => {
    const plan = testPlan<any>({
      desired: null,
      state: { settings: { a: 1 } },
      current: [{ settings: { a: 1, b: 2 } }],
      settings: { id: 'type', operatingSystems: [OS.Darwin], parameterSettings: { settings: { type: 'object' } } },
      isStateful: true,
    });

    expect(plan.changeSet.parameterChanges[0]).toMatchObject({
      operation: ParameterOperation.REMOVE,
      previousValue: { a: 1 },
    });
  });

  it('merges stateful parameter settings with resource level settings', () => {
    class Versions extends StatefulParameter<any, string> {
      getSettings() { return { type: 'version' as const, default: '1' } }
      async refresh() { return null }
      async add() {}
      async modify() {}
      async remove() {}
    }

    const settings = new ParsedResourceSettings<any>({
      id: 'type',
      operatingSystems: [OS.Darwin],
      parameterSettings: { version: { stateful: new Versions(), isSensitive: true, order: 2 } },
    });

    const parsed = settings.parameterSettings.version;
    expect(parsed.isSensitive).to.be.true;
    expect(parsed.default).to.eq('1');
    expect(parsed.order).to.eq(2);
    expect(parsed.isEqual('20', '20.1.0')).to.be.true;
    expect(settings.statefulParameters.get('version')).to.eq(parsed.stateful);
  });
});

describe('Parameter settings validation', () => {
  const base = { id: 'type', operatingSystems: [OS.Darwin] };

  it('rejects paths that are not in the schema', () => {
    expect(() => new ParsedResourceSettings<any>({
      ...base, schema: envFilesSchema, parameterSettings: { 'envFiles[*].nope': { isSensitive: true } },
    })).toThrow(/does not exist in the schema/);

    expect(() => new ParsedResourceSettings<any>({
      ...base, schema: envFilesSchema, parameterSettings: { nope: { canModify: true } },
    })).toThrow(/does not exist in the schema/);
  });

  it('rejects top level only settings on nested paths', () => {
    expect(() => new ParsedResourceSettings<any>({
      ...base, parameterSettings: { 'a[*].b': { canModify: true } as any },
    })).toThrow(/top level only/);
  });

  it('rejects key on non arrays', () => {
    expect(() => new ParsedResourceSettings<any>({
      ...base, schema: envFilesSchema, parameterSettings: { dir: { key: 'a' } },
    })).toThrow(/key is only valid on arrays/);
  });

  it('gives migration errors for the removed v1 options', () => {
    expect(() => new ParsedResourceSettings<any>({
      ...base, parameterSettings: { a: { type: 'stateful', definition: {} } as any },
    })).toThrow(/stateful: new MyParameter/);

    expect(() => new ParsedResourceSettings<any>({
      ...base, parameterSettings: { a: { isEqual: 'version' } as any },
    })).toThrow(/String presets were removed/);
  });
});

describe('Zod schema handling', () => {
  class ZodResource extends Resource<any> {
    constructor(private schema: z.ZodObject) { super(); }
    getSettings(): ResourceSettings<any> { return { id: 'zod', operatingSystems: [OS.Darwin], schema: this.schema } }
    async refresh() { return null }
    async create() {}
    async destroy() {}
  }

  it('runs zod refinements during validation', async () => {
    const schema = z.object({
      files: z.array(z.object({ contents: z.string().optional(), remoteFile: z.string().optional() })
        .refine((d) => !(d.contents && d.remoteFile), { message: 'Only one of contents or remoteFile' })),
    });

    const controller = new ResourceController(new ZodResource(schema));
    const result = await controller.validate({ type: 'zod' }, { files: [{ contents: 'a', remoteFile: 'b' }] });

    expect(result.isValid).to.be.false;
    expect(result.customValidationErrorMessage).toContain('files.0: Only one of contents or remoteFile');

    const valid = await controller.validate({ type: 'zod' }, { files: [{ contents: 'a' }] });
    expect(valid.isValid).to.be.true;
  });

  it('treats fields with defaults as optional and keeps nested objects closed', async () => {
    const schema = z.object({
      name: z.string().default('x'),
      nested: z.array(z.object({ a: z.string() })).optional(),
    });

    const controller = new ResourceController(new ZodResource(schema));
    expect((await controller.validate({ type: 'zod' }, {})).isValid).to.be.true;
    expect((await controller.validate({ type: 'zod' }, { nested: [{ a: 'a', typo: 'b' }] })).isValid).to.be.false;
  });
});
