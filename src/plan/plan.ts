import {
  ApplyRequestData,
  ParameterOperation,
  PlanResponseData,
  ResourceConfig,
  ResourceOperation,
  StringIndexedObject,
} from 'codify-schemas';
import { v4 as uuidV4 } from 'uuid';

import {
  ParsedArrayParameterSetting,
  ParsedResourceSettings,
  ParsedStatefulParameterSetting
} from '../resource/parsed-resource-settings.js';
import { ArrayParameterSetting, ResourceSettings } from '../resource/resource-settings.js';
import { ChangeSet } from './change-set.js';

/**
 * A plan represents a set of actions that after taken will turn the current resource into the desired one.
 * A plan consists of list of parameter level changes (ADD, REMOVE, MODIFY or NO-OP) as well as a resource level
 * operation (CREATE, DESTROY, MODIFY, RE-CREATE, NO-OP).
 */
export class Plan<T extends StringIndexedObject> {
  id: string;

  /**
   * List of changes to make
   */
  changeSet: ChangeSet<T>;

  /**
   * Ex: name, type, dependsOn etc. Metadata parameters
   */
  coreParameters: ResourceConfig;

  isStateful: boolean;

  constructor(id: string, changeSet: ChangeSet<T>, coreParameters: ResourceConfig, isStateful: boolean) {
    this.id = id;
    this.changeSet = changeSet;
    this.coreParameters = coreParameters;
    this.isStateful = isStateful;
  }

  /**
   * The desired config that a plan will achieve after executing all the actions.
   */
  get desiredConfig(): T | null {
    if (this.changeSet.operation === ResourceOperation.DESTROY) {
      return null;
    }

    return this.changeSet.desiredParameters;
  }

  /**
   * The current config that the plan is changing.
   */
  get currentConfig(): T | null {
    if (this.changeSet.operation === ResourceOperation.CREATE) {
      return null;
    }

    return this.changeSet.currentParameters;
  }

  get resourceId(): string {
    return this.coreParameters.name
      ? `${this.coreParameters.type}.${this.coreParameters.name}`
      : this.coreParameters.type;
  }

  static calculate<T extends StringIndexedObject>(params: {
    desired: Partial<T> | null,
    currentArray: Partial<T>[] | null,
    state: Partial<T> | null,
    core: ResourceConfig,
    settings: ParsedResourceSettings<T>,
    isStateful: boolean,
  }): Plan<T> {
    const {
      desired,
      currentArray,
      state,
      core,
      settings,
      isStateful
    } = params

    const current = Plan.matchCurrentParameters<T>({
      desired,
      currentArray,
      state,
      settings,
      isStateful
    });

    const filteredCurrentParameters = Plan.filterCurrentParams<T>({
      desired,
      current,
      state,
      settings,
      isStateful
    });

    // Empty
    if (!filteredCurrentParameters && !desired) {
      return new Plan(
        uuidV4(),
        ChangeSet.empty<T>(),
        core,
        isStateful,
      )
    }

    // CREATE
    if (!filteredCurrentParameters && desired) {
      return new Plan(
        uuidV4(),
        ChangeSet.create(desired, settings),
        core,
        isStateful,
      )
    }

    // DESTROY
    if (filteredCurrentParameters && !desired) {
      // We can manually override destroys. If a resource cannot be destroyed (for instance the npm resource relies on NodeJS being created and destroyed)
      if (!settings.canDestroy) {
        return new Plan(
          uuidV4(),
          ChangeSet.noop(filteredCurrentParameters, settings),
          core,
          isStateful,
        )
      }

      return new Plan(
        uuidV4(),
        ChangeSet.destroy(filteredCurrentParameters, settings),
        core,
        isStateful,
      )
    }

    // NO-OP, MODIFY or RE-CREATE
    const changeSet = ChangeSet.calculateModification(
      desired!,
      filteredCurrentParameters!,
      settings.parameterSettings,
    );

    return new Plan(
      uuidV4(),
      changeSet,
      core,
      isStateful,
    );
  }

  //   2. Even if there was (maybe for testing reasons), the plan values should not be adjusted
  static fromResponse<T extends ResourceConfig>(data: ApplyRequestData['plan'], defaultValues?: Partial<Record<keyof T, unknown>>): Plan<T> {
    if (!data) {
      throw new Error('Data is empty');
    }

    addDefaultValues();

    return new Plan(
      uuidV4(),
      new ChangeSet<T>(
        data.operation,
        data.parameters.map((p) => ({
          ...p,
          isSensitive: p.isSensitive ?? false,
        })),
      ),
      {
        type: data.resourceType,
        name: data.resourceName,
      },
      data.isStateful
    );

   function addDefaultValues(): void {
      Object.entries(defaultValues ?? {})
        .forEach(([key, defaultValue]) => {
          const configValueExists = data!
            .parameters
            .some((p) => p.name === key);

          // Only set default values if the value does not exist in the config
          if (configValueExists) {
            return;
          }

          switch (data!.operation) {
            case ResourceOperation.CREATE: {
              data!.parameters.push({
                name: key,
                operation: ParameterOperation.ADD,
                previousValue: null,
                newValue: defaultValue,
              });
              break;
            }

            case ResourceOperation.DESTROY: {
              data!.parameters.push({
                name: key,
                operation: ParameterOperation.REMOVE,
                previousValue: defaultValue,
                newValue: null,
              });
              break;
            }

            case ResourceOperation.MODIFY:
            case ResourceOperation.RECREATE:
            case ResourceOperation.NOOP: {
              data!.parameters.push({
                name: key,
                operation: ParameterOperation.NOOP,
                previousValue: defaultValue,
                newValue: defaultValue,
              });
              break;
            }
          }
        });
    }

  }

  /**
   * The type (id) of the resource
   *
   * @return string
   */
  getResourceType(): string {
    return this.coreParameters.type
  }

  /**
   * When multiples of the same resource are allowed, this matching function will match a given config with one of the
   * existing configs on the system. For example if there are multiple versions of Android Studios installed, we can use
   * the application name and location to match it to our desired configs name and location.
   *
   * @param params
   * @private
   */
  private static matchCurrentParameters<T extends StringIndexedObject>(params: {
    desired: Partial<T> | null,
    currentArray: Partial<T>[] | null,
    state: Partial<T> | null,
    settings: ParsedResourceSettings<T>,
    isStateful: boolean,
  }): Partial<T> | null {
    const {
      desired,
      currentArray,
      state,
      settings,
      isStateful
    } = params;

    if (!settings.allowMultiple) {
      return currentArray?.[0] ?? null;
    }

    if (!currentArray) {
      return null;
    }

    const { matcher: parameterMatcher, id } = settings;
    const matcher = (desired: Partial<T>, currentArray: Partial<T>[]): Partial<T> | undefined => {
      const matched = currentArray.filter((c) => parameterMatcher(desired, c))
      if (matched.length > 1) {
        console.log(`Resource: ${id} did not uniquely match resources when allow multiple is set to true`)
      }

      return matched[0];
    }

    if (isStateful) {
      return state
        ? matcher(state, currentArray) ?? null
        : null
    }

    return matcher(desired!, currentArray) ?? null;
  }

  /**
   *  Only keep relevant params for the plan. We don't want to change settings that were not already
   *  defined.
   *
   *  1. In stateless mode, filter current by desired. We only want to know about settings that the user has specified
   *  2. In stateful mode, filter current by state and desired. We only know about the settings the user has previously set
   *  or wants to set. If a parameter is not specified then it's not managed by Codify.
   */
  private static filterCurrentParams<T extends StringIndexedObject>(params: {
    desired: Partial<T> | null,
    current: Partial<T> | null,
    state: Partial<T> | null,
    settings: ResourceSettings<T>,
    isStateful: boolean,
  }): Partial<T> | null {
    const {
      desired,
      current,
      state,
      settings,
      isStateful
    } = params;

    if (!current) {
      return null;
    }

    const filteredCurrent = filterCurrent()
    if (!filteredCurrent) {
      return null
    }

    // For stateful mode, we're done after filtering by the keys of desired + state. Stateless mode
    // requires additional filtering for stateful parameter arrays and objects.
    if (isStateful && desired) {
      return filteredCurrent;
    }

    // We also want to filter parameters when in delete mode. We don't want to delete parameters that
    // are not specified in the original config.
    if (isStateful && !desired) {
      const arrayStatefulParameters = Object.fromEntries(
        Object.entries(filteredCurrent)
          .filter(([k, v]) => isArrayParameterWithFiltering(k, v))
          .map(([k, v]) => [k, filterArrayParameterForDeletes(k, v)])
      )

      return { ...filteredCurrent, ...arrayStatefulParameters }
    }

    // TODO: Add object handling here in addition to arrays in the future
    const arrayStatefulParameters = Object.fromEntries(
      Object.entries(filteredCurrent)
        .filter(([k, v]) => isArrayParameterWithFiltering(k, v))
        .map(([k, v]) => [k, filterArrayParameterForStatelessMode(k, v)])
    )

    return { ...filteredCurrent, ...arrayStatefulParameters }

    function filterCurrent(): Partial<T> | null {
      if (!current) {
        return null;
      }

      if (isStateful) {
        const keys = new Set([...Object.keys(state ?? {}), ...Object.keys(desired ?? {})]);
        return Object.fromEntries(
          Object.entries(current)
            .filter(([k]) => keys.has(k))
        ) as Partial<T>;
      }

      // Stateless mode
      const keys = new Set(Object.keys(desired ?? {}));
      return Object.fromEntries(
        Object.entries(current)
          .filter(([k]) => keys.has(k))
      ) as Partial<T>;
    }

    function getFilterParameter(k: string): ((desired: any[], current: any[]) => any[]) | boolean | undefined {
      if (settings.parameterSettings?.[k]?.type === 'stateful') {
        const statefulSetting = settings.parameterSettings[k] as ParsedStatefulParameterSetting;

        if (statefulSetting.nestedSettings.type === 'array') {
          return (statefulSetting.nestedSettings as ArrayParameterSetting).filterInStatelessMode
        }
      }

      if (settings.parameterSettings?.[k]?.type === 'array') {
        return (settings.parameterSettings?.[k] as ArrayParameterSetting).filterInStatelessMode;
      }

      return undefined;
    }

    function isArrayParameterWithFiltering(k: string, v: T[keyof T]): boolean {
      const filterParameter = getFilterParameter(k);

      if (settings.parameterSettings?.[k]?.type === 'stateful') {
        const statefulSetting = settings.parameterSettings[k] as ParsedStatefulParameterSetting;
        return statefulSetting.nestedSettings.type === 'array' &&
          (filterParameter ?? true)
          && Array.isArray(v);
      }

      return settings.parameterSettings?.[k]?.type === 'array'
        && (filterParameter ?? true)
        && Array.isArray(v);
    }

    // For stateless mode, we must filter the current array so that the diff algorithm will not detect any deletes
    function filterArrayParameterForStatelessMode(k: string, v: unknown[]): unknown[] {
      const desiredArray = desired![k] as unknown[];
      const matcher = settings.parameterSettings![k]!.type === 'stateful'
        ? ((settings.parameterSettings![k] as ParsedStatefulParameterSetting)
          .nestedSettings as ParsedArrayParameterSetting)
          .isElementEqual
        : (settings.parameterSettings![k] as ParsedArrayParameterSetting)
          .isElementEqual

      const desiredCopy = [...desiredArray];
      const currentCopy = [...v];

      const defaultFilterMethod = ((desired: any[], current: any[]) => {
        const result = [];

        for (let counter = desired.length - 1; counter >= 0; counter--) {
          const idx = currentCopy.findIndex((e2) => matcher(desired[counter], e2))

          if (idx === -1) {
            continue;
          }

          desired.splice(counter, 1)
          const [element] = current.splice(idx, 1)
          result.push(element)
        }

        return result;
      })

      const filterParameter = getFilterParameter(k);
      return typeof filterParameter === 'function'
        ? filterParameter(desiredCopy, currentCopy)
        : defaultFilterMethod(desiredCopy, currentCopy);
    }

    function filterArrayParameterForDeletes(k: string, v: unknown[]): unknown[] {
      const stateArray = state![k] as unknown[];
      const matcher = settings.parameterSettings![k]!.type === 'stateful'
        ? ((settings.parameterSettings![k] as ParsedStatefulParameterSetting)
          .nestedSettings as ParsedArrayParameterSetting)
          .isElementEqual
        : (settings.parameterSettings![k] as ParsedArrayParameterSetting)
          .isElementEqual

      const stateCopy = [...stateArray];
      const currentCopy = [...v];

      const defaultFilterMethod = ((state: any[], current: any[]) => {
        const result = [];

        for (let counter = state.length - 1; counter >= 0; counter--) {
          const idx = currentCopy.findIndex((e2) => matcher(state[counter], e2))

          if (idx === -1) {
            continue;
          }

          state.splice(counter, 1)
          const [element] = current.splice(idx, 1)
          result.push(element)
        }

        return result;
      })


      const filterParameter = getFilterParameter(k);
      return typeof filterParameter === 'function'
        ? filterParameter(stateCopy, currentCopy)
        : defaultFilterMethod(stateCopy, currentCopy);
    }
  }

  // TODO: This needs to be revisited. I don't think this is valid anymore.
  //   1. For all scenarios, there shouldn't be an apply without a plan beforehand

  requiresChanges(): boolean {
    return this.changeSet.operation !== ResourceOperation.NOOP;
  }

  /** Convert the plan to a JSON response object */
  toResponse(): PlanResponseData {
    return {
      planId: this.id,
      operation: this.changeSet.operation,
      isStateful: this.isStateful,
      resourceName: this.coreParameters.name,
      resourceType: this.coreParameters.type,
      parameters: this.changeSet.parameterChanges,
    }
  }
}
