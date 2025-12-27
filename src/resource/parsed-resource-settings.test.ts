import { describe, expect, it } from 'vitest';
import { ResourceSettings } from './resource-settings.js';
import { ParsedResourceSettings } from './parsed-resource-settings.js';
import { TestConfig } from '../utils/test-utils.test.js';
import { z } from 'zod';
import { OS } from 'codify-schemas';

describe('Resource options parser tests', () => {
  it('Parses default values from options', () => {
    const option: ResourceSettings<TestConfig> = {
      id: 'typeId',
      parameterSettings: {
        propA: { default: 'propA' },
        propB: { default: 'propB' },
        propC: { isEqual: () => true },
        propD: {},
      }
    }

    const result = new ParsedResourceSettings(option);
    expect(result.defaultValues).to.deep.eq({
      propA: 'propA',
      propB: 'propB'
    })
  })

  it('Throws an error when an import.requiredParameters is not declared', () => {
    const schema = {
      '$schema': 'http://json-schema.org/draft-07/schema',
      '$id': 'https://www.codifycli.com/git-clone.json',
      'title': 'Git-clone resource',
      'type': 'object',
      'properties': {
        'remote': {
          'type': 'string',
          'description': 'Remote tracking url to clone repo from. Equivalent to repository and only one should be specified'
        },
        'repository': {
          'type': 'string',
          'description': 'Remote repository to clone repo from. Equivalent to remote and only one should be specified'
        },
        'parentDirectory': {
          'type': 'string',
          'description': 'Parent directory to clone into. The folder name will use default git semantics which extracts the last part of the clone url. Only one of parentDirectory or directory can be specified'
        },
        'directory': {
          'type': 'string',
          'description': 'Directory to clone contents into. This value is directly passed into git clone. This differs from parent directory in that the last part of the path will be the folder name of the repo'
        },
        'autoVerifySSH': {
          'type': 'boolean',
          'description': 'Automatically verifies the ssh connection for ssh git clones. Defaults to true.'
        }
      },
      'additionalProperties': false,
      'oneOf': [
        { 'required': ['repository', 'directory'] },
        { 'required': ['repository', 'parentDirectory'] },
        { 'required': ['remote', 'directory'] }
      ]
    }

    const option: ResourceSettings<TestConfig> = {
      id: 'typeId',
      schema,
    }

    expect(() => new ParsedResourceSettings(option)).toThrowError();
  })

  it('Throws an error when an import.requiredParameters is declared improperly', () => {
    const schema = {
      '$schema': 'http://json-schema.org/draft-07/schema',
      'type': 'object',
      'properties': {
        'remote': {
          'type': 'string',
        },
      },
      'additionalProperties': false,
    }

    const option: ResourceSettings<TestConfig> = {
      id: 'typeId',
      schema,
      importAndDestroy: {
        requiredParameters: ['import-error']
      }
    }

    expect(() => new ParsedResourceSettings(option)).toThrowError();
  })

  it('Throws an error when an import.refreshKeys is declared improperly', () => {
    const schema = {
      '$schema': 'http://json-schema.org/draft-07/schema',
      'type': 'object',
      'properties': {
        'remote': {
          'type': 'string',
        },
      },
      'additionalProperties': false,
    }

    const option: ResourceSettings<TestConfig> = {
      id: 'typeId',
      schema,
      importAndDestroy: {
        refreshKeys: ['import-error']
      }
    }

    expect(() => new ParsedResourceSettings(option)).toThrowError();
  })

  it('Doesn\'t throw an error when an import.refreshValues is declared properly', () => {
    const schema = {
      '$schema': 'http://json-schema.org/draft-07/schema',
      'type': 'object',
      'properties': {
        'remote': {
          'type': 'string',
        },
      },
      'additionalProperties': false,
    }

    const option: ResourceSettings<TestConfig> = {
      id: 'typeId',
      schema,
      importAndDestroy: {
        refreshKeys: ['remote'],
      }
    }

    expect(() => new ParsedResourceSettings(option)).not.toThrowError()
  })

  it('Throws an error if defaultRefreshValue is not found in refreshKeys', () => {
    const schema = {
      '$schema': 'http://json-schema.org/draft-07/schema',
      'type': 'object',
      'properties': {
        'remote': {
          'type': 'string',
        },
      },
      'additionalProperties': false,
    }

    const option: ResourceSettings<TestConfig> = {
      id: 'typeId',
      schema,
      importAndDestroy: {
        defaultRefreshValues: {
          repository: 'abc'
        }
      }
    }

    expect(() => new ParsedResourceSettings(option)).toThrowError()
  })

  it('Can handle a zod schema', () => {

    const schema = z.object({
      propA: z.string(),
      repository: z.string(),
    })

    const option: ResourceSettings<z.infer<typeof schema>> = {
      id: 'typeId',
      operatingSystems: [OS.Darwin],
      schema,
      importAndDestroy: {
        defaultRefreshValues: {
          repository: 'abc'
        }
      }
    }

    console.log(new ParsedResourceSettings(option))

  })
})
