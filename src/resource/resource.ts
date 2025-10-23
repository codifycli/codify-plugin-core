import { StringIndexedObject, } from 'codify-schemas';

import { ParameterChange } from '../plan/change-set.js';
import { CreatePlan, DestroyPlan, ModifyPlan } from '../plan/plan-types.js';
import { ResourceSettings } from './resource-settings.js';

export interface RefreshContext<T extends StringIndexedObject> {
  isStateful: boolean;
  commandType: 'destroy' | 'import' | 'plan' | 'validationPlan';
  originalDesiredConfig: Partial<T> | null;
}

/**
 * A resource represents an object on the system (application, CLI tool, or setting)
 * that has state and can be created and destroyed. Examples of resources include CLI tools
 * like homebrew, docker, and xcode-tools; applications like Google Chrome, Zoom, and OpenVPN;
 * and settings like AWS profiles, git configs and system preference settings.
 */
export abstract class Resource<T extends StringIndexedObject> {

  /**
   * Return the settings for the resource. Consult the typing for {@link ResourceSettings} for
   * a description of the options.
   *
   * **Parameters**:
   * - id: The id of the resource. This translates to the `type` id parameter in codify.json configs
   * - schema: A JSON schema used to validate user input
   * - allowMultiple: Allow multiple copies of the resource to exist at the same time. If true then,
   * a matcher must be defined that matches a user defined config and a single resource on the system.
   * - removeStatefulParametersBeforeDestory: Call the delete methods of stateful parameters before destorying
   * the base resource. Defaults to false.
   * - dependencies: Specify the ids of any resources that this resource depends on
   * - parameterSettings: Parameter specific settings. Use this to define custom equals functions, default values
   * and input transformations
   * - inputTransformation: Transform the input value.
   *
   * @return ResourceSettings The resource settings
   */
  abstract getSettings(): ResourceSettings<T>;

  async initialize(): Promise<void> {
  };

  /**
   * Add custom validation logic in-addition to the default schema validation.
   * In this method throw an error if the object did not validate. The message of the
   * error will be shown to the user.
   * @param parameters
   */
  async validate(parameters: Partial<T>): Promise<void> {
  };

  /**
   * Return the status of the resource on the system. If multiple resources exist, then return all instances of
   * the resource back. Query for the individual parameters specified in the parameter param.
   * Return null if the resource does not exist.
   *
   * Example (Android Studios Resource):
   * 1. Receive Input:
   * ```
   * {
   *   name: 'Android Studios.app'
   *   directory: '/Application',
   *   version: '2023.2'
   * }
   * ```
   * 2. Query the system for any installed Android studio versions.
   * 3. In this example we find that there is an 2023.2 version installed and an
   * additional 2024.3-beta version installed as well.
   * 4. We would return:
   * ```
   * [
   *   { name: 'Android Studios.app', directory: '/Application', version: '2023.2' },
   *   { name: 'Android Studios Preview.app', directory: '/Application', version: '2024.3' },
   * ]
   * ```
   *
   * @param parameters The parameters to refresh. In stateless mode this will be the parameters
   * of the desired config. In stateful mode, this will be parameters of the state config + the desired
   * config of any new parameters.
   *
   * @param context Context surrounding the request
   *
   * @return A config or an array of configs representing the status of the resource on the
   * system currently
   */
  abstract refresh(parameters: Partial<T>, context: RefreshContext<T>): Promise<Array<Partial<T>> | Partial<T> | null>;

  /**
   * Create the resource (install) based on the parameters passed in. Only the desired parameters will
   * be non-null because in a CREATE plan, the current value is null.
   *
   * Example (Android Studios Resource):
   * 1. We receive a plan of:
   * ```
   * Plan {
   *   desiredConfig: {
   *     name: 'Android Studios.app',
   *     directory: '/Application',
   *     version: '2023.2'
   *   }
   *   currentConfig: null,
   * }
   * ```
   * 2. Install version Android Studios 2023.2 and then return.
   *
   * @param plan The plan of what to install. Use only the desiredConfig because currentConfig is null.
   */
  abstract create(plan: CreatePlan<T>): Promise<void>;

  /**
   * Modify a single parameter of a resource. Modify is optional to override and is only called
   * when a resourceSetting was set to `canModify = true`. This method should only modify
   * a single parameter at a time as specified by the first parameter: ParameterChange.
   *
   * Example (AWS Profile Resource):
   * 1. We receive a parameter change of:
   * ```
   * {
   *   name: 'awsAccessKeyId',
   *   operation: ParameterOperation.MODIFY,
   *   newValue: '123456',
   *   previousValue: 'abcdef'
   * }
   * ```
   * 2. Use an if statement to only apply this operation for the parameter `awsAccessKeyId`
   * 3. Update the value of the `aws_access_key_id` to the `newValue` specified in the parameter change
   *
   * @param pc ParameterChange, the parameter name and values to modify on the resource
   * @param plan The overall plan that triggered the modify operation
   */
  async modify(pc: ParameterChange<T>, plan: ModifyPlan<T>): Promise<void> {
  };

  /**
   * Destroy the resource (uninstall) based on the parameters passed in. Only the current parameters will
   * be non-null because in a DESTROY plan, the desired value is null. This method will only be called in
   * stateful mode.
   *
   * Example (Android Studios Resource):
   * 1. We receive a plan of:
   * ```
   * Plan {
   *   currentConfig: {
   *     name: 'Android Studios.app',
   *     directory: '/Application',
   *     version: '2022.4'
   *   },
   *   desiredConfig: null
   * }
   * ```
   * 2. Uninstall version Android Studios 2022.4 and then return.
   *
   * @param plan The plan of what to uninstall. Use only the currentConfig because desiredConfig is null.
   */
  abstract destroy(plan: DestroyPlan<T>): Promise<void>;
}
