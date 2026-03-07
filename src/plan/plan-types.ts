import { StringIndexedObject } from '@codifycli/schemas';

import { Plan } from './plan.js';

/**
 * A narrower type for plans for CREATE operations. Only desiredConfig is not null.
 */
export interface CreatePlan<T extends StringIndexedObject> extends Plan<T> {
  desiredConfig: T;
  currentConfig: null;
}

/**
 * A narrower type for plans for DESTROY operations. Only currentConfig is not null.
 */
export interface DestroyPlan<T extends StringIndexedObject> extends Plan<T> {
  desiredConfig: null;
  currentConfig: T;
}

/**
 * A narrower type for plans for MODIFY and RE-CREATE operations.
 */
export interface ModifyPlan<T extends StringIndexedObject> extends Plan<T> {
  desiredConfig: T;
  currentConfig: T;
}
