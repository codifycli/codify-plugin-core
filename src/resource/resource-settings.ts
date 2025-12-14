import { JSONSchemaType } from 'ajv';
import { StringIndexedObject } from 'codify-schemas';
import isObjectsEqual from 'lodash.isequal'
import path from 'node:path';

import { ArrayStatefulParameter, StatefulParameter } from '../stateful-parameter/stateful-parameter.js';
import { addVariablesToPath, areArraysEqual, resolvePathWithVariables, tildify, untildify } from '../utils/utils.js';
import { RefreshContext } from './resource.js';

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
   * Schema to validate user configs with. Must be in the format JSON Schema draft07
   */
  schema?: Partial<JSONSchemaType<T | any>>;

  /**
   * Mark the resource as sensitive. Defaults to false. This prevents the resource from automatically being imported by init and import.
   * This differs from the parameter level sensitivity which also prevents the parameter value from being displayed in the plan.
   */
  isSensitive?: boolean;

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
   * Options for configuring parameters operations including overriding the equals function, adding default values
   * and applying any input transformations. Use parameter settings to define stateful parameters as well.
   */
  parameterSettings?: Partial<Record<keyof T, ParameterSetting>>;

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
     */
    preventImport?: boolean;

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
}

/**
 * The type of parameter. This value is mainly used to determine a pre-set equality method for comparing the current
 * config with desired config. Certain types will have additional options to help support it. For example the type
 * stateful requires a stateful parameter definition and type array takes an isElementEqual method.
 */
export type ParameterSettingType =
  'any'
  | 'array'
  | 'boolean'
  | 'directory'
  | 'number'
  | 'object'
  | 'setting'
  | 'stateful'
  | 'string'
  | 'version';

/**
 * Typing information for the parameter setting. This represents a setting on a specific parameter within a
 * resource. Options for configuring parameters operations including overriding the equals function, adding default values
 * and applying any input transformations. See {@link DefaultParameterSetting } for more information.
 * Use parameter settings to define stateful parameters as well.
 */

export type ParameterSetting =
  ArrayParameterSetting
  | DefaultParameterSetting
  | StatefulParameterSetting

/**
 * The parent class for parameter settings. The options are applicable to array parameter settings
 * as well.
 */
export interface DefaultParameterSetting {
  /**
   * The type of the value of this parameter. See {@link ParameterSettingType} for the available options. This value
   * is mainly used to determine the equality method when performing diffing.
   */
  type?: ParameterSettingType;

  /**
   * Mark the field as sensitive. Defaults to false. This has two side effects:
   * 1. When displaying this field in the plan, it will be replaced with asterisks
   * 2. When importing, resources with sensitive fields will be skipped unless the user explicitly allows it.
   */
  isSensitive?: boolean;

  /**
   * Default value for the parameter. If a value is not provided in the config, then this value will be used.
   */
  default?: unknown;

  /**
   * A transformation of the input value for this parameter. Two transformations need to be provided: to (from desired to
   * the internal type), and from (from the internal type back to desired). All transformations need to be bi-directional
   * to support imports properly
   *
   * @param input The original parameter value from the desired config.
   */
  transformation?: InputTransformation;

  /**
   * Customize the equality comparison for a parameter. This is used in the diffing algorithm for generating the plan.
   * This value will override the pre-set equality function from the type. Return true if the desired value is
   * equivalent to the current value.
   *
   * @param desired The desired value.
   * @param current The current value.
   *
   * @return Return true if equal
   */
  isEqual?: ((desired: any, current: any) => boolean) | ParameterSettingType;

  /**
   * Chose if the resource can be modified instead of re-created when there is a change to this parameter.
   * Defaults to false (re-create).
   *
   * Examples:
   * 1. Settings like git user name and git user email that have setter calls and don't require the re-installation of git
   * 2. AWS profile secret keys that can be updated without the re-installation of AWS CLI
   */
  canModify?: boolean

  /**
   * This option allows the plan to skip this parameter entirely as it is used for setting purposes only. The value
   * of this parameter is used to configure the resource or other parameters.
   *
   * Examples:
   * 1. homebrew.onlyPlanUserInstalled option will tell homebrew to filter by --installed-on-request. But the value,
   * of the parameter itself (true or false) does not have an impact on the plan
   */
  setting?: boolean
}

/**
 * Array type specific settings. See {@link DefaultParameterSetting } for a full list of options.
 */
export interface ArrayParameterSetting extends DefaultParameterSetting {
  type: 'array'

  /**
   * An element level equality function for arrays. The diffing algorithm will take isElementEqual and use it in a
   * O(n^2) equality comparison to determine if the overall array is equal. This value will override the pre-set equality
   * function for arrays (desired === current). Return true if the desired element is equivalent to the current element.
   *
   * @param desired An element of the desired array
   * @param current An element of the current array
   *
   * @return Return true if desired is equivalent to current.
   */
  isElementEqual?: ((desired: any, current: any) => boolean) | ParameterSettingType;

  /**
   * Filter the contents of the refreshed array by the desired. This way items currently on the system but not
   * in desired don't show up in the plan.
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
   * As you can see, filtering prevents items currently installed on the system from being removed.
   *
   * Defaults to true.
   */
  filterInStatelessMode?: ((desired: any[], current: any[]) => any[]) | boolean,

  /**
   * The type of the array item. See {@link ParameterSettingType} for the available options. This value
   * is mainly used to determine the equality method when performing diffing.
   */
  itemType?: ParameterSettingType,
}

/**
 * Stateful parameter type specific settings. A stateful parameter is a sub-resource that can hold its own
 * state but is still tied to the overall state of the resource. For example 'homebrew' is represented
 * as a resource and taps, formulas and casks are represented as a stateful parameter. A formula can be installed,
 * modified and removed (has state) but it is still tied to the overall lifecycle of homebrew.
 *
 */
export interface StatefulParameterSetting extends DefaultParameterSetting {
  type: 'stateful',

  /**
   * The stateful parameter definition. A stateful parameter is a sub-resource that can hold its own
   * state but is still tied to the overall state of the resource. For example 'homebrew' is represented
   * as a resource and taps, formulas and casks are represented as a stateful parameter. A formula can be installed,
   * modified and removed (has state) but it is still tied to the overall lifecycle of homebrew.
   */
  definition: ArrayStatefulParameter<any, unknown> | StatefulParameter<any, unknown>,

  /**
   * The order multiple stateful parameters should be applied in. The order is applied in ascending order (1, 2, 3...).
   */
  order?: number,
}

const ParameterEqualsDefaults: Partial<Record<ParameterSettingType, (a: unknown, b: unknown) => boolean>> = {
  'boolean': (a: unknown, b: unknown) => Boolean(a) === Boolean(b),
  'directory': (a: unknown, b: unknown) => {
    let transformedA = resolvePathWithVariables(untildify(String(a)))
    let transformedB = resolvePathWithVariables(untildify(String(b)))

    if (transformedA.startsWith('.')) { // Only relative paths start with '.'
      transformedA = path.resolve(transformedA)
    }

    if (transformedB.startsWith('.')) { // Only relative paths start with '.'
      transformedB = path.resolve(transformedB)
    }

    const notCaseSensitive = process.platform === 'darwin';
    if (notCaseSensitive) {
      transformedA = transformedA.toLowerCase();
      transformedB = transformedB.toLowerCase();
    }

    return transformedA === transformedB;
  },
  'number': (a: unknown, b: unknown) => Number(a) === Number(b),
  'string': (a: unknown, b: unknown) => String(a) === String(b),
  'version': (desired: unknown, current: unknown) => String(current).includes(String(desired)),
  'object': isObjectsEqual,
}

export function resolveEqualsFn(parameter: ParameterSetting): (desired: unknown, current: unknown) => boolean {
  // Setting parameters do not impact the plan
  if (parameter.setting) {
    return () => true;
  }

  const isEqual = resolveFnFromEqualsFnOrString(parameter.isEqual);

  if (parameter.type === 'array') {
    return isEqual ?? areArraysEqual.bind(areArraysEqual, resolveElementEqualsFn(parameter as ArrayParameterSetting))
  }

  if (parameter.type === 'stateful') {
    return resolveEqualsFn((parameter as StatefulParameterSetting).definition.getSettings())
  }

  return isEqual ?? ParameterEqualsDefaults[parameter.type as ParameterSettingType] ?? (((a, b) => a === b));
}

export function resolveElementEqualsFn(parameter: ArrayParameterSetting): (desired: unknown, current: unknown) => boolean {
  if (parameter.isElementEqual) {
    const elementEq = resolveFnFromEqualsFnOrString(parameter.isElementEqual);
    if (elementEq) {
      return elementEq;
    }
  }

  if (parameter.itemType && ParameterEqualsDefaults[parameter.itemType]) {
    return ParameterEqualsDefaults[parameter.itemType]!
  }

  return (a, b) => a === b;
}

// This resolves the fn if it is a string.
// A string can be specified to use a default equals method
export function resolveFnFromEqualsFnOrString(
  fnOrString: ((a: unknown, b: unknown) => boolean) | ParameterSettingType | undefined,
): ((a: unknown, b: unknown) => boolean) | undefined {

  if (fnOrString && typeof fnOrString === 'string') {
    if (!ParameterEqualsDefaults[fnOrString]) {
      throw new Error(`isEqual of type ${fnOrString} was not found`)
    }

    return ParameterEqualsDefaults[fnOrString]!
  }

  return fnOrString as ((a: unknown, b: unknown) => boolean) | undefined;
}

const ParameterTransformationDefaults: Partial<Record<ParameterSettingType, InputTransformation>> = {
  'directory': {
    to: (a: unknown) => resolvePathWithVariables((untildify(String(a)))),
    from: (a: unknown, original) => {
      if (ParameterEqualsDefaults.directory!(a, original)) {
        return original;
      }

      return tildify(addVariablesToPath(String(a)))
    },
  },
  'string': {
    to: String,
    from: String,
  },
  'boolean': {
    to: Boolean,
    from: Boolean,
  }
}

export function resolveParameterTransformFn(
  parameter: ParameterSetting
): InputTransformation | undefined {

  if (parameter.type === 'stateful' && !parameter.transformation) {
    const sp = (parameter as StatefulParameterSetting).definition.getSettings();
    if (sp.transformation) {
      return (parameter as StatefulParameterSetting).definition?.getSettings()?.transformation
    }

    return sp.type ? ParameterTransformationDefaults[sp.type] : undefined;
  }

  if (parameter.type === 'array'
    && (parameter as ArrayParameterSetting).itemType
    && ParameterTransformationDefaults[(parameter as ArrayParameterSetting).itemType!]
    && !parameter.transformation
  ) {
    const itemType = (parameter as ArrayParameterSetting).itemType!;
    const itemTransformation = ParameterTransformationDefaults[itemType]!;

    return {
      to(input: unknown[]) {
        return input.map((i) => itemTransformation.to(i))
      },
      from(input: unknown[], original) {
        return input.map((i, idx) => {
          const originalElement = Array.isArray(original)
            ? original.find((o) => resolveElementEqualsFn(parameter as ArrayParameterSetting)(o, i)) ?? original[idx]
            : original;

          return itemTransformation.from(i, originalElement);
        })
      }
    }
  }

  return parameter.transformation ?? ParameterTransformationDefaults[parameter.type as ParameterSettingType] ?? undefined;
}

export function resolveMatcher<T extends StringIndexedObject>(
  settings: ResourceSettings<T>
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

        const parameterSetting = settings.parameterSettings?.[key];
        const isEq = parameterSetting ? resolveEqualsFn(parameterSetting) : null
        return isEq?.(desiredParameter, currentParameter) ?? currentParameter === desiredParameter;
      })
    })
    : settings.allowMultiple.matcher
}
