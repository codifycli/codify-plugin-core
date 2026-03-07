import { StringIndexedObject } from '@codifycli/schemas';

import { StatefulParameterController } from '../stateful-parameter/stateful-parameter-controller.js';

export class ConfigParser<T extends StringIndexedObject> {
  private readonly desiredConfig: Partial<T> | null;
  private readonly stateConfig: Partial<T> | null;
  private statefulParametersMap: Map<keyof T, StatefulParameterController<T, T[keyof T]>>;

  constructor(
    desiredConfig: Partial<T> | null,
    stateConfig: Partial<T> | null,
    statefulParameters: Map<keyof T, StatefulParameterController<T, T[keyof T]>>,
  ) {
    this.desiredConfig = desiredConfig;
    this.stateConfig = stateConfig
    this.statefulParametersMap = statefulParameters;
  }

  get allParameters(): Partial<T> {
    return { ...this.desiredConfig, ...this.stateConfig } as Partial<T>;
  }

  get allNonStatefulParameters(): Partial<T> {
    const {
      allParameters,
      statefulParametersMap,
    } = this;

    return Object.fromEntries(
      Object.entries(allParameters).filter(([key]) => !statefulParametersMap.has(key))
    ) as Partial<T>;
  }

  get allStatefulParameters(): Partial<T> {
    const { allParameters, statefulParametersMap } = this;

    return Object.fromEntries(
      Object.entries(allParameters).filter(([key]) => statefulParametersMap.has(key))
    ) as Partial<T>;
  }
}
