import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { findUndescribedFields } from './schema-utils.js';

describe('findUndescribedFields', () => {
  it('reports nested fields without descriptions', () => {
    const schema = z.object({
      dir: z.string().describe('Directory'),
      envFiles: z.array(z.object({
        name: z.string().describe('File name'),
        contents: z.array(z.object({ key: z.string().describe('Key'), value: z.string() })).optional(),
      })).describe('Files'),
      servers: z.array(z.discriminatedUnion('type', [
        z.object({ type: z.literal('a'), url: z.string() }),
        z.object({ type: z.literal('b'), cmd: z.string().describe('Command') }),
      ])).describe('Servers'),
      env: z.record(z.string(), z.object({ v: z.string() })).describe('Env'),
      // Describing before a check is lost in zod, this must be reported
      lost: z.string().describe('lost').min(1),
    });

    expect(findUndescribedFields(z.toJSONSchema(schema, { target: 'draft-7', io: 'input' }) as any)).toEqual([
      'envFiles[*].contents',
      'envFiles[*].contents[*].value',
      'servers[*].url',
      'env.*.v',
      'lost',
    ]);
  });
});
