import { describe, expect, it } from 'vitest';
import { OS, ParameterOperation, ResourceOperation } from 'codify-schemas';
import { TestConfig, TestResource, TestStatefulParameter } from '../utils/test-utils.test.js';
import { ResourceSettings } from './resource-settings.js';
import { ResourceController } from './resource-controller.js';


describe('Resource tests for stateful plans', () => {
  it('Supports delete operations ', async () => {
    const resource = new class extends TestResource {
      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          propA: 'propADifferent',
          propB: undefined,
          propC: 'propCDifferent',
        }
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      null,
      {
        propA: 'propA',
        propB: 10,
        propC: 'propC',
      }, true
    );

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.DESTROY,
        parameterChanges: [
          {
            name: "propA",
            previousValue: "propADifferent",
            newValue: null,
            operation: ParameterOperation.REMOVE
          },
          {
            name: 'propB',
            previousValue: null,
            newValue: null,
            operation: ParameterOperation.REMOVE
          },
          {
            name: "propC",
            previousValue: "propCDifferent",
            newValue: null,
            operation: ParameterOperation.REMOVE
          },
        ]
      },
      coreParameters: {
        type: 'type'
      }
    })
  })

  it('Supports create operations', async () => {
    const resource = new class extends TestResource {
      async refresh(): Promise<Partial<TestConfig> | null> {
        return null;
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'resource' },
      {
        propA: 'propA',
        propB: 10,
        propC: 'propC',
      },
      null,
      true
    );

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.CREATE,
        parameterChanges: [
          {
            name: "propA",
            newValue: "propA",
            previousValue: null,
            operation: ParameterOperation.ADD
          },
          {
            name: "propB",
            newValue: 10,
            previousValue: null,
            operation: ParameterOperation.ADD
          },
          {
            name: "propC",
            newValue: 'propC',
            previousValue: null,
            operation: ParameterOperation.ADD
          },
        ]
      },
      coreParameters: {
        type: 'resource'
      }
    })
  })

  it('Supports re-create operations', async () => {
    const resource = new class extends TestResource {
      async refresh(): Promise<Partial<TestConfig> | null> {
        return {
          propA: 'propA',
          propC: 'propC',
        };
      }
    }

    const controller = new ResourceController(resource)
    const plan = await controller.plan(
      { type: 'type' },
      {
        type: 'type',
        propA: 'propA',
        propB: 10,
        propC: 'propC',
      },
      {
        type: 'type',
        propA: 'propA',
        propC: 'propC'
      },
      true
    );

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.RECREATE,
        parameterChanges: expect.arrayContaining([
          {
            name: "propA",
            newValue: "propA",
            previousValue: "propA",
            operation: ParameterOperation.NOOP,
            isSensitive: false,

          },
          {
            name: "propB",
            newValue: 10,
            previousValue: null,
            operation: ParameterOperation.ADD,
            isSensitive: false,
          },
          {
            name: "propC",
            newValue: 'propC',
            previousValue: 'propC',
            operation: ParameterOperation.NOOP,
            isSensitive: false,
          },
        ])
      },
      coreParameters: {
        type: 'type'
      }
    })
  })

  it('Supports stateful parameters', async () => {
    const statefulParameter = new class extends TestStatefulParameter {
      async refresh(): Promise<string | null> {
        return null;
      }
    }

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propD: { type: 'stateful', definition: statefulParameter },
          }
        };
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {
          propA: 'propA',
          propC: 'propC',
          propB: undefined
        };
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      {
        propA: 'propA',
        propB: 10,
        propC: 'propC',
        propD: 'propD'
      },
      {
        propA: 'propA',
        propC: 'propC'
      },
      true
    );

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.RECREATE,
        parameterChanges: expect.arrayContaining([
          {
            name: "propA",
            newValue: "propA",
            previousValue: "propA",
            operation: ParameterOperation.NOOP,
            isSensitive: false,
          },
          {
            name: "propB",
            newValue: 10,
            previousValue: null,
            operation: ParameterOperation.ADD,
            isSensitive: false,
          },
          {
            name: "propC",
            newValue: 'propC',
            previousValue: 'propC',
            operation: ParameterOperation.NOOP,
            isSensitive: false,
          },
          {
            name: "propD",
            newValue: 'propD',
            previousValue: null,
            operation: ParameterOperation.ADD,
            isSensitive: false,
          },
        ])
      },
      coreParameters: {
        type: 'type'
      }
    })
  })
})
