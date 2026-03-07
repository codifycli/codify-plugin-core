import { StringIndexedObject } from '@codifycli/schemas';

import { Plan } from '../plan/plan.js';
import { ArrayParameterSetting, ParameterSetting } from '../resource/resource-settings.js';

/**
 * A stateful parameter represents a parameter that holds state on the system (can be created, destroyed) but
 * is still tied to the overall lifecycle of a resource.
 *
 * **Examples include:**
 * 1. Homebrew formulas are stateful parameters. They can be installed and uninstalled but they are still tied to the
 * overall lifecycle of homebrew
 * 2. Nvm installed node versions are stateful parameters. Nvm can install and uninstall different versions of Node but
 * these versions are tied to the lifecycle of nvm. If nvm is uninstalled then so are the Node versions.
 */
export abstract class StatefulParameter<T extends StringIndexedObject, V extends T[keyof T]> {

  /**
   * Parameter settings for the stateful parameter. Stateful parameters share the same parameter settings as
   * regular parameters except that they cannot be of type 'stateful'. See {@link ParameterSetting} for more
   * information on available settings.
   *
   * @return The parameter settings
   */
  getSettings(): ParameterSetting {
    return {}
  }

  /**
   * Refresh the status of the stateful parameter on the system. This method works similarly to {@link Resource.refresh}.
   * Return the value of the stateful parameter or null if not found.
   *
   * @param desired The desired value of the user.
   * @param config The desired config
   *
   * @return The value of the stateful parameter currently on the system or null if not found
   */
  abstract refresh(desired: V | null, config: Partial<T>): Promise<V | null>;

  /**
   * Create the stateful parameter on the system. This method is similar {@link Resource.create} except that its only
   * applicable to the stateful parameter. For resource `CREATE` operations, this method will be called after the
   * resource is successfully created. The add method is called when a ParameterChange is ADD in a plan. The add
   * method is only called when the stateful parameter does not currently exist.
   *
   * **Example (Homebrew formula):**
   * 1. Add is called with a value of:
   * ```
   * ['jq', 'jenv']
   * ```
   * 2. Add handles the request by calling `brew install --formulae jq jenv`
   *
   * @param valueToAdd The desired value of the stateful parameter.
   * @param plan The overall plan that contains the ADD
   */
  abstract add(valueToAdd: V, plan: Plan<T>): Promise<void>;

  /**
   * Modify the state of a stateful parameter on the system. This method is similar to {@link Resource.modify} except that its only
   * applicable to the stateful parameter.
   *
   * **Example (Git email parameter):**
   * 1. Add is called with a value of:
   * ```
   * newValue: 'email+new@gmail.com', previousValue: 'email+old@gmail.com'
   * ```
   * 2. Modify handles the request by calling `git config --global user.email email+new@gmail.com`
   *
   * @param newValue The desired value of the stateful parameter
   * @param previousValue The current value of the stateful parameter
   * @param plan The overall plan
   */
  abstract modify(newValue: V, previousValue: V, plan: Plan<T>): Promise<void>;

  /**
   * Create the stateful parameter on the system. This method is similar {@link Resource.destroy} except that its only
   * applicable to the stateful parameter. The remove method is only called when the stateful parameter already currently exist.
   * This method corresponds to REMOVE parameter operations in a plan.
   * For resource `DESTORY`, this method is only called if the {@link ResourceSettings.removeStatefulParametersBeforeDestroy}
   * is set to true. This method will be called before the resource is destroyed.
   *
   * **Example (Homebrew formula):**
   * 1. Remove is called with a value of:
   * ```
   * ['jq', 'jenv']
   * ```
   * 2. Remove handles the request by calling `brew uninstall --formulae jq jenv`
   *
   * @param valueToRemove The value to remove from the stateful parameter.
   * @param plan The overall plan that contains the REMOVE
   */
  abstract remove(valueToRemove: V, plan: Plan<T>): Promise<void>;
}

/**
 * A specialized version of {@link StatefulParameter } that is used for stateful parameters which are arrays.
 * A stateful parameter represents a parameter that holds state on the system (can be created, destroyed) but
 * is still tied to the overall lifecycle of a resource.
 *
 * **Examples:**
 * - Homebrew formulas are arrays
 * - Pyenv python versions are arrays
 */
export abstract class ArrayStatefulParameter<T extends StringIndexedObject, V> {

  /**
   * Parameter settings for the stateful parameter. Stateful parameters share the same parameter settings as
   * regular parameters except that they cannot be of type 'stateful'. See {@link ParameterSetting} for more
   * information on available settings. Type must be 'array'.
   *
   * @return The parameter settings
   */
  getSettings(): ArrayParameterSetting {
    return { type: 'array' }
  }

  /**
   * See {@link StatefulParameter.refresh} for more info.
   *
   * @param desired The desired value to refresh
   * @param config The desired config
   *
   * @return The current value on the system or null if not found.
   */
  abstract refresh(desired: V[] | null, config: Partial<T>): Promise<V[] | null>;

  /**
   * Helper method that gets called when individual elements of the array need to be added. See {@link StatefulParameter.add}
   * for more information.
   *
   * Example (Homebrew formula):
   * 1. The stateful parameter receives an input of:
   * ```
   * ['jq', 'jenv', 'docker']
   * ```
   * 2. Internally the stateful parameter will iterate the array and call `addItem` for each element
   * 3. Override addItem and install each formula using `brew install --formula jq`
   *
   * @param item The item to add (install)
   * @param plan The overall plan
   */
  abstract addItem(item: V, plan: Plan<T>): Promise<void>;

  /**
   * Helper method that gets called when individual elements of the array need to be removed. See {@link StatefulParameter.remove}
   * for more information.
   *
   * Example (Homebrew formula):
   * 1. The stateful parameter receives an input of:
   * ```
   * ['jq', 'jenv', 'docker']
   * ```
   * 2. Internally the stateful parameter will iterate the array and call `removeItem` for each element
   * 3. Override removeItem and uninstall each formula using `brew uninstall --formula jq`
   *
   * @param item The item to remove (uninstall)
   * @param plan The overall plan
   */
  abstract removeItem(item: V, plan: Plan<T>): Promise<void>;
}
