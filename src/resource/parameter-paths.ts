/**
 * Typed parameter paths.
 *
 * Parameter settings are keyed by the top level parameter name (`dir`) or, when a nested value needs its own setting,
 * by a path into the config:
 *
 * - `envFiles[*]`                    every element of the `envFiles` array
 * - `envFiles[*].contents[*].value`  the `value` field of every element of every nested `contents` array
 * - `mcpServers[*].env.*`            every value of the `env` record
 *
 * {@link ConfigPath} generates every valid path for a config type so they autocomplete and typos fail to compile.
 */

type Primitive = bigint | boolean | null | number | string | symbol | undefined;
type IsAny<T> = 0 extends 1 & T ? true : false;
type PrevDepth = [never, 0, 1, 2, 3, 4, 5];

type PathTail<T, D extends number> = PathFrom<T, D> extends infer P extends string ? P : never;

/** All paths below a value, each starting with `.`, `[*]` or `.*`. */
type PathFrom<T, D extends number> =
  [D] extends [never] ? never
    : IsAny<T> extends true ? never
      : T extends Primitive ? never
        // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
        : T extends Function ? never
          : T extends ReadonlyArray<infer E>
            ? '[*]' | `[*]${PathTail<NonNullable<E>, PrevDepth[D]>}`
            : T extends object
              // Named keys, plus `.*` when the object also has an index signature (records, loose objects)
              ? { [K in KnownKeys<T>]-?: `.${K}${PathTail<NonNullable<T[K]>, PrevDepth[D]>}` | `.${K}` }[KnownKeys<T>]
                | (string extends keyof T ? '.*' | `.*${PathTail<NonNullable<T[string & keyof T]>, PrevDepth[D]>}` : never)
              : never;

/** The named (non index signature) string keys of an object type. */
type KnownKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] } & string;

/**
 * Every top level parameter name and nested path of a config type `T`. For example:
 * `'dir' | 'envFiles' | 'envFiles[*]' | 'envFiles[*].name' | 'envFiles[*].contents[*].value' | ...`
 */
export type ConfigPath<T> = PathFrom<T, 5> extends `.${infer P}` ? P : never;

/** Only the nested paths of `T` (excludes the top level parameter names). */
export type NestedConfigPath<T> = Exclude<ConfigPath<T>, keyof T>;

export type PathSegment =
  | { kind: 'items' }
  | { kind: 'property'; name: string }
  | { kind: 'values' };

const SEGMENT_REGEX = /\[\*]|\.\*|\.?([^.[\]]+)/g;

/**
 * Parse a parameter path into segments. Throws on malformed paths.
 */
export function parseParameterPath(path: string): PathSegment[] {
  const segments: PathSegment[] = [];
  let consumed = 0;

  for (const match of path.matchAll(SEGMENT_REGEX)) {
    if (match.index !== consumed) {
      break;
    }

    consumed += match[0].length;
    if (match[0] === '[*]') {
      segments.push({ kind: 'items' });
    } else if (match[0] === '.*') {
      segments.push({ kind: 'values' });
    } else {
      // A property can't start with a dot when it is the first segment, and must start with one otherwise
      if ((segments.length === 0) === match[0].startsWith('.')) {
        break;
      }

      segments.push({ kind: 'property', name: match[1] });
    }
  }

  if (consumed !== path.length || segments.length === 0 || segments[0].kind !== 'property') {
    throw new Error(`Invalid parameter path '${path}'. Expected a form like 'param', 'param[*].field' or 'param.*'`);
  }

  return segments;
}

export function formatParameterPath(segments: PathSegment[]): string {
  return segments.map((s, idx) => {
    if (s.kind === 'items') return '[*]';
    if (s.kind === 'values') return '.*';
    return idx === 0 ? s.name : `.${s.name}`;
  }).join('');
}

type JsonSchemaNode = Record<string, any>;

function variantsOf(node: JsonSchemaNode): JsonSchemaNode[] {
  return [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]
    .filter((v) => v && typeof v === 'object');
}

/**
 * Find the JSON schema node for a path segment. Returns `undefined` when the schema does not describe the child
 * (unknown) and `null` when the schema explicitly does not allow it.
 */
export function resolveSchemaChild(node: JsonSchemaNode | undefined, segment: PathSegment): JsonSchemaNode | null | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  const variants = variantsOf(node);
  for (const variant of variants) {
    const found = resolveSchemaChild(variant, segment);
    if (found) {
      return found;
    }
  }

  switch (segment.kind) {
    case 'property': {
      if (node.properties?.[segment.name]) {
        return node.properties[segment.name];
      }

      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        return node.additionalProperties;
      }

      return node.properties && variants.length === 0 && node.additionalProperties !== true ? null : undefined;
    }

    case 'items': {
      if (node.items && typeof node.items === 'object' && !Array.isArray(node.items)) {
        return node.items;
      }

      return node.type && node.type !== 'array' && variants.length === 0 ? null : undefined;
    }

    case 'values': {
      if (node.additionalProperties && typeof node.additionalProperties === 'object') {
        return node.additionalProperties;
      }

      const pattern = Object.values(node.patternProperties ?? {})[0];
      if (pattern && typeof pattern === 'object') {
        return pattern as JsonSchemaNode;
      }

      return node.type && node.type !== 'object' && variants.length === 0 ? null : undefined;
    }
  }
}

/**
 * Infer a basic parameter type from a JSON schema node. Returns undefined when the type is ambiguous.
 */
export function inferSchemaType(node: JsonSchemaNode | null | undefined): 'array' | 'boolean' | 'number' | 'object' | 'string' | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }

  const normalize = (type: unknown) => (type === 'integer' ? 'number' : type);

  if (typeof node.type === 'string') {
    const type = normalize(node.type);
    return ['array', 'boolean', 'number', 'object', 'string'].includes(type as string)
      ? type as 'array' | 'boolean' | 'number' | 'object' | 'string'
      : undefined;
  }

  const variantTypes = new Set(
    variantsOf(node)
      .map((v) => (typeof v.type === 'string' ? normalize(v.type) : inferSchemaType(v)))
      .filter((t) => t !== 'null')
  );

  if (variantTypes.size === 1 && !variantTypes.has(undefined)) {
    return inferSchemaType({ type: [...variantTypes][0] });
  }

  return undefined;
}
