import isObjectsEqual from 'lodash.isequal';
import path from 'node:path';

import { ArrayStatefulParameter } from '../stateful-parameter/stateful-parameter.js';
import { StatefulParameterController } from '../stateful-parameter/stateful-parameter-controller.js';
import {
  addVariablesToPath,
  areArraysEqual,
  resolvePathWithVariables,
  tildify,
  untildify
} from '../utils/functions.js';
import {
  PathSegment,
  formatParameterPath,
  inferSchemaType,
  parseParameterPath,
  resolveSchemaChild
} from './parameter-paths.js';
import {
  InputTransformation,
  NestedParameterSetting,
  ParameterSetting,
  ParameterSettingType,
} from './resource-settings.js';

type EqualsFn = (desired: unknown, current: unknown) => boolean;
type FilterFn = (desired: any, current: any) => any;
type JsonSchemaNode = Record<string, any>;

/**
 * The normalized form of a top level parameter's settings. Merges the resource level settings, the nested path
 * settings and (for stateful parameters) the stateful parameter's own settings into one object so the rest of the
 * framework never needs to special case stateful, array or nested parameters.
 */
export interface ParsedParameterSetting {
  name: string;

  /** The declared type, or the type inferred from the schema (array and object only). */
  type?: ParameterSettingType;

  /** True if this parameter or any value nested inside it is sensitive. */
  isSensitive: boolean;

  /** Full paths of the nested values that are sensitive (ex: `envFiles[*].contents[*].value`). */
  sensitivePaths: string[];

  default?: unknown;
  transformation?: InputTransformation;
  canModify: boolean;
  setting: boolean;

  isEqual: EqualsFn;

  /** Set when the parameter is an array. Element level equality. */
  isElementEqual?: EqualsFn;

  /**
   * Resolved stateless filtering function for arrays and objects. Undefined when the parameter isn't filtered.
   * Also used to filter the state when destroying in stateful mode.
   */
  filterInStatelessMode?: FilterFn;

  stateful?: StatefulParameterController<any, any>;
  order?: number;
}

const TOP_LEVEL_ONLY_KEYS = ['default', 'transformation', 'canModify', 'setting', 'stateful', 'order'] as const;
const VALID_TYPES = new Set<ParameterSettingType>(['any', 'array', 'boolean', 'directory', 'number', 'object', 'string', 'version']);

/**
 * The pre-set equality functions used for each {@link ParameterSettingType}. Exported so custom `isEqual` /
 * `isElementEqual` functions can reuse them (ex: `isEqual: ParameterEquals.directory` without the directory
 * input transformation).
 */
export const ParameterEquals = {
  'boolean': (a: unknown, b: unknown) => Boolean(a) === Boolean(b),
  'directory'(a: unknown, b: unknown) {
    let transformedA = resolvePathWithVariables(untildify(String(a)))
    let transformedB = resolvePathWithVariables(untildify(String(b)))

    if (transformedA.startsWith('.')) { // Only relative paths start with '.'
      transformedA = path.resolve(transformedA)
    }

    if (transformedB.startsWith('.')) { // Only relative paths start with '.'
      transformedB = path.resolve(transformedB)
    }

    // macOS has case-insensitive filesystem by default, Linux is case-sensitive
    const isCaseSensitive = process.platform === 'linux';
    if (!isCaseSensitive) {
      transformedA = transformedA.toLowerCase();
      transformedB = transformedB.toLowerCase();
    }

    return transformedA === transformedB;
  },
  'number': (a: unknown, b: unknown) => Number(a) === Number(b),
  'object': isObjectsEqual,
  'string': (a: unknown, b: unknown) => String(a) === String(b),
  'version': (desired: unknown, current: unknown) => String(current).includes(String(desired)),
} satisfies Partial<Record<ParameterSettingType, EqualsFn>>;

const ParameterEqualsDefaults: Partial<Record<ParameterSettingType, EqualsFn>> = ParameterEquals;

const ParameterTransformationDefaults: Partial<Record<ParameterSettingType, InputTransformation>> = {
  'directory': {
    to: (a: unknown) => resolvePathWithVariables((untildify(String(a)))),
    from(a: unknown, original) {
      if (ParameterEquals.directory(a, original)) {
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

/** A node in the settings tree of a single parameter. */
interface SettingNode {
  setting: NestedParameterSetting;
  path: string;
  schema?: JsonSchemaNode | null;
  properties: Map<string, SettingNode>;
  items?: SettingNode;
  values?: SettingNode;
}

function newNode(nodePath: string, schema?: JsonSchemaNode | null): SettingNode {
  return { setting: {}, path: nodePath, schema, properties: new Map() };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Parse the raw parameter settings of a resource into {@link ParsedParameterSetting}s keyed by top level parameter.
 *
 * @param resourceId Used for error messages
 * @param rawSettings The `parameterSettings` from the resource (top level keys and nested paths)
 * @param schema The resource JSON schema. Used to infer types and to validate that paths exist.
 */
export function parseParameterSettings(
  resourceId: string,
  rawSettings: Record<string, ParameterSetting | undefined>,
  schema?: JsonSchemaNode,
): Record<string, ParsedParameterSetting> {
  const roots = new Map<string, SettingNode>();

  // Top level keys first so nested paths can attach to them
  const entries = Object.entries(rawSettings)
    .sort(([a], [b]) => parseParameterPath(a).length - parseParameterPath(b).length);

  for (const [key, setting] of entries) {
    if (!setting) {
      throw new Error(`Resource: ${resourceId}. Parameter setting ${key} was left undefined`);
    }

    const segments = parseParameterPath(key);
    const isTopLevel = segments.length === 1;
    validateRawSetting(resourceId, key, setting, isTopLevel);

    let node = getOrCreateRoot(roots, (segments[0] as { name: string }).name, schema);
    if (node.schema === null) {
      throw new Error(`Resource: ${resourceId}. Parameter setting '${key}' does not exist in the schema`);
    }

    for (let i = 1; i < segments.length; i++) {
      node = getOrCreateChild(node, segments[i], segments.slice(0, i + 1));
      if (node.schema === null) {
        throw new Error(`Resource: ${resourceId}. Parameter setting path '${key}' does not exist in the schema`);
      }
    }

    node.setting = { ...node.setting, ...setting };
  }

  // Parameters that are only described by the schema still get parsed so array/object types are inferred
  for (const name of Object.keys(schema?.properties ?? {})) {
    getOrCreateRoot(roots, name, schema);
  }

  return Object.fromEntries(
    [...roots.entries()].map(([name, root]) => [name, buildParsedSetting(resourceId, name, root)])
  );
}

function getOrCreateRoot(roots: Map<string, SettingNode>, name: string, schema?: JsonSchemaNode): SettingNode {
  if (!roots.has(name)) {
    roots.set(name, newNode(name, schema ? resolveSchemaChild(schema, { kind: 'property', name }) : undefined));
  }

  return roots.get(name)!;
}

function getOrCreateChild(parent: SettingNode, segment: PathSegment, fullSegments: PathSegment[]): SettingNode {
  const childPath = formatParameterPath(fullSegments);
  const childSchema = parent.schema ? resolveSchemaChild(parent.schema, segment) : undefined;

  switch (segment.kind) {
    case 'items': {
      parent.items ??= newNode(childPath, childSchema);
      return parent.items;
    }

    case 'values': {
      parent.values ??= newNode(childPath, childSchema);
      return parent.values;
    }

    case 'property': {
      if (!parent.properties.has(segment.name)) {
        parent.properties.set(segment.name, newNode(childPath, childSchema));
      }

      return parent.properties.get(segment.name)!;
    }
  }
}

function validateRawSetting(resourceId: string, key: string, setting: ParameterSetting, isTopLevel: boolean): void {
  const legacy = setting as Record<string, unknown>;
  if (legacy.type === 'stateful' || legacy.definition !== undefined) {
    throw new Error(`Resource: ${resourceId}. Parameter '${key}': \`type: 'stateful'\` and \`definition\` were removed. Use \`{ stateful: new MyParameter() }\` instead.`);
  }

  if (legacy.type === 'setting') {
    throw new Error(`Resource: ${resourceId}. Parameter '${key}': \`type: 'setting'\` was removed. Use \`{ setting: true }\` instead.`);
  }

  if (setting.type !== undefined && !VALID_TYPES.has(setting.type)) {
    throw new Error(`Resource: ${resourceId}. Parameter '${key}': unknown type '${setting.type}'.`);
  }

  for (const fnKey of ['isEqual', 'isElementEqual'] as const) {
    if (setting[fnKey] !== undefined && typeof setting[fnKey] !== 'function') {
      throw new Error(`Resource: ${resourceId}. Parameter '${key}': ${fnKey} must be a function. String presets were removed, use \`type\` or \`itemType\` instead.`);
    }
  }

  if (!isTopLevel) {
    const invalid = TOP_LEVEL_ONLY_KEYS.filter((k) => (setting as Record<string, unknown>)[k] !== undefined);
    if (invalid.length > 0) {
      throw new Error(`Resource: ${resourceId}. Nested parameter path '${key}' can't use top level only settings: ${invalid.join(', ')}`);
    }
  }

  if (setting.order !== undefined && !setting.stateful) {
    throw new Error(`Resource: ${resourceId}. Parameter '${key}': order is only valid on stateful parameters.`);
  }
}

function buildParsedSetting(resourceId: string, name: string, root: SettingNode): ParsedParameterSetting {
  const resourceLevel = root.setting as ParameterSetting;
  let stateful: StatefulParameterController<any, any> | undefined;

  // Merge the stateful parameter's own settings underneath the resource level settings
  if (resourceLevel.stateful) {
    const spSettings = { ...resourceLevel.stateful.getSettings() } as ParameterSetting;
    if (spSettings.stateful || (spSettings as Record<string, unknown>).type === 'stateful') {
      throw new Error(`Resource: ${resourceId}. Nested stateful parameters are not allowed for ${name}`);
    }

    validateRawSetting(resourceId, name, { ...spSettings, order: undefined }, true);

    if (resourceLevel.stateful instanceof ArrayStatefulParameter || isArrayStatefulParameter(resourceLevel.stateful)) {
      spSettings.type ??= 'array';
    }

    root.setting = { ...spSettings, ...resourceLevel };
  }

  const setting = root.setting as ParameterSetting;
  const type = setting.type ?? inferTopLevelType(root);
  const isArray = isArrayNode(root, type);

  if (setting.key !== undefined && !isArray) {
    throw new Error(`Resource: ${resourceId}. Parameter '${root.path}': key is only valid on arrays of objects`);
  }

  validateNestedKeys(resourceId, root);

  const sensitivePaths = collectSensitivePaths(root);
  const parsed: ParsedParameterSetting = {
    name,
    type,
    isSensitive: Boolean(setting.isSensitive) || sensitivePaths.length > 0,
    sensitivePaths,
    default: setting.default,
    transformation: resolveTransformation(setting, root),
    canModify: Boolean(setting.canModify),
    setting: Boolean(setting.setting),
    isEqual: setting.setting ? () => true : buildEquals(root, type, true),
    isElementEqual: isArray ? buildElementEquals(root) : undefined,
    filterInStatelessMode: resolveFilter(root, type),
    order: setting.order,
  };

  if (setting.stateful) {
    parsed.stateful = new StatefulParameterController(setting.stateful, parsed);
  }

  return parsed;
}

function isArrayStatefulParameter(sp: unknown): boolean {
  return typeof sp === 'object' && sp !== null && 'addItem' in sp && 'removeItem' in sp;
}

/**
 * Only infer the container types at the top level. Primitive parameters without a declared type keep strict equality
 * (===) like before so that existing resources don't change behaviour.
 */
function inferTopLevelType(node: SettingNode): ParameterSettingType | undefined {
  const inferred = inferSchemaType(node.schema);
  return inferred === 'array' || inferred === 'object' ? inferred : undefined;
}

function isArrayNode(node: SettingNode, type?: ParameterSettingType): boolean {
  const { setting } = node;
  return type === 'array'
    || Boolean(node.items)
    || setting.itemType !== undefined
    || setting.isElementEqual !== undefined
    || (type === undefined && inferSchemaType(node.schema) === 'array');
}

function validateNestedKeys(resourceId: string, node: SettingNode): void {
  for (const child of [...node.properties.values(), node.items, node.values]) {
    if (!child) continue;

    const childType = child.setting.type ?? inferSchemaType(child.schema);
    if (child.setting.key !== undefined && !isArrayNode(child, childType)) {
      throw new Error(`Resource: ${resourceId}. Parameter '${child.path}': key is only valid on arrays of objects`);
    }

    validateNestedKeys(resourceId, child);
  }
}

function collectSensitivePaths(node: SettingNode, isRoot = true): string[] {
  const own = !isRoot && node.setting.isSensitive ? [node.path] : [];
  const children = [...node.properties.values(), node.items, node.values]
    .filter(Boolean)
    .flatMap((child) => collectSensitivePaths(child!, false));

  return [...own, ...children];
}

function hasNestedSettings(node: SettingNode): boolean {
  return node.properties.size > 0 || Boolean(node.items) || Boolean(node.values);
}

/**
 * Build the equality function for a node.
 *
 * Precedence: custom isEqual > arrays (element equality) > nested settings (structural) > type default > fallback.
 * The fallback is strict equality at the top level (unchanged behaviour) and deep equality for nested values.
 */
function buildEquals(node: SettingNode, type: ParameterSettingType | undefined, isTopLevel: boolean): EqualsFn {
  const { setting } = node;

  if (setting.isEqual) {
    return setting.isEqual;
  }

  if (isArrayNode(node, type)) {
    const elementEquals = buildElementEquals(node);
    return (desired, current) => areArraysEqual(elementEquals, desired, current);
  }

  if (node.properties.size > 0 || node.values) {
    return buildObjectEquals(node);
  }

  if (type && ParameterEqualsDefaults[type]) {
    return ParameterEqualsDefaults[type]!;
  }

  return isTopLevel ? (a, b) => a === b : isObjectsEqual;
}

function buildChildEquals(child: SettingNode | undefined): EqualsFn {
  if (!child) {
    return isObjectsEqual;
  }

  return buildEquals(child, child.setting.type, false);
}

function buildElementEquals(node: SettingNode): EqualsFn {
  const { setting } = node;
  if (setting.isElementEqual) {
    return setting.isElementEqual;
  }

  if (node.items && (node.items.setting.isEqual || node.items.setting.type || hasNestedSettings(node.items))) {
    return buildChildEquals(node.items);
  }

  const itemType = setting.itemType ?? inferSchemaType(node.items?.schema ?? resolveSchemaChild(node.schema ?? undefined, { kind: 'items' }));
  if (itemType && ParameterEqualsDefaults[itemType]) {
    return ParameterEqualsDefaults[itemType]!;
  }

  return isObjectsEqual;
}

function buildObjectEquals(node: SettingNode): EqualsFn {
  const propertyEquals = new Map([...node.properties.entries()].map(([k, child]) => [k, buildChildEquals(child)]));
  const valueEquals = node.values ? buildChildEquals(node.values) : isObjectsEqual;

  return (desired, current) => {
    if (!isPlainObject(desired) || !isPlainObject(current)) {
      return isObjectsEqual(desired, current);
    }

    const keys = new Set([...Object.keys(desired), ...Object.keys(current)]);
    for (const k of keys) {
      const eq = propertyEquals.get(k) ?? valueEquals;
      const d = desired[k];
      const c = current[k];

      if ((d === undefined || d === null) && (c === undefined || c === null)) {
        continue;
      }

      if (d === undefined || d === null || c === undefined || c === null || !eq(d, c)) {
        return false;
      }
    }

    return true;
  };
}

function buildKeyEquals(node: SettingNode): EqualsFn | undefined {
  const { key } = node.setting;
  if (key === undefined) {
    return undefined;
  }

  const fields = Array.isArray(key) ? key : [key];
  const fieldEquals = fields.map((f) => [f, buildChildEquals(node.items?.properties.get(f))] as const);

  return (desired, current) => isPlainObject(desired) && isPlainObject(current)
    && fieldEquals.every(([f, eq]) => eq(desired[f], current[f]));
}

function defaultArrayFilter(matcher: EqualsFn): FilterFn {
  return (desired: unknown[], current: unknown[]) => {
    const desiredCopy = [...desired];
    const currentCopy = [...current];
    const result = [];

    for (let counter = desiredCopy.length - 1; counter >= 0; counter--) {
      const idx = currentCopy.findIndex((e2) => matcher(desiredCopy[counter], e2))

      if (idx === -1) {
        continue;
      }

      desiredCopy.splice(counter, 1)
      const [element] = currentCopy.splice(idx, 1)
      result.push(element)
    }

    return result;
  }
}

function resolveFilter(node: SettingNode, type: ParameterSettingType | undefined): FilterFn | undefined {
  const { filterInStatelessMode } = node.setting;

  if (filterInStatelessMode === false) {
    return undefined;
  }

  if (typeof filterInStatelessMode === 'function') {
    return filterInStatelessMode;
  }

  if (isArrayNode(node, type)) {
    const keyEquals = buildKeyEquals(node);
    return keyEquals
      ? (desired: unknown[], current: unknown[]) => current.filter((c) => desired.some((d) => keyEquals(d, c)))
      : defaultArrayFilter(buildElementEquals(node));
  }

  if (type === 'object') {
    return (desired: unknown, current: unknown) => {
      if (!isPlainObject(desired) || !isPlainObject(current)) {
        return current;
      }

      return Object.fromEntries(Object.entries(current).filter(([k]) => k in desired));
    };
  }

  return undefined;
}

function resolveTransformation(setting: ParameterSetting, node: SettingNode): InputTransformation | undefined {
  if (setting.transformation) {
    return setting.transformation;
  }

  const itemType = setting.itemType ?? node.items?.setting.type;
  if ((setting.type === 'array' || itemType) && itemType && ParameterTransformationDefaults[itemType]) {
    const itemTransformation = ParameterTransformationDefaults[itemType]!;
    const elementEquals = buildElementEquals(node);

    return {
      to(input: unknown[]) {
        return input.map((i) => itemTransformation.to(i))
      },
      from(input: unknown[], original) {
        return input.map((i, idx) => {
          const originalElement = Array.isArray(original)
            ? original.find((o) => elementEquals(o, i)) ?? original[idx]
            : original;

          return itemTransformation.from(i, originalElement);
        })
      }
    }
  }

  return setting.type ? ParameterTransformationDefaults[setting.type] : undefined;
}
