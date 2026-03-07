import { LinuxDistro, OS, StringIndexedObject } from '@codifycli/schemas';
import { JSONSchemaType } from 'ajv';
import { ZodObject, z } from 'zod';

import { StatefulParameterController } from '../stateful-parameter/stateful-parameter-controller.js';
import {
  ArrayParameterSetting,
  DefaultParameterSetting,
  InputTransformation,
  ParameterSetting,
  ResourceSettings,
  StatefulParameterSetting,
  resolveElementEqualsFn,
  resolveEqualsFn,
  resolveMatcher,
  resolveParameterTransformFn
} from './resource-settings.js';

export interface ParsedStatefulParameterSetting extends DefaultParameterSetting {
  type: 'stateful',
  controller: StatefulParameterController<any, unknown>
  order?: number,
  nestedSettings: ParsedParameterSetting;
}

export type ParsedArrayParameterSetting = {
  isElementEqual: (a: unknown, b: unknown) => boolean;
  isEqual: (a: unknown, b: unknown) => boolean;
} & ArrayParameterSetting

export type ParsedParameterSetting =
  {
    isEqual: (desired: unknown, current: unknown) => boolean;
  } & (DefaultParameterSetting
  | ParsedArrayParameterSetting
  | ParsedStatefulParameterSetting)

export class ParsedResourceSettings<T extends StringIndexedObject> implements ResourceSettings<T> {
  private cache = new Map<string, unknown>();
  id!: string;
  description?: string;

  schema?: Partial<JSONSchemaType<T | any>>;
  allowMultiple?: {
    identifyingParameters?: string[];
    matcher?: (desired: Partial<T>, current: Partial<T>) => boolean;
    findAllParameters?: () => Promise<Array<Partial<T>>>
  } | boolean;

  removeStatefulParametersBeforeDestroy?: boolean | undefined;
  dependencies?: string[] | undefined;
  transformation?: InputTransformation;

  operatingSystems!: Array<OS>;
  linuxDistros?: Array<LinuxDistro>;

  isSensitive?: boolean;

  private settings: ResourceSettings<T>;

  constructor(settings: ResourceSettings<T>) {
    this.settings = settings;
    const { parameterSettings, schema, ...rest } = settings;

    Object.assign(this, rest);

    if (schema) {
      this.schema = schema instanceof ZodObject
        ? z.toJSONSchema(schema.strict(), {
          target: 'draft-7',
          override(ctx) {
            ctx.jsonSchema.title = settings.id;
            ctx.jsonSchema.description = settings.description ?? `${settings.id} resource. Can be used to manage ${settings.id}`;
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

  get statefulParameters(): Map<keyof T, StatefulParameterController<T, T[keyof T]>> {
    return this.getFromCacheOrCreate('statefulParameters', () => {

      const statefulParameters = Object.entries(this.settings.parameterSettings ?? {})
        .filter(([, p]) => p?.type === 'stateful')
        .map(([k, v]) => [
          k,
          new StatefulParameterController((v as StatefulParameterSetting).definition)
        ] as const)

      return new Map(statefulParameters) as Map<keyof T, StatefulParameterController<T, T[keyof T]>>;
    })
  }

  get parameterSettings(): Record<keyof T, ParsedParameterSetting> {
    return this.getFromCacheOrCreate('parameterSetting', () => {

      const settings = Object.entries(this.settings.parameterSettings ?? {})
        .map(([k, v]) => [k, v!] as const)
        .map(([k, v]) => {
          v.isEqual = resolveEqualsFn(v);

          if (v.type === 'stateful') {
            const spController = this.statefulParameters.get(k);
            const parsed = {
              ...v,
              controller: spController,
              nestedSettings: spController?.parsedSettings,
            };

            return [k, parsed as ParsedStatefulParameterSetting];
          }

          if (v.type === 'array') {
            const parsed = {
              ...v,
              isElementEqual: resolveElementEqualsFn(v as ArrayParameterSetting)
            }

            return [k, parsed as ParsedArrayParameterSetting];
          }

          return [k, v];
        })

      return Object.fromEntries(settings);
    });
  }

  get defaultValues(): Partial<Record<keyof T, unknown>> {
    return this.getFromCacheOrCreate('defaultValues', () => {

      if (!this.settings.parameterSettings) {
        return {};
      }

      const defaultValues = Object.fromEntries(
        Object.entries(this.settings.parameterSettings)
          .filter(([, v]) => v!.default !== undefined)
          .map(([k, v]) => [k, v!.default] as const)
      )

      const statefulParameterDefaultValues = Object.fromEntries(
        Object.entries(this.settings.parameterSettings)
          .filter(([, v]) => v?.type === 'stateful')
          .filter(([, v]) => (v as StatefulParameterSetting).definition.getSettings().default !== undefined)
          .map(([k, v]) => [k, (v as StatefulParameterSetting).definition.getSettings().default] as const)
      )

      return { ...defaultValues, ...statefulParameterDefaultValues } as Partial<Record<keyof T, unknown>>;
    });
  }

  get inputTransformations(): Partial<Record<keyof T, InputTransformation>> {
    return this.getFromCacheOrCreate('inputTransformations', () => {
      if (!this.settings.parameterSettings) {
        return {};
      }

      return Object.fromEntries(
        Object.entries(this.settings.parameterSettings)
          .filter(([_, v]) => resolveParameterTransformFn(v!) !== undefined)
          .map(([k, v]) => [k, resolveParameterTransformFn(v!)] as const)
      ) as Record<keyof T, InputTransformation>;
    });
  }

  get statefulParameterOrder(): Map<keyof T, number> {
    return this.getFromCacheOrCreate('stateParameterOrder', () => {

      const entries = Object.entries(this.settings.parameterSettings ?? {})
        .filter(([, v]) => v?.type === 'stateful')
        .map(([k, v]) => [k, v as StatefulParameterSetting] as const)

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
    // validate parameter settings
    if (this.settings.parameterSettings) {
      for (const [k, v] of Object.entries(this.settings.parameterSettings)) {
        if (!v) {
          throw new Error(`Resource: ${this.id}. Parameter setting ${k} was left undefined`);
        }

        this.validateParameterEqualsFn(v, k);
      }
    }

    if (Object.entries(this.parameterSettings).some(([k, v]) =>
      v.type === 'stateful'
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

  private validateParameterEqualsFn(parameter: ParameterSetting, key: string): void {
    if (parameter.type === 'stateful') {
      const nestedSettings = (parameter as StatefulParameterSetting).definition.getSettings();

      if (nestedSettings.type === 'stateful') {
        throw new Error(`Nested stateful parameters are not allowed for ${key}`);
      }

      this.validateParameterEqualsFn(nestedSettings, key);
    }

    // The rest of the types have defaults set already
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
