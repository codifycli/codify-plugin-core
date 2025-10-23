import { Ajv, ValidateFunction } from 'ajv';
import cleanDeep from 'clean-deep';
import {
  ParameterOperation,
  ResourceConfig,
  ResourceJson,
  ResourceOperation,
  StringIndexedObject,
  ValidateResponseData
} from 'codify-schemas';

import { ParameterChange } from '../plan/change-set.js';
import { Plan } from '../plan/plan.js';
import { CreatePlan, DestroyPlan, ModifyPlan } from '../plan/plan-types.js';
import { ConfigParser } from './config-parser.js';
import { ParsedResourceSettings } from './parsed-resource-settings.js';
import { RefreshContext, Resource } from './resource.js';
import { ResourceSettings } from './resource-settings.js';

export class ResourceController<T extends StringIndexedObject> {
  readonly resource: Resource<T>
  readonly settings: ResourceSettings<T>
  readonly parsedSettings: ParsedResourceSettings<T>

  readonly typeId: string;
  readonly dependencies: string[];

  protected ajv?: Ajv;
  protected schemaValidator?: ValidateFunction;

  constructor(
    resource: Resource<T>,
  ) {
    this.resource = resource;
    this.settings = resource.getSettings();

    this.typeId = this.settings.id;
    this.dependencies = this.settings.dependencies ?? [];

    if (this.settings.schema) {
      this.ajv = new Ajv({
        allErrors: true,
        strict: true,
        strictRequired: false,
        allowUnionTypes: true
      })
      this.schemaValidator = this.ajv.compile(this.settings.schema);
    }

    this.parsedSettings = new ParsedResourceSettings<T>(this.settings);
  }

  async initialize(): Promise<void> {
    return this.resource.initialize();
  }

  async validate(
    core: ResourceConfig,
    parameters: Partial<T>,
  ): Promise<ValidateResponseData['resourceValidations'][0]> {
    const originalParameters = structuredClone(parameters);
    await this.applyTransformParameters(parameters);
    this.addDefaultValues(parameters);

    if (this.schemaValidator) {
      // Schema validator uses pre transformation parameters
      const isValid = this.schemaValidator(
        // @ts-expect-error Non esm package
        cleanDeep(originalParameters, {
          nullValues: true,
          undefinedValues: true,
          emptyArrays: false,
          emptyStrings: false,
          emptyObjects: false,
          NaNValues: false
        })
      );

      if (!isValid) {
        return {
          isValid: false,
          resourceName: core.name,
          resourceType: core.type,
          schemaValidationErrors: this.schemaValidator?.errors ?? [],
        }
      }
    }

    let isValid = true;
    let customValidationErrorMessage;
    try {
      await this.resource.validate(parameters);
    } catch (error) {
      isValid = false;
      customValidationErrorMessage = (error as Error).message;
    }

    if (!isValid) {
      return {
        customValidationErrorMessage,
        isValid: false,
        resourceName: core.name,
        resourceType: core.type,
        schemaValidationErrors: this.schemaValidator?.errors ?? [],
      }
    }

    return {
      isValid: true,
      resourceName: core.name,
      resourceType: core.type,
      schemaValidationErrors: [],
    }
  }

  async match(resource: ResourceJson, array: Array<ResourceJson>): Promise<ResourceJson | undefined> {
    if (resource.core.type !== this.typeId) {
      throw new Error(`Unknown type passed into match method: ${resource.core.type} for ${this.typeId}`);
    }

    if (!this.parsedSettings.allowMultiple) {
      return array.find((r) => r.core.type === resource.core.type)
    }


    const { name, type } = resource.core;
    const parameterMatcher = this.parsedSettings.matcher;

    for (const resourceToMatch of array) {
      if (type !== resourceToMatch.core.type) {
        return undefined;
      }

      // If the user specifies the same name for the resource and it's not auto-generated (a number) then it's the same resource
      if (name === resourceToMatch.core.name
        && name
        && Number.isInteger(Number.parseInt(name, 10))
      ) {
        return resourceToMatch;
      }

      const originalParams = structuredClone(resource.parameters) as Partial<T>;
      const paramsToMatch = structuredClone(resourceToMatch.parameters) as Partial<T>;

      this.addDefaultValues(originalParams);
      await this.applyTransformParameters(originalParams);

      this.addDefaultValues(paramsToMatch);
      await this.applyTransformParameters(paramsToMatch);

      const match = parameterMatcher(originalParams, paramsToMatch);
      if (match) {
        return resourceToMatch;
      }
    }
  }

  async plan(
    core: ResourceConfig,
    desired: Partial<T> | null,
    state: Partial<T> | null,
    isStateful = false,
    commandType = 'plan',
  ): Promise<Plan<T>> {
    this.validatePlanInputs(core, desired, state, isStateful);
    const context: RefreshContext<T> = {
      commandType: commandType as 'plan' | 'validationPlan',
      isStateful,
      originalDesiredConfig: structuredClone(desired),
    };

    this.addDefaultValues(desired);
    await this.applyTransformParameters(desired);

    this.addDefaultValues(state);
    await this.applyTransformParameters(state);

    // Parse data from the user supplied config
    const parsedConfig = new ConfigParser(desired, state, this.parsedSettings.statefulParameters)
    const {
      allParameters,
      allNonStatefulParameters,
      allStatefulParameters,
    } = parsedConfig;

    // Refresh resource parameters. This refreshes the parameters that configure the resource itself
    const currentArray = await this.refreshNonStatefulParameters(allNonStatefulParameters, context);

    // Short circuit here. If the resource is non-existent, there's no point checking stateful parameters
    if (currentArray === null
      || currentArray === undefined
      || currentArray.length === 0
      || currentArray.filter(Boolean).length === 0
    ) {
      return Plan.calculate({
        desired,
        currentArray,
        state,
        core,
        settings: this.parsedSettings,
        isStateful,
      });
    }

    // Refresh stateful parameters. These parameters have state external to the resource. Each variation of the
    // current parameters (each array element) is passed into the stateful parameter refresh.
    const statefulCurrentParameters = await this.refreshStatefulParameters(allStatefulParameters, currentArray, allParameters);

    return Plan.calculate({
      desired,
      currentArray: currentArray.map((c, idx) => ({ ...c, ...statefulCurrentParameters[idx] })),
      state,
      core,
      settings: this.parsedSettings,
      isStateful
    })
  }

  async planDestroy(
    core: ResourceConfig,
    parameters: Partial<T>
  ): Promise<Plan<T>> {
    this.addDefaultValues(parameters);
    await this.applyTransformParameters(parameters);

    // Use refresh parameters if specified, otherwise try to refresh as many parameters as possible here
    const parametersToRefresh = this.settings.importAndDestroy?.refreshKeys
      ? {
        ...Object.fromEntries(
          this.settings.importAndDestroy?.refreshKeys.map((k) => [k, null])
        ),
        ...this.settings.importAndDestroy?.defaultRefreshValues,
        ...parameters,
      }
      : {
        ...Object.fromEntries(
          this.getAllParameterKeys().map((k) => [k, null])
        ),
        ...this.settings.importAndDestroy?.defaultRefreshValues,
        ...parameters,
      };

    return this.plan(core, null, parametersToRefresh, true);
  }

  async apply(plan: Plan<T>): Promise<void> {
    if (plan.getResourceType() !== this.typeId) {
      throw new Error(`Internal error: Plan set to wrong resource during apply. Expected ${this.typeId} but got: ${plan.getResourceType()}`);
    }

    switch (plan.changeSet.operation) {
      case ResourceOperation.CREATE: {
        return this.applyCreate(plan);
      }

      case ResourceOperation.MODIFY: {
        return this.applyModify(plan);
      }

      case ResourceOperation.RECREATE: {
        await this.applyDestroy(plan);
        return this.applyCreate(plan);
      }

      case ResourceOperation.DESTROY: {
        return this.applyDestroy(plan);
      }
    }
  }

  async import(
    core: ResourceConfig,
    parameters: Partial<T>,
    autoSearchAll = false,
  ): Promise<Array<ResourceJson> | null> {
    if (this.settings.importAndDestroy?.preventImport) {
      throw new Error(`Type: ${this.typeId} cannot be imported`);
    }

    const context: RefreshContext<T> = {
      commandType: 'import',
      isStateful: true,
      originalDesiredConfig: structuredClone(parameters),
    };

    // Auto search means that no required parameters will be provided. We will try to generate it ourselves or return an
    // empty array if they can't be.
    if (autoSearchAll && this.settings.allowMultiple) {
      if (this.settings.allowMultiple === true || !this.settings.allowMultiple.findAllParameters?.()) {
        return [];
      }

      const parametersToImport = await this.settings.allowMultiple.findAllParameters?.();
      const results = await Promise.all(parametersToImport.map((p) =>
        this.import(core, p).catch(() => null))
      );
      return results.filter(Boolean).flat() as ResourceJson[];
    }

    this.addDefaultValues(parameters);
    await this.applyTransformParameters(parameters);

    // Use refresh parameters if specified, otherwise try to refresh as many parameters as possible here
    const parametersToRefresh = this.getParametersToRefreshForImport(parameters, context);

    // Parse data from the user supplied config
    const parsedConfig = new ConfigParser(parametersToRefresh, null, this.parsedSettings.statefulParameters)
    const {
      allParameters,
      allNonStatefulParameters,
      allStatefulParameters,
    } = parsedConfig;

    const currentParametersArray = await this.refreshNonStatefulParameters(allNonStatefulParameters, context);

    if (currentParametersArray === null
      || currentParametersArray === undefined
      || currentParametersArray.filter(Boolean).length === 0
    ) {
      return [];
    }

    const statefulCurrentParameters = await this.refreshStatefulParameters(allStatefulParameters, currentParametersArray, allParameters);
    const resultParametersArray = currentParametersArray
      ?.map((r, idx) => ({ ...r, ...statefulCurrentParameters[idx] }))

    for (const result of resultParametersArray) {
      await this.applyTransformParameters(result, { original: context.originalDesiredConfig });
      this.removeDefaultValues(result, parameters);
    }

    return resultParametersArray?.map((r) => ({ core, parameters: r }))
  }

  private async applyCreate(plan: Plan<T>): Promise<void> {
    await this.resource.create(plan as CreatePlan<T>);

    const statefulParameterChanges = this.getSortedStatefulParameterChanges(plan.changeSet.parameterChanges)

    for (const parameterChange of statefulParameterChanges) {
      const statefulParameter = this.parsedSettings.statefulParameters.get(parameterChange.name)!;
      await statefulParameter.add(parameterChange.newValue, plan);
    }
  }

  private async applyModify(plan: Plan<T>): Promise<void> {
    const parameterChanges = plan
      .changeSet
      .parameterChanges
      .filter((c: ParameterChange<T>) => c.operation !== ParameterOperation.NOOP);

    const statelessParameterChanges = parameterChanges
      .filter((pc: ParameterChange<T>) => !this.parsedSettings.statefulParameters.has(pc.name))

    for (const pc of statelessParameterChanges) {
      await this.resource.modify(pc, plan as ModifyPlan<T>);
    }

    const statefulParameterChanges = this.getSortedStatefulParameterChanges(plan.changeSet.parameterChanges)

    for (const parameterChange of statefulParameterChanges) {
      const statefulParameter = this.parsedSettings.statefulParameters.get(parameterChange.name)!;

      switch (parameterChange.operation) {
        case ParameterOperation.ADD: {
          await statefulParameter.add(parameterChange.newValue, plan);
          break;
        }

        case ParameterOperation.MODIFY: {
          await statefulParameter.modify(parameterChange.newValue, parameterChange.previousValue, plan);
          break;
        }

        case ParameterOperation.REMOVE: {
          await statefulParameter.remove(parameterChange.previousValue, plan);
          break;
        }
      }
    }
  }

  private async applyDestroy(plan: Plan<T>): Promise<void> {
    // If this option is set (defaults to false), then stateful parameters need to be destroyed
    // as well. This means that the stateful parameter wouldn't have been normally destroyed with applyDestroy()
    if (this.settings.removeStatefulParametersBeforeDestroy) {
      const statefulParameterChanges = this.getSortedStatefulParameterChanges(plan.changeSet.parameterChanges)

      for (const parameterChange of statefulParameterChanges) {
        const statefulParameter = this.parsedSettings.statefulParameters.get(parameterChange.name)!;
        await statefulParameter.remove(parameterChange.previousValue, plan);
      }
    }

    await this.resource.destroy(plan as DestroyPlan<T>);
  }

  private validateRefreshResults(refresh: Array<Partial<T>> | null) {
    if (!refresh) {
      return;
    }

    if (!this.settings.allowMultiple && refresh.length > 1) {
      throw new Error(`Resource: ${this.settings.id}. Allow multiple was set to false but multiple refresh results were returned.

${JSON.stringify(refresh, null, 2)}     
`)
    }
  }

  private async applyTransformParameters(config: Partial<T> | null, reverse?: {
    original: Partial<T> | null
  }): Promise<void> {
    if (!config) {
      return;
    }

    for (const [key, inputTransformation] of Object.entries(this.parsedSettings.inputTransformations)) {
      if (config[key] === undefined || !inputTransformation) {
        continue;
      }

      (config as Record<string, unknown>)[key] = reverse
        ? await inputTransformation.from(config[key], reverse.original?.[key])
        : await inputTransformation.to(config[key]);
    }

    if (this.settings.transformation) {
      const transformed = reverse
        ? await this.settings.transformation.from({ ...config }, reverse.original)
        : await this.settings.transformation.to({ ...config })

      Object.keys(config).forEach((k) => delete config[k])
      Object.assign(config, transformed);
    }
  }

  private addDefaultValues(config: Partial<T> | null): void {
    if (!config) {
      return;
    }

    for (const [key, defaultValue] of Object.entries(this.parsedSettings.defaultValues)) {
      if (defaultValue !== undefined && (config[key] === undefined || config[key] === null)) {
        (config as Record<string, unknown>)[key] = defaultValue;
      }
    }
  }

  private removeDefaultValues(newConfig: Partial<T> | null, originalConfig: Partial<T>): void {
    if (!newConfig) {
      return;
    }

    for (const [key, defaultValue] of Object.entries(this.parsedSettings.defaultValues)) {
      if (defaultValue !== undefined && (newConfig[key] === defaultValue || originalConfig[key] === undefined || originalConfig[key] === null)) {
        delete newConfig[key];
      }
    }

  }

  private async refreshNonStatefulParameters(resourceParameters: Partial<T>, context: RefreshContext<T>): Promise<Array<Partial<T>> | null> {
    const result = await this.resource.refresh(resourceParameters, context);

    const currentParametersArray = Array.isArray(result) || result === null
      ? result
      : [result]

    this.validateRefreshResults(currentParametersArray);
    return currentParametersArray;
  }

  // Refresh stateful parameters
  // This refreshes parameters that are stateful (they can be added, deleted separately from the resource)
  private async refreshStatefulParameters(
    statefulParametersConfig: Partial<T>,
    currentArray: Array<Partial<T>>,
    allParameters: Partial<T>
  ): Promise<Array<Partial<T>>> {
    const result: Array<Partial<T>> = Array.from({ length: currentArray.length }, () => ({}))
    const sortedEntries = Object.entries(statefulParametersConfig)
      .sort(
        ([key1], [key2]) => this.parsedSettings.statefulParameterOrder.get(key1)! - this.parsedSettings.statefulParameterOrder.get(key2)!
      )

    for (const [idx, refreshedParams] of currentArray.entries()) {
      await Promise.all(sortedEntries.map(async ([key, desiredValue]) => {
        const statefulParameter = this.parsedSettings.statefulParameters.get(key);
        if (!statefulParameter) {
          throw new Error(`Stateful parameter ${key} was not found`);
        }

        (result[idx][key] as T[keyof T] | null) = await statefulParameter.refresh(desiredValue ?? null, { ...allParameters, ...refreshedParams })
      }))
    }

    return result;
  }

  private validatePlanInputs(
    core: ResourceConfig,
    desired: Partial<T> | null,
    current: Partial<T> | null,
    isStateful: boolean,
  ) {
    if (!core || !core.type) {
      throw new Error('Core parameters type must be defined');
    }

    if (!desired && !current) {
      throw new Error('Desired config and current config cannot both be missing')
    }

    if (!isStateful && !desired) {
      throw new Error('Desired config must be provided in non-stateful mode')
    }
  }

  private getSortedStatefulParameterChanges(parameterChanges: ParameterChange<T>[]) {
    return parameterChanges
      .filter((pc: ParameterChange<T>) => this.parsedSettings.statefulParameters.has(pc.name))
      .sort((a, b) =>
        this.parsedSettings.statefulParameterOrder.get(a.name)! - this.parsedSettings.statefulParameterOrder.get(b.name)!
      )
  }

  private getAllParameterKeys(): string[] {
    return this.settings.schema
      ? Object.keys((this.settings.schema as any)?.properties)
      : Object.keys(this.parsedSettings.parameterSettings);
  }

  private getParametersToRefreshForImport(parameters: Partial<T>, context: RefreshContext<T>): Partial<T> {
    if (this.settings.importAndDestroy?.refreshMapper) {
      return this.settings.importAndDestroy?.refreshMapper(parameters, context);
    }

    return this.settings.importAndDestroy?.refreshKeys
      ? {
        ...Object.fromEntries(
          this.settings.importAndDestroy?.refreshKeys.map((k) => [k, null])
        ),
        ...this.settings.importAndDestroy?.defaultRefreshValues,
        ...parameters,
        ...(Object.fromEntries( // If a default value was used, but it was also declared in the defaultRefreshValues, prefer the defaultRefreshValue instead
          Object.entries(parameters).filter(([k, v]) =>
            this.parsedSettings.defaultValues[k] !== undefined
            && v === this.parsedSettings.defaultValues[k]
            && context.originalDesiredConfig?.[k] === undefined
            && this.settings.importAndDestroy?.defaultRefreshValues?.[k] !== undefined
          ).map(([k]) => [k, this.settings.importAndDestroy!.defaultRefreshValues![k]])
        ))
      }
      : {
        ...Object.fromEntries(
          this.getAllParameterKeys().map((k) => [k, null])
        ),
        ...this.settings.importAndDestroy?.defaultRefreshValues,
        ...parameters,
      };
  }
}

