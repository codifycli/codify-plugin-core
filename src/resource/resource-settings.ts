import { LinuxDistro, OS, StringIndexedObject } from '@codifycli/schemas';
import { JSONSchemaType } from 'ajv';
import { ZodObject } from 'zod';

import { ArrayStatefulParameter, StatefulParameter } from '../stateful-parameter/stateful-parameter.js';
import { NestedConfigPath } from './parameter-paths.js';
import { ParsedResourceSettings } from './parsed-resource-settings.js';
import { RefreshContext } from './resource.js';

export interface ExampleConfig extends Record<string, unknown> {
  title: string;
  configs: Array<Record<string, unknown>>;
  description?: string;
}

export interface ExampleConfigs {
  example1?: ExampleConfig;
  example2?: ExampleConfig;
}

export interface InputTransformation {
  to: (input: any) => Promise<any> | any;
  from: (current: any, original: any) => Promise<any> | any;
}

/**
 * The configuration and settings for a resource.
 */
export interface ResourceSettings<T extends StringIndexedObject> {

  /**
   * The typeId of the resource.
   */
  id: string;

  /**
   * List of supported operating systems
   */
  operatingSystems: Array<OS>;

  /**
   * List of supported linux distros
   */
  linuxDistros?: Array<LinuxDistro>;

  /**
   * Schema to validate user configs with. Must be in the format JSON Schema draft07
   */
  schema?: Partial<JSONSchemaType<T | any>> | ZodObject;

  /**
   * Mark the resource as sensitive. Defaults to false. This prevents the resource from automatically being imported by init and import.
   * This differs from the parameter level sensitivity which also prevents the parameter value from being displayed in the plan.
   */
  isSensitive?: boolean;

  /**
   * An optional description of the resource. This does not affect the behavior of the resource.
   */
  description?: string;

  /**
   * Allow multiple of the same resource to unique. Set truthy if
   * multiples are allowed, for example for applications, there can be multiple copy of the same application installed
   * on the system. Or there can be multiple git repos. Defaults to false.
   */
  allowMultiple?: {

    /**
     * A set of parameters that uniquely identifies a resource. The value of these parameters is used to determine which
     * resource is which when multiple can exist at the same time. Defaults to the required parameters inside the json
     * schema.
     *
     * For example:
     * If paramA is required, then if resource1.paramA === resource2.paramA then are the same resource.
     * If resource1.paramA !== resource1.paramA, then they are different.
     */
    identifyingParameters?: string[];

    /**
     * If multiple copies are allowed then a matcher must be defined to match the desired
     * config with one of the resources currently existing on the system. Return null if there is no match.
     *
     * @param current An array of resources found installed on the system
     * @param desired The desired config to match.
     *
     * @return The matched resource.
     */
    matcher?: (desired: Partial<T>, current: Partial<T>) => boolean;

    /**
     * This method if supported by the resource returns an array of parameters that represent all of the possible
     * instances of a resource on the system. An example of this is for the git-repository resource, this method returns
     * a list of directories which are git repositories.
     */
    findAllParameters?: () => Promise<Array<Partial<T>>>
  } | boolean

  /**
   * If true, {@link StatefulParameter} remove() will be called before resource destruction. This is useful
   * if the stateful parameter needs to be first uninstalled (cleanup) before the overall resource can be
   * uninstalled. Defaults to false.
   */
  removeStatefulParametersBeforeDestroy?: boolean;

  /**
   * An array of type ids of resources that this resource depends on. This affects the order in which multiple resources are
   * planned and applied.
   */
  dependencies?: string[];

  /**
   * Options for configuring parameters operations including overriding the equals function, adding default values,
   * applying input transformations, marking values sensitive and attaching stateful parameters.
   *
   * Keys are top level parameter names or (only when a nested value needs a setting) typed paths into the config,
   * ex: `'envFiles[*].contents[*].value': { isSensitive: true }`. See {@link ParameterSettings}.
   */
  parameterSettings?: ParameterSettings<T>;

  /**
   * A config level transformation that is only applied to the user supplied desired config. This transformation is allowed
   * to add, remove or modify keys as well as values. Changing this transformation for existing libraries will mess up existing states.
   *
   * @param desired
   */
  transformation?: InputTransformation;

  /**
   * Customize the import and destory behavior of the resource. By default, <code>codify import</code> and <code>codify destroy</code> will call
   * `refresh()` with every parameter set to null and return the result of the refresh as the imported config. It looks for required parameters
   * in the schema and will prompt the user for these values before performing the import or destroy.
   *
   * <b>Example:</b><br>
   * Resource `alias` with parameters
   *
   * ```
   * { alias <b>(*required)</b>: string; value: string;  }
   * ```
   *
   * When the user calls `codify import alias`, they will first be prompted to enter the value for `alias`. Refresh
   * is then called with `refresh({ alias: 'user-input', value: null })`. The result returned to the user will then be:
   *
   * ```
   * { type: 'alias', alias: 'user-input', value: 'git push' }
   * ```
   */
  importAndDestroy?: {
    /**
     * Can this resources be imported? If set to false then the codifyCLI will skip over/not consider this
     * resource valid for imports. Defaults to false.
     *
     * Resources that can't be imported in the core library for example are: action resources
     *
     * Only use this for resources that truly can't be imported. If the resource conflicts with another resource during
     * import all (ex: `alias` and `aliases` manage the same state) use {@link supersededBy} instead.
     */
    preventImport?: boolean;

    /**
     * The type id of another resource that manages the same system state as this one, typically the plural version of
     * this resource (ex: `alias` is superseded by `aliases`, `git-repository` by `git-repositories`).
     *
     * When both resources are imported automatically (`codify init` / `codify import` with no arguments), this resource
     * is skipped so the same state isn't imported twice. It can still be imported directly (`codify import alias`),
     * planned, applied and destroyed, and its instances can still be discovered with
     * {@link allowMultiple.findAllParameters}.
     */
    supersededBy?: string;

    /**
     * Can this resources be destroyed? If set to false then the codifyCLI will skip over/not consider this
     * resource valid for destroys. Defaults to false.
     */
    preventDestroy?: boolean;

    /**
     * Customize the required parameters needed to import this resource. By default, the `requiredParameters` are taken
     * from the identifyingParameters for allowMultiple. The `requiredParameters` parameter must be declared if a complex required is declared in
     * the schema (contains `oneOf`, `anyOf`, `allOf`, `if`, `then`, `else`).
     * <br>
     * The user will be prompted for the required parameters before the import starts. This is done because for most resources
     * the required parameters change the behaviour of the refresh (for example for the `alias` resource, the `alias` parmaeter
     * chooses which alias the resource is managing).
     *
     * See {@link importAndDestroy} for more information on how importing works.
     */
    requiredParameters?: Array<Partial<keyof T>>;

    /**
     * Customize which keys will be refreshed in the import. Typically, `refresh()` statements only refresh
     * the parameters provided as the input. Use `refreshKeys` to control which parameter keys are passed in.
     * <br>
     * By default all parameters (except for {@link requiredParameters }) are passed in with the value `null`. The passed
     * in value can be customized using {@link defaultRefreshValues}
     *
     * See {@link importAndDestroy} for more information on how importing works.
     */
    refreshKeys?: Array<Partial<keyof T>>;

    /**
     * Customize the value that is passed into refresh when importing. This must only contain keys found in {@link refreshKeys}.
     *
     * See {@link importAndDestroy} for more information on how importing works.
     */
    defaultRefreshValues?: Partial<T>;

    /**
     * A custom function that maps the input to what gets passed to refresh for imports. If this is set, then refreshKeys and
     * defaultRefreshValues are ignored.
     *
     * @param input
     * @param context
     */
    refreshMapper?: (input: Partial<T>, context: RefreshContext<T>) => Partial<T>;
  }

  /**
   * Represents the default config that is added to the editor with prefilled properties. For some resources
   *
   * @type {Partial<T>}
   */
  defaultConfig?: Partial<T>

  /**
   * A collection of example configs used to give users an idea on how to use this specific resource. These examples
   * don't need to be limited to just the current resource. They can include other resources as well
   */
  exampleConfigs?: ExampleConfigs
}

/**
 * The type of a parameter value. This is mainly used to pick a pre-set equality method (and for some types an input
 * transformation) for comparing the current config with the desired config.
 *
 * When omitted, the type is inferred from the schema where possible (`string`, `number`, `boolean`, `array`, `object`).
 * Types that the schema can't express, such as `directory` and `version`, must be declared.
 */
export type ParameterSettingType =
  'any'
  | 'array'
  | 'boolean'
  | 'directory'
  | 'number'
  | 'object'
  | 'string'
  | 'version';

/**
 * Settings for a single parameter (or, using a nested path key, a value nested inside a parameter). Options for
 * configuring parameter operations including overriding the equals function, adding default values, applying input
 * transformations, marking values as sensitive and attaching stateful parameters.
 *
 * Settings marked *(top level only)* are only allowed on top level parameters. Nested paths (`a[*].b`, `a.*`) may use
 * {@link NestedParameterSetting} options only.
 */
export interface ParameterSetting extends NestedParameterSetting {
  /**
   * Default value for the parameter. If a value is not provided in the config, then this value will be used.
   * *(top level only)*
   */
  default?: unknown;

  /**
   * A transformation of the input value for this parameter. Two transformations need to be provided: to (from desired to
   * the internal type), and from (from the internal type back to desired). All transformations need to be bi-directional
   * to support imports properly. *(top level only)*
   */
  transformation?: InputTransformation;

  /**
   * Chose if the resource can be modified instead of re-created when there is a change to this parameter.
   * Defaults to false (re-create). Stateful parameters are always modified. *(top level only)*
   *
   * Examples:
   * 1. Settings like git user name and git user email that have setter calls and don't require the re-installation of git
   * 2. AWS profile secret keys that can be updated without the re-installation of AWS CLI
   */
  canModify?: boolean;

  /**
   * This option allows the plan to skip this parameter entirely as it is used for setting purposes only. The value
   * of this parameter is used to configure the resource or other parameters. *(top level only)*
   *
   * Examples:
   * 1. homebrew.onlyPlanUserInstalled option will tell homebrew to filter by --installed-on-request. But the value,
   * of the parameter itself (true or false) does not have an impact on the plan
   */
  setting?: boolean;

  /**
   * Attach a stateful parameter. A stateful parameter is a sub-resource that can hold its own state but is still tied
   * to the overall state of the resource. For example 'homebrew' is represented as a resource and taps, formulas and
   * casks are represented as stateful parameters. A formula can be installed, modified and removed (has state) but it
   * is still tied to the lifecycle of homebrew. *(top level only)*
   *
   * The stateful parameter's own `getSettings()` provides defaults; any option set here takes precedence.
   */
  stateful?: ArrayStatefulParameter<any, any> | StatefulParameter<any, any>;

  /**
   * The order multiple stateful parameters should be applied in. The order is applied in ascending order (1, 2, 3...).
   * *(top level only, stateful parameters only)*
   */
  order?: number;
}

/**
 * Settings that can be applied to nested values using a path key (ex: `'envFiles[*].contents[*].value'`) as well
 * as to top level parameters.
 */
export interface NestedParameterSetting {
  /**
   * The type of the value. See {@link ParameterSettingType} for the available options. Inferred from the schema when
   * omitted.
   */
  type?: ParameterSettingType;

  /**
   * Mark the value as sensitive. Defaults to false. This has two side effects:
   * 1. When displaying this value in the plan, it will be replaced with asterisks
   * 2. When importing, resources with sensitive values will be skipped unless the user explicitly allows it.
   *
   * On a nested path only the matching values are sensitive (ex: the `value` of every env entry, not the whole array).
   */
  isSensitive?: boolean;

  /**
   * Customize the equality comparison for this value. This is used in the diffing algorithm for generating the plan.
   * This value will override the pre-set equality function from the type and any nested settings. Return true if the
   * desired value is equivalent to the current value.
   */
  isEqual?: (desired: any, current: any) => boolean;

  /**
   * *(arrays only)* The type of the array elements. Shorthand for setting `type` on the `param[*]` path.
   */
  itemType?: ParameterSettingType;

  /**
   * *(arrays only)* An element level equality function. Arrays are compared ignoring order using this method. Shorthand
   * for setting `isEqual` on the `param[*]` path. Defaults to the element type's equality (or nested settings).
   */
  isElementEqual?: (desired: any, current: any) => boolean;

  /**
   * *(arrays of objects only)* The field (or fields) that identify an element, for example `'name'` for a list of
   * env files or `'alias'` for a list of aliases. Two elements with the same key are the same item, even if their other
   * fields differ.
   *
   * The key is used to filter the current array in stateless mode, so items on the system that aren't declared are
   * not removed and a changed item shows up as a modification instead of an addition.
   */
  key?: string | string[];

  /**
   * *(arrays and objects)* Filter the refreshed value by the desired value in stateless mode, so items currently on the
   * system but not declared don't show up in the plan. Defaults to true.
   *
   * - Arrays: elements are kept when they match a desired element (by {@link key} if set, otherwise by element equality).
   * - Objects: only the keys present in desired are kept.
   *
   * <b>For example, for the nvm resource:</b>
   * <ul>
   *   <li>Desired (20.18.0, 18.9.0, 16.3.1)</li>
   *   <li>Current (20.18.0, 22.1.3, 12.1.0)</li>
   * </ul>
   *
   * Without filtering the plan will be:
   * (~20.18.0, +18.9.0, +16.3.1, -22.1.3, -12.1.0)<br>
   * With filtering the plan is: (~20.18.0, +18.9.0, +16.3.1)
   *
   * Pass a function for custom filtering, or false to disable it.
   */
  filterInStatelessMode?: ((desired: any, current: any) => any) | boolean;
}

/**
 * Parameter settings for a resource config `T`. Keys are top level parameter names or nested paths into the config:
 *
 * ```ts
 * parameterSettings: {
 *   dir: { type: 'directory' },
 *   envFiles: { canModify: true, key: 'name' },
 *   'envFiles[*].contents': { key: 'key' },
 *   'envFiles[*].contents[*].value': { isSensitive: true },
 * }
 * ```
 */
export type ParameterSettings<T> =
  { [K in keyof T]?: ParameterSetting }
  & { [P in NestedConfigPath<T>]?: NestedParameterSetting };

export function resolveMatcher<T extends StringIndexedObject>(
  settings: ParsedResourceSettings<T>
): (desired: Partial<T>, current: Partial<T>) => boolean {
  return typeof settings.allowMultiple === 'boolean' || !settings.allowMultiple?.matcher
    ? ((desired: Partial<T>, current: Partial<T>) => {
      if (!desired || !current) {
        return false;
      }

      if (!settings.allowMultiple) {
        throw new Error(`Matching only works when allow multiple is enabled. Type: ${settings.id}`)
      }

      const requiredParameters = typeof settings.allowMultiple === 'object'
        ? settings.allowMultiple?.identifyingParameters ?? (settings.schema?.required as string[]) ?? []
        : (settings.schema?.required as string[]) ?? []

      return requiredParameters.every((key) => {
        const currentParameter = current[key];
        const desiredParameter = desired[key];

        // If both desired and current don't have a certain parameter then we assume they are the same
        if (!currentParameter && !desiredParameter) {
          return true;
        }

        if (!currentParameter) {
          console.warn(`Unable to find required parameter for current ${currentParameter}`)
          return false;
        }

        if (!desiredParameter) {
          console.warn(`Unable to find required parameter for current ${currentParameter}`)
          return false;
        }

        const isEq = settings.parameterSettings[key]?.isEqual;
        return isEq ? isEq(desiredParameter, currentParameter) : currentParameter === desiredParameter;
      })
    })
    : settings.allowMultiple.matcher
}
