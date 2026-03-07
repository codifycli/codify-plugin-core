import { StringIndexedObject } from '@codifycli/schemas';

import { Plan } from '../plan/plan.js';
import { ParsedArrayParameterSetting, ParsedParameterSetting, } from '../resource/parsed-resource-settings.js';
import {
  ArrayParameterSetting,
  ParameterSetting,
  resolveElementEqualsFn,
  resolveEqualsFn,
} from '../resource/resource-settings.js';
import { ArrayStatefulParameter, StatefulParameter } from './stateful-parameter.js';

/**
 * This class is analogous to what {@link ResourceController} is for {@link Resource}
 * It's a bit messy because this class supports both {@link StatefulParameter} and {@link ArrayStatefulParameter}
 */
export class StatefulParameterController<T extends StringIndexedObject, V extends T[keyof T]> {
  readonly sp: ArrayStatefulParameter<T, V> | StatefulParameter<T, V>
  readonly settings: ParameterSetting;
  readonly parsedSettings: ParsedParameterSetting

  private readonly isArrayStatefulParameter: boolean;

  constructor(
    statefulParameter: ArrayStatefulParameter<T, V> | StatefulParameter<T, V>
  ) {
    this.sp = statefulParameter;
    this.settings = statefulParameter.getSettings();
    this.isArrayStatefulParameter = this.calculateIsArrayStatefulParameter();

    this.parsedSettings = (this.isArrayStatefulParameter || this.settings.type === 'array') ? {
      ...this.settings,
      isEqual: resolveEqualsFn(this.settings),
      isElementEqual: resolveElementEqualsFn(this.settings as ArrayParameterSetting)
    } as ParsedParameterSetting : {
      ...this.settings,
      isEqual: resolveEqualsFn(this.settings),
    };
  }

  async refresh(desired: V | null, config: Partial<T>): Promise<V | null> {
    return await this.sp.refresh(desired as any, config) as V | null;
  }

  async add(valueToAdd: V, plan: Plan<T>): Promise<void> {
    if (!this.isArrayStatefulParameter) {
      const sp = this.sp as StatefulParameter<T, V>;
      return sp.add(valueToAdd, plan);
    }

    const sp = this.sp as ArrayStatefulParameter<any, any>;
    const valuesToAdd = valueToAdd as Array<any>;
    for (const value of valuesToAdd) {
      await sp.addItem(value, plan);
    }
  }

  async modify(newValue: V, previousValue: V, plan: Plan<T>): Promise<void> {
    if (!this.isArrayStatefulParameter) {
      const sp = this.sp as StatefulParameter<T, V>;
      return sp.modify(newValue, previousValue, plan);
    }

    const sp = this.sp as ArrayStatefulParameter<any, any>;
    const settings = this.parsedSettings as ParsedArrayParameterSetting;
    const newValues = newValue as Array<unknown>[];
    const previousValues = previousValue as Array<unknown>[];

    // TODO: I don't think this works with duplicate elements. Solve at another time
    const valuesToAdd = newValues.filter((n) => !previousValues.some((p) => {
      if (settings.isElementEqual) {
        return settings.isElementEqual!(n, p);
      }

      return n === p;
    }));

    const valuesToRemove = previousValues.filter((p) => !newValues.some((n) => {
      if (settings.isElementEqual) {
        return settings.isElementEqual!(n, p);
      }

      return n === p;
    }));

    for (const value of valuesToAdd) {
      await sp.addItem(value, plan)
    }

    for (const value of valuesToRemove) {
      await sp.removeItem(value, plan)
    }
  }

  async remove(valueToRemove: V, plan: Plan<T>): Promise<void> {
    if (!this.isArrayStatefulParameter) {
      const sp = this.sp as StatefulParameter<T, V>;
      return sp.remove(valueToRemove, plan);
    }

    const sp = this.sp as ArrayStatefulParameter<any, any>;
    const valuesToRemove = valueToRemove as Array<any>;
    for (const value of valuesToRemove) {
      await sp.removeItem(value as V, plan);
    }
  }

  private calculateIsArrayStatefulParameter() {
    return 'addItem' in this.sp && 'removeItem' in this.sp;
  }
}
