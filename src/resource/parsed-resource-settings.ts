import { LinuxDistro, OS, StringIndexedObject } from '@codifycli/schemas';
import { JSONSchemaType } from 'ajv';
import { z, ZodObject } from 'zod';

import { StatefulParameterController } from '../stateful-parameter/stateful-parameter-controller.js';
import { parseParameterSettings, ParsedParameterSetting } from './parsed-parameter-setting.js';
import {
  ExampleConfigs,
  InputTransformation,
  resolveMatcher,
  ResourceSettings,
} from './resource-settings.js';

export type { ParsedParameterSetting } from './parsed-parameter-setting.js';

export class ParsedResourceSettings<T extends StringIndexedObject> implements Omit<ResourceSettings<T>, 'parameterSettings'> {
  private cache = new Map<string, unknown>();
  id!: string;
  description?: string;

  schema?: Partial<JSONSchemaType<T | any>>;

  /** The original Zod schema when the resource was defined with one. Used to run refinements during validation. */
  zodSchema?: ZodObject;
  allowMultiple?: {
    identifyingParameters?: string[];
    matcher?: (desired: Partial<T>, current: Partial<T>) => boolean;
    findAllParameters?: () => Promise<Array<Partial<T>>>
  } | boolean;

  removeStatefulParametersBeforeDestroy?: boolean | undefined;
  dependencies?: string[] | undefined;
  requires?: string[] | undefined;
  transformation?: InputTransformation;

  operatingSystems!: Array<OS>;
  linuxDistros?: Array<LinuxDistro>;

  isSensitive?: boolean;

  defaultConfig!: Partial<T>;
  exampleConfigs!: ExampleConfigs;

  private settings: ResourceSettings<T>;

  constructor(settings: ResourceSettings<T>) {
    this.settings = settings;
    const { parameterSettings, schema, ...rest } = settings;

    Object.assign(this, rest);

    if (schema) {
      this.zodSchema = schema instanceof ZodObject ? schema : undefined;
      this.schema = schema instanceof ZodObject
        ? z.toJSONSchema(schema.strict(), {
          target: 'draft-7',
          // Input mode: fields with a .default() are optional for the user
          io: 'input',
          override(ctx) {
            // Input mode leaves nested objects open. Keep them closed like output mode unless the object is .loose()
            const def = (ctx.zodSchema as any)._zod?.def;
            if (def?.type === 'object' && def.catchall === undefined && ctx.jsonSchema.additionalProperties === undefined) {
              ctx.jsonSchema.additionalProperties = false;
            }

            if (ctx.path.length === 0) {
              ctx.jsonSchema.title = settings.id;
              ctx.jsonSchema.description = schema.description ?? settings.description ?? `${settings.id} resource. Can be used to manage ${settings.id}`;
              ctx.jsonSchema.$comment = (schema.meta() as Record<string, string | undefined> | undefined)?.$comment;
            }
          }
        }) as JSONSchemaType<T>
        : schema;
    }

    this.validateSettings();
  }

  get typeId(): string {
    return this.id;
  }

  get canDestroy(): boolean {
    return !this.settings.importAndDestroy?.preventDestroy;
  }

  /**
   * The normalized settings of every parameter that has settings (top level or nested), keyed by top level parameter.
   */
  get parameterSettings(): Record<keyof T, ParsedParameterSetting> {
    return this.getFromCacheOrCreate('parameterSettings', () => parseParameterSettings(
      this.id,
      (this.settings.parameterSettings ?? {}) as Record<string, any>,
      this.schema as Record<string, any> | undefined,
    )) as Record<keyof T, ParsedParameterSetting>;
  }

  get statefulParameters(): Map<keyof T, StatefulParameterController<T, T[keyof T]>> {
    return this.getFromCacheOrCreate('statefulParameters', () => new Map(
      Object.entries(this.parameterSettings as Record<string, ParsedParameterSetting>)
        .filter(([, v]) => v.stateful)
        .map(([k, v]) => [k, v.stateful!] as const)
    ) as Map<keyof T, StatefulParameterController<T, T[keyof T]>>);
  }

  /** Top level parameters that are sensitive or contain sensitive values. */
  get sensitiveParameters(): string[] {
    return Object.entries(this.parameterSettings as Record<string, ParsedParameterSetting>)
      .filter(([, v]) => v.isSensitive)
      .map(([k]) => k);
  }

  get defaultValues(): Partial<Record<keyof T, unknown>> {
    return this.getFromCacheOrCreate('defaultValues', () => Object.fromEntries(
      Object.entries(this.parameterSettings as Record<string, ParsedParameterSetting>)
        .filter(([, v]) => v.default !== undefined)
        .map(([k, v]) => [k, v.default] as const)
    ) as Partial<Record<keyof T, unknown>>);
  }

  get inputTransformations(): Partial<Record<keyof T, InputTransformation>> {
    return this.getFromCacheOrCreate('inputTransformations', () => Object.fromEntries(
      Object.entries(this.parameterSettings as Record<string, ParsedParameterSetting>)
        .filter(([, v]) => v.transformation !== undefined)
        .map(([k, v]) => [k, v.transformation] as const)
    ) as Partial<Record<keyof T, InputTransformation>>);
  }

  get statefulParameterOrder(): Map<keyof T, number> {
    return this.getFromCacheOrCreate('stateParameterOrder', () => {
      const entries = Object.entries(this.parameterSettings as Record<string, ParsedParameterSetting>)
        .filter(([, v]) => v.stateful)

      const orderedEntries = entries.filter(([, v]) => v.order !== undefined)
      const unorderedEntries = entries.filter(([, v]) => v.order === undefined)

      orderedEntries.sort((a, b) => a[1].order! - b[1].order!);

      const resultArray = [
        ...orderedEntries.map(([k]) => k),
        ...unorderedEntries.map(([k]) => k)
      ]

      return new Map(resultArray.map((key, idx) => [key, idx]));
    });
  }

  get matcher(): (desired: Partial<T>, current: Partial<T>) => boolean {
    return resolveMatcher(this);
  }

  private validateSettings(): void {
    // Parsing validates every parameter setting (paths, nested settings, stateful parameters)
    const parsedParameters = this.parameterSettings as Record<string, ParsedParameterSetting>;

    if (Object.entries(parsedParameters).some(([k, v]) =>
      v.stateful
      && typeof this.settings.allowMultiple === 'object' && this.settings.allowMultiple?.identifyingParameters?.includes(k))) {
      throw new Error(`Resource: ${this.id}. Stateful parameters are not allowed to be identifying parameters for allowMultiple.`)
    }

    const schema = this.schema as JSONSchemaType<any>;
    if (!this.settings.importAndDestroy && (schema?.oneOf
        && Array.isArray(schema.oneOf)
        && schema.oneOf.some((s) => s.required)
      )
      || (schema?.anyOf
        && Array.isArray(schema.anyOf)
        && schema.anyOf.some((s) => s.required)
      )
      || (schema?.allOf
        && Array.isArray(schema.allOf)
        && schema.allOf.some((s) => s.required)
      )
      || (schema?.then
        && Array.isArray(schema.then)
        && schema.then.some((s) => s.required)
      )
      || (schema?.else
        && Array.isArray(schema.else)
        && schema.else.some((s) => s.required)
      )
    ) {
      throw new Error(`In the schema of ${this.settings.id}, a conditional required was declared (within anyOf, allOf, oneOf, else, or then) but an` +
        'import.requiredParameters was not found in the resource settings. This is required because Codify uses the required parameter to' +
        'determine the prompt to ask users during imports. It can\'t parse which parameters are needed when ' +
        'required is declared conditionally.'
      )
    }

    if (this.settings.importAndDestroy) {
      const { requiredParameters, refreshKeys, defaultRefreshValues } = this.settings.importAndDestroy;

      const requiredParametersNotInSchema = requiredParameters
        ?.filter(
          (p) => schema && !(schema.properties[p])
        )
      if (schema && requiredParametersNotInSchema && requiredParametersNotInSchema.length > 0) {
        throw new Error(`The following properties were declared in settings.import.requiredParameters but were not found in the schema:
${JSON.stringify(requiredParametersNotInSchema, null, 2)}`)
      }

      const refreshKeyNotInSchema = refreshKeys
        ?.filter(
          (k) => schema && !(schema.properties[k])
        )
      if (schema && refreshKeyNotInSchema && refreshKeyNotInSchema.length > 0) {
        throw new Error(`The following properties were declared in settings.import.refreshKeys but were not found in the schema:
${JSON.stringify(requiredParametersNotInSchema, null, 2)}`)
      }

      const refreshValueNotInRefreshKey =
        Object.entries(defaultRefreshValues ?? {})
          .filter(
            ([k]) => schema && !(schema.properties[k])
          ).map(([k]) => k)

      if (schema && refreshValueNotInRefreshKey.length > 0) {
        throw new Error(`Properties declared in defaultRefreshValues must already be declared in refreshKeys:
${JSON.stringify(refreshValueNotInRefreshKey, null, 2)}`)
      }
    }
  }

  private getFromCacheOrCreate<T2>(key: string, create: () => T2): T2 {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T2
    }

    const result = create();

    this.cache.set(key, result)
    return result;
  }
}
