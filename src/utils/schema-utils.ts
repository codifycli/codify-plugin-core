type JsonSchemaNode = Record<string, any>;

/**
 * Find every named field in a JSON schema that has no `description`. Used by plugin build scripts to enforce that all
 * parameters (including nested fields) are documented for the editor and the generated docs.
 *
 * Array items, record values and union variants don't need their own description (the field containing them does).
 * Pure discriminator fields (a `const` / single value `enum`) are skipped.
 *
 * @param schema A JSON schema (for a Zod schema use the converted schema, ex: `ParsedResourceSettings.schema`)
 * @return The paths of the fields without a description, ex: `['envFiles[*].contents[*].value']`
 */
export function findUndescribedFields(schema: JsonSchemaNode | undefined): string[] {
  const missing = new Set<string>();

  function walk(node: unknown, path: string, isField: boolean): void {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }

    const n = node as JsonSchemaNode;
    const isDiscriminator = n.const !== undefined || (Array.isArray(n.enum) && n.enum.length === 1);
    if (isField && !n.description && !isDiscriminator) {
      missing.add(path);
    }

    for (const variant of [...(n.anyOf ?? []), ...(n.oneOf ?? []), ...(n.allOf ?? [])]) {
      walk(variant, path, false);
    }

    for (const [key, child] of Object.entries(n.properties ?? {})) {
      walk(child, path ? `${path}.${key}` : key, true);
    }

    if (n.items && typeof n.items === 'object' && !Array.isArray(n.items)) {
      walk(n.items, `${path}[*]`, false);
    }

    if (n.additionalProperties && typeof n.additionalProperties === 'object') {
      walk(n.additionalProperties, `${path}.*`, false);
    }
  }

  walk(schema, '', false);
  return [...missing];
}
