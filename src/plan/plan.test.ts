import { describe, expect, it } from 'vitest';
import { Plan } from './plan.js';
import { OS, ParameterOperation, ResourceOperation } from 'codify-schemas';
import { TestConfig, TestResource } from '../utils/test-utils.test.js';
import { ResourceController } from '../resource/resource-controller.js';
import { ParsedResourceSettings } from '../resource/parsed-resource-settings.js';
import { ResourceSettings } from '../resource/resource-settings.js';

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
})

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
