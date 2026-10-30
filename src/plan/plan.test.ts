import { describe, expect, it } from 'vitest';
import { Plan } from './plan.js';
import { OS, ParameterOperation, ResourceOperation, StringIndexedObject } from '@codifycli/schemas';
import { TestConfig, TestResource } from '../utils/test-utils.test.js';
import { ResourceController } from '../resource/resource-controller.js';
import { ParsedResourceSettings } from '../resource/parsed-resource-settings.js';
import { ResourceSettings } from '../resource/resource-settings.js';
import { Resource } from '../resource/resource.js';
import { ArrayStatefulParameter } from '../stateful-parameter/stateful-parameter.js';

describe('Plan entity tests', () => {
  it('Adds default values properly when plan is parsed from request (Create)', () => {
    const resource = createTestResource()
    const controller = new ResourceController(resource);

    const plan = Plan.fromResponse({
      operation: ResourceOperation.CREATE,
      resourceType: 'type',
      parameters: [{
        name: 'propB',
        operation: ParameterOperation.ADD,
        previousValue: null,
        newValue: 'propBValue'
      }],
      isStateful: false,
    }, controller.parsedSettings.defaultValues);

    expect(plan.currentConfig).to.be.null;

    expect(plan.desiredConfig).toMatchObject({
      propA: 'defaultA',
      propB: 'propBValue',
    })

    expect(plan.changeSet.parameterChanges
      .every((pc) => pc.operation === ParameterOperation.ADD)
    ).to.be.true;
  })

  it('Adds default values properly when plan is parsed from request (Destroy)', () => {
    const resource = createTestResource()
    const controller = new ResourceController(resource);

    const plan = Plan.fromResponse({
      operation: ResourceOperation.DESTROY,
      resourceType: 'type',
      parameters: [{
        name: 'propB',
        operation: ParameterOperation.REMOVE,
        previousValue: 'propBValue',
        newValue: null,
      }],
      isStateful: false,
    }, controller.parsedSettings.defaultValues);

    expect(plan.currentConfig).toMatchObject({
      propA: 'defaultA',
      propB: 'propBValue',
    })

    expect(plan.desiredConfig).to.be.null;

    expect(plan.changeSet.parameterChanges
      .every((pc) => pc.operation === ParameterOperation.REMOVE)
    ).to.be.true;
  })

  it('Adds default values properly when plan is parsed from request (No-op)', () => {
    const resource = createTestResource()
    const controller = new ResourceController(resource);

    const plan = Plan.fromResponse({
      operation: ResourceOperation.NOOP,
      resourceType: 'type',
      parameters: [{
        name: 'propB',
        operation: ParameterOperation.NOOP,
        previousValue: 'propBValue',
        newValue: 'propBValue',
      }],
      isStateful: false,
    }, controller.parsedSettings.defaultValues);

    expect(plan.currentConfig).toMatchObject({
      propA: 'defaultA',
      propB: 'propBValue',
    })

    expect(plan.desiredConfig).toMatchObject({
      propA: 'defaultA',
      propB: 'propBValue',
    })

    expect(plan.changeSet.parameterChanges
      .every((pc) => pc.operation === ParameterOperation.NOOP)
    ).to.be.true;
  })

  it('Does not add default value if a value has already been specified', () => {
    const resource = createTestResource()
    const controller = new ResourceController(resource);

    const plan = Plan.fromResponse({
      operation: ResourceOperation.CREATE,
      resourceType: 'type',
      parameters: [{
        name: 'propB',
        operation: ParameterOperation.ADD,
        previousValue: null,
        newValue: 'propBValue',
      }, {
        name: 'propA',
        operation: ParameterOperation.ADD,
        previousValue: null,
        newValue: 'propAValue',
      }],
      isStateful: false,
    }, controller.parsedSettings.defaultValues);

    expect(plan.currentConfig).to.be.null

    expect(plan.desiredConfig).toMatchObject({
      propA: 'propAValue',
      propB: 'propBValue',
    })

    expect(plan.changeSet.parameterChanges
      .every((pc) => pc.operation === ParameterOperation.ADD)
    ).to.be.true;
  })

  it('Returns the original resource names', () => {
    const plan = Plan.calculate<TestConfig>({
      desired: { propA: 'propA' },
      currentArray: [{ propA: 'propA2' }],
      state: null,
      core: {
        type: 'type',
        name: 'name1'
      },
      settings: new ParsedResourceSettings<TestConfig>({ id: 'type' }),
      isStateful: false,
    });

    expect(plan.toResponse()).toMatchObject({
      resourceType: 'type',
      resourceName: 'name1',
      operation: ResourceOperation.RECREATE
    })
  })

  it('Filters array parameters in stateless mode (by default)', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propZ: { type: 'array', isElementEqual: (a, b) => b.includes(a) }
          }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return {
          propZ: [
            '20.15.0',
            '20.15.1'
          ]
        }
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      { propZ: ['20.15'], } as any,
      null,
      false
    )

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Filters array parameters in delete mode (when desired is null)', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propZ: { type: 'array', isElementEqual: (a, b) => b.includes(a) }
          }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return {
          propZ: [
            '20.15.0',
            '20.15.1'
          ]
        }
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      null,
      { propZ: ['20.15.0'], } as any,
      true
    )

    console.log(JSON.stringify(plan, null, 2));
    expect(plan).toMatchObject({
      id: expect.any(String),
      changeSet: expect.objectContaining({
        operation: ResourceOperation.DESTROY,
        parameterChanges: [
          expect.objectContaining({ operation: 'remove', name: 'propZ', previousValue: ['20.15.0'], newValue: null }),
        ],
      }),
      coreParameters: expect.objectContaining({
        type: 'type',
      }),
      isStateful: true,
    })
  })

  it('Treats an empty-after-filtering array as no current state (already destroyed)', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propZ: { type: 'array', isElementEqual: (a, b) => a === b }
          }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        // The declared item is already gone from the system, but other unrelated items remain —
        // refresh() can't know which items belong to this resource's declared config, so it still
        // returns a non-empty object overall.
        return {
          propZ: ['some-other-unmanaged-item']
        }
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      null,
      { propZ: ['20.15.0'] } as any,
      true
    )

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Doesn\'t filters array parameters if filtering is disabled', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propZ: {
              type: 'array',
              canModify: true,
              isElementEqual: (a, b) => b.includes(a),
              filterInStatelessMode: false
            }
          }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return {
          propZ: [
            '20.15.0',
            '20.15.1'
          ]
        }
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      { propZ: ['20.15'], } as any,
      null,
      false
    )

    expect(plan.changeSet).toMatchObject({
      operation: ResourceOperation.MODIFY,
      parameterChanges: expect.arrayContaining([
        expect.objectContaining({
          name: 'propZ',
          previousValue: expect.arrayContaining([
            '20.15.0',
            '20.15.1'
          ]),
          newValue: expect.arrayContaining([
            '20.15'
          ]),
          operation: 'modify'
        })
      ])
    })
  })

  it('Can use the requiredParameters to match the correct resources together', async () => {
    const resource1 = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'string' },
            propB: { type: 'string', canModify: true },
          },
          allowMultiple: {
            identifyingParameters: ['propA']
          }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return [{
          propA: 'same',
          propB: 'old',
        }, {
          propA: 'different',
          propB: 'different',
        }]
      }
    }

    const controller = new ResourceController(resource1);
    const plan = await controller.plan(
      { type: 'type' },
      { propA: 'same', propB: 'new' },
      null,
      false
    )

    expect(plan.changeSet).toMatchObject({
      operation: ResourceOperation.MODIFY,
      parameterChanges: expect.arrayContaining([
        expect.objectContaining({
          name: 'propA',
          previousValue: 'same',
          newValue: 'same',
          operation: 'noop'
        }),
        expect.objectContaining({
          name: 'propB',
          previousValue: 'old',
          newValue: 'new',
          operation: 'modify'
        })
      ])
    })
  })

  it('Can use the schema to determine required parameters for multiple allowed', async () => {
    const resource1 = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'string' },
            propB: { type: 'string', canModify: true },
          },
          allowMultiple: true,
          schema: {
            '$schema': 'http://json-schema.org/draft-07/schema',
            '$id': 'https://www.codifycli.com/type.json',
            'type': 'object',
            'properties': {
              propA: { type: 'string' },
              propB: { type: 'string' }
            },
            required: ['propA']
          }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return [{
          propA: 'same',
          propB: 'old',
        }, {
          propA: 'different',
          propB: 'different',
        }]
      }
    }

    const controller = new ResourceController(resource1);
    const plan = await controller.plan(
      { type: 'type' },
      { propA: 'same', propB: 'new' },
      null,
      false
    )

    expect(plan.changeSet).toMatchObject({
      operation: ResourceOperation.MODIFY,
      parameterChanges: expect.arrayContaining([
        expect.objectContaining({
          name: 'propA',
          previousValue: 'same',
          newValue: 'same',
          operation: 'noop'
        }),
        expect.objectContaining({
          name: 'propB',
          previousValue: 'old',
          newValue: 'new',
          operation: 'modify'
        })
      ])
    })
  })

  // Regression: a resource that exists but tracks no stateful items (e.g. `{ type: 'homebrew' }`
  // with no formulae/casks) refreshed to all-empty stateful arrays. Those were previously treated
  // as "no current parameters", so the post-apply validation plan re-planned it as a CREATE and
  // apply failed with "Additional changes are needed to complete apply."
  it('Does not plan a CREATE when an existing resource has only empty stateful parameters', async () => {
    const resource = new class extends Resource<StatefulEmptyConfig> {
      getSettings(): ResourceSettings<StatefulEmptyConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            formulae: { type: 'stateful', definition: new EmptyArrayParameter(), order: 1 },
            casks: { type: 'stateful', definition: new EmptyArrayParameter(), order: 2 },
            skipAlreadyInstalledCasks: { type: 'boolean', default: true, setting: true },
          },
        }
      }

      // The resource itself exists, with nothing of its own to track.
      async refresh(): Promise<Partial<StatefulEmptyConfig> | null> {
        return {};
      }

      async create(): Promise<void> {}
      async destroy(): Promise<void> {}
    };

    const controller = new ResourceController(resource);
    const desired: Partial<StatefulEmptyConfig> = { formulae: [], casks: [] };

    const plan = await controller.plan({ type: 'type' }, desired, desired, false, 'validationPlan');

    expect(plan.changeSet.operation).toBe(ResourceOperation.NOOP);
    expect(plan.requiresChanges()).to.be.false;
  })

  it('Still treats an absent non-stateful parameter set as no current parameters', async () => {
    const resource = new class extends Resource<StatefulEmptyConfig> {
      getSettings(): ResourceSettings<StatefulEmptyConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            formulae: { type: 'stateful', definition: new EmptyArrayParameter(), order: 1 },
          },
        }
      }

      // The resource's own parameter refreshes to an empty array -> resource is absent.
      async refresh(): Promise<Partial<StatefulEmptyConfig> | null> {
        return { declarations: [] } as Partial<StatefulEmptyConfig>;
      }

      async create(): Promise<void> {}
      async destroy(): Promise<void> {}
    };

    const controller = new ResourceController(resource);
    const desired: Partial<StatefulEmptyConfig> = { declarations: ['a'], formulae: [] };

    const plan = await controller.plan({ type: 'type' }, desired, null, false);

    expect(plan.changeSet.operation).toBe(ResourceOperation.CREATE);
  })
})

interface StatefulEmptyConfig extends StringIndexedObject {
  formulae?: string[];
  casks?: string[];
  declarations?: string[];
  skipAlreadyInstalledCasks?: boolean;
}

class EmptyArrayParameter extends ArrayStatefulParameter<StatefulEmptyConfig, string> {
  async refresh(): Promise<string[] | null> {
    return [];
  }

  async addItem(): Promise<void> {}
  async removeItem(): Promise<void> {}
}

function createTestResource() {
  return new class extends TestResource {
    getSettings(): ResourceSettings<TestConfig> {
      return {
        id: 'type',
        operatingSystems: [OS.Darwin],
        parameterSettings: {
          propA: {
            default: 'defaultA'
          }
        }
      }
    }
  };
}
