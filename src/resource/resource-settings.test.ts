import { describe, expect, it } from 'vitest';
import { Plan } from '../plan/plan.js';
import { spy } from 'sinon';
import { OS, ParameterOperation, ResourceOperation } from 'codify-schemas';
import {
  TestArrayStatefulParameter,
  TestConfig,
  testPlan,
  TestResource,
  TestStatefulParameter
} from '../utils/test-utils.test.js';
import { ArrayParameterSetting, ParameterSetting, ResourceSettings } from './resource-settings.js';
import { ResourceController } from './resource-controller.js';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';

describe('Resource parameter tests', () => {
  it('Generates a resource plan that includes stateful parameters (create)', async () => {
    const statefulParameter = spy(new class extends TestStatefulParameter {
      async refresh(): Promise<string | null> {
        return null;
      }
    })

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameter }
          },
        };
      }

      async refresh(): Promise<any> {
        return null;
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      {
        propA: 'a',
        propB: 10
      },
      null,
      false
    )

    expect(statefulParameter.refresh.notCalled).to.be.true;
    expect(plan.currentConfig).to.be.null;
    expect(plan.desiredConfig).toMatchObject({
      propA: 'a',
      propB: 10
    })
    expect(plan.changeSet.operation).to.eq(ResourceOperation.CREATE);
  })

  it('supports the creation of stateful parameters', async () => {

    const statefulParameter = new class extends TestStatefulParameter {
      async refresh(): Promise<string | null> {
        return null;
      }
    }

    const statefulParameterSpy = spy(statefulParameter);

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterSpy }
          },
        }
      }
    }

    const controller = new ResourceController(resource);
    const resourceSpy = spy(resource);

    await controller.apply(
      testPlan<TestConfig>({
        desired: { propA: 'a', propB: 0, propC: 'c' }
      })
    );

    expect(statefulParameterSpy.add.calledOnce).to.be.true;
    expect(resourceSpy.create.calledOnce).to.be.true;
  })

  it('supports the modification of stateful parameters', async () => {
    const statefulParameter = new class extends TestStatefulParameter {
      async refresh(): Promise<string | null> {
        return 'b';
      }
    }

    const statefulParameterSpy = spy(statefulParameter);

    const resource = new class extends TestResource {

      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterSpy },
            propB: { canModify: true },
          }
        };
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return { propB: -1, propC: 'b' }
      }
    }

    const controller = new ResourceController(resource);

    const plan = await controller.plan(
      { type: 'type' },
      { propA: 'a', propB: 0, propC: 'b' },
      null,
      false
    )

    const resourceSpy = spy(resource);
    await controller.apply(plan);

    expect(statefulParameterSpy.modify.calledOnce).to.be.true;
    expect(resourceSpy.modify.calledOnce).to.be.true;
  })

  it('Allows stateful parameters to have default values', async () => {
    const statefulParameter = spy(new class extends TestStatefulParameter {
      getSettings(): ParameterSetting {
        return {
          default: 'abc',
          operatingSystems: [OS.Darwin],
        };
      }

      async refresh(): Promise<string | null> {
        return null;
      }
    });

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameter }
          },
        }
      }

      async refresh(): Promise<any> {
        return null;
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan({
      type: 'type',
    }, {}, null, false)

    expect(statefulParameter.refresh.notCalled).to.be.true;
    expect(plan.currentConfig).to.be.null;
    expect(plan.desiredConfig).toMatchObject({
      propA: 'abc',
    })
    expect(plan.changeSet.operation).to.eq(ResourceOperation.CREATE);
  })

  it('Filters array results in stateless mode to prevent modify from being called', async () => {
    const statefulParameter = new class extends TestStatefulParameter {
      getSettings(): ParameterSetting {
        return { type: 'array' }
      }

      async refresh(): Promise<any | null> {
        return ['a', 'b', 'c', 'd']
      }
    }

    const statefulParameterSpy = spy(statefulParameter);

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterSpy },
          },
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {};
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'type' }, { propA: ['a', 'b'] } as any, null, false)

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.NOOP,
      }
    })
  })

  it('Filters array results in stateless mode to prevent modify from being called 2', async () => {
    const statefulParameter = new class extends TestStatefulParameter {
      async refresh(): Promise<any | null> {
        return ['a', 'b']
      }
    }

    const statefulParameterSpy = spy(statefulParameter);

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterSpy }
          },
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {};
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'type' }, { propA: ['a', 'b', 'c', 'd'] } as any, null, false)

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.MODIFY,
      }
    })
  })

  it('Can accept a custom filter function to filter in stateless mode', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            hosts: {
              type: 'array',
              isElementEqual: 'object',
              filterInStatelessMode: (desired, current) => {
                return current.filter((d) => desired.some((c) => d.Host === c.Host))
              }
            }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          hosts: [
            {
              Host: '*',
              AddKeysToAgent: 'yes',
              IdentityFile: 'id_ed25519'
            },
            {
              Host: 'github.com',
              AddKeysToAgent: 'yes',
              UseKeychain: 'yes',
              IgnoreUnknown: 'UseKeychain',
              IdentityFile: '~/.ssh/id_ed25519',
            }
          ]
        }
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      {
        hosts: [
          {
            Host: 'new.com',
            AddKeysToAgent: 'yes',
            IdentityFile: '~/.ssh/id_ed25519'
          },
          {
            Host: 'github.com',
            AddKeysToAgent: 'yes',
            UseKeychain: 'yes',
          }
        ]
      },
      null,
      false
    );

    expect(plan).toMatchObject({
      'changeSet': {
        'operation': 'recreate',
        'parameterChanges': [
          {
            'name': 'hosts',
            'previousValue': [
              {
                'Host': 'github.com',
                'AddKeysToAgent': 'yes',
                'UseKeychain': 'yes',
                'IgnoreUnknown': 'UseKeychain',
                'IdentityFile': '~/.ssh/id_ed25519'
              }
            ],
            'newValue': [
              {
                'Host': 'new.com',
                'AddKeysToAgent': 'yes',
                'IdentityFile': '~/.ssh/id_ed25519'
              },
              {
                'Host': 'github.com',
                'AddKeysToAgent': 'yes',
                'UseKeychain': 'yes'
              }
            ],
            'operation': 'modify'
          }
        ]
      },
    })
  })

  it('Uses isElementEqual for stateless mode filtering if available', async () => {
    const statefulParameter = new class extends TestArrayStatefulParameter {
      getSettings(): ArrayParameterSetting {
        return {
          type: 'array',
          isElementEqual: (desired, current) => {
            return current.includes(desired)
          },
        }
      }

      async refresh(): Promise<any | null> {
        return ['3.11.9']
      }
    }

    const statefulParameterSpy = spy(statefulParameter);

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterSpy }
          },
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {};
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'type' }, { propA: ['3.11'] } as any, null, false)

    expect(plan).toMatchObject({
      changeSet: {
        operation: ResourceOperation.NOOP,
      }
    })
  })

  it('Plans stateful parameters in the order specified', async () => {
    const statefulParameterA = spy(new class extends TestStatefulParameter {
      async refresh(): Promise<any | null> {
        return performance.now()
      }
    });

    const statefulParameterB = spy(new class extends TestStatefulParameter {
      async refresh(): Promise<any | null> {
        return performance.now()
      }
    });

    const statefulParameterC = spy(new class extends TestStatefulParameter {
      async refresh(): Promise<any | null> {
        return performance.now()
      }
    });

    const statefulParameterD = spy(new class extends TestStatefulParameter {
      async refresh(): Promise<any | null> {
        return performance.now()
      }
    });

    const statefulParameterE = spy(new class extends TestStatefulParameter {
      async refresh(): Promise<any | null> {
        return performance.now()
      }
    });

    const resource = spy(new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterA, order: 3 },
            propB: { type: 'stateful', definition: statefulParameterB, order: 1 },
            propC: { type: 'stateful', definition: statefulParameterC, order: 2 },
            propD: { type: 'stateful', definition: statefulParameterD },
            propE: { type: 'stateful', definition: statefulParameterE }
          },
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {};
      }
    });

    const controller = new ResourceController(resource)
    const plan = await controller.plan(
      { type: 'resourceType' },
      {
        propA: 'propA',
        propB: 10,
        propC: 'propC',
        propD: 'propD',
        propE: 'propE',
      }, null,
      false
    );

    expect(plan.currentConfig?.propB).to.be.lessThan(plan.currentConfig?.propC as any);
    expect(plan.currentConfig?.propC).to.be.lessThan(plan.currentConfig?.propA as any);
    expect(plan.currentConfig?.propA).to.be.lessThan(plan.currentConfig?.propD as any);
    expect(plan.currentConfig?.propD).to.be.lessThan(plan.currentConfig?.propE as any);
  })

  it('Applies stateful parameters in the order specified', async () => {
    let timestampA;
    const statefulParameterA = spy(new class extends TestStatefulParameter {
      add = async (): Promise<void> => {
        timestampA = performance.now();
      }
      modify = async (): Promise<void> => {
        timestampA = performance.now();
      }
      remove = async (): Promise<void> => {
        timestampA = performance.now();
      }
    });

    let timestampB
    const statefulParameterB = spy(new class extends TestStatefulParameter {
      add = async (): Promise<void> => {
        timestampB = performance.now();
      }
      modify = async (): Promise<void> => {
        timestampB = performance.now();
      }
      remove = async (): Promise<void> => {
        timestampB = performance.now();
      }
    });

    let timestampC
    const statefulParameterC = spy(new class extends TestStatefulParameter {
      add = async (): Promise<void> => {
        timestampC = performance.now();
      }
      modify = async (): Promise<void> => {
        timestampC = performance.now();
      }
      remove = async (): Promise<void> => {
        timestampC = performance.now();
      }
    });

    const resource = spy(new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'stateful', definition: statefulParameterA, order: 3 },
            propB: { type: 'stateful', definition: statefulParameterB, order: 1 },
            propC: { type: 'stateful', definition: statefulParameterC, order: 2 },
          },
          removeStatefulParametersBeforeDestroy: true,
        }
      }
    });

    const controller = new ResourceController(resource);
    await controller.apply(
      Plan.fromResponse({
        resourceType: 'resourceType',
        operation: ResourceOperation.CREATE,
        parameters: [
          { name: 'propA', operation: ParameterOperation.ADD, previousValue: null, newValue: null },
          { name: 'propB', operation: ParameterOperation.ADD, previousValue: null, newValue: null },
          { name: 'propC', operation: ParameterOperation.ADD, previousValue: null, newValue: null },
        ],
        isStateful: false,
      }, {}) as any
    );

    if (!timestampB || !timestampC || !timestampA) {
      throw new Error('Variable not initialized')
    }

    expect(timestampB).to.be.lessThan(timestampC as any);
    expect(timestampC).to.be.lessThan(timestampA as any);
    timestampA = 0;
    timestampB = 0;
    timestampC = 0;

    await controller.apply(
      Plan.fromResponse({
        resourceType: 'resourceType',
        operation: ResourceOperation.MODIFY,
        parameters: [
          { name: 'propA', operation: ParameterOperation.MODIFY, previousValue: null, newValue: null },
          { name: 'propB', operation: ParameterOperation.MODIFY, previousValue: null, newValue: null },
          { name: 'propC', operation: ParameterOperation.MODIFY, previousValue: null, newValue: null },
        ],
        isStateful: false,
      }, {}) as any
    );

    expect(timestampB).to.be.lessThan(timestampC as any);
    expect(timestampC).to.be.lessThan(timestampA as any);
    timestampA = 0;
    timestampB = 0;
    timestampC = 0;

    await controller.apply(
      Plan.fromResponse({
        resourceType: 'resourceType',
        operation: ResourceOperation.DESTROY,
        parameters: [
          { name: 'propA', operation: ParameterOperation.REMOVE, previousValue: null, newValue: null },
          { name: 'propB', operation: ParameterOperation.REMOVE, previousValue: null, newValue: null },
          { name: 'propC', operation: ParameterOperation.REMOVE, previousValue: null, newValue: null },
        ],
        isStateful: false,
      }, {}) as any
    );

    expect(timestampB).to.be.lessThan(timestampC as any);
    expect(timestampC).to.be.lessThan(timestampA as any);
  })

  it('Supports transform parameters', async () => {
    const resource = spy(new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          transformation: {
            to: (desired) => ({
              propA: 'propA',
              propB: 10,
            }),
            from: (current) => ({
              propA: 'propA',
              propB: 10,
            })
          }
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {
          propA: 'propA',
          propB: 10,
        }
      }
    });

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'resourceType' }, { propC: 'abc' } as any, null, false);

    expect(resource.refresh.called).to.be.true;
    expect(resource.refresh.getCall(0).firstArg['propA']).to.exist;
    expect(resource.refresh.getCall(0).firstArg['propB']).to.exist;
    expect(resource.refresh.getCall(0).firstArg['propC']).to.not.exist;

    expect(plan.desiredConfig?.propA).to.eq('propA');
    expect(plan.desiredConfig?.propB).to.eq(10);
    expect(plan.desiredConfig?.propC).to.be.undefined;

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Supports transform parameters for state parameters', async () => {
    const resource = spy(new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          transformation: {
            to: (desired) => ({
              propA: 'propA',
              propB: 10,
            }),
            from: (desired) => ({
              propA: 'propA',
              propB: 10,
            })
          }
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        return {
          propA: 'propA',
          propB: 10,
        }
      }
    });

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'resourceType' }, null, { propC: 'abc' }, true);

    expect(resource.refresh.called).to.be.true;
    expect(resource.refresh.getCall(0).firstArg['propA']).to.exist;
    expect(resource.refresh.getCall(0).firstArg['propB']).to.exist;
    expect(resource.refresh.getCall(0).firstArg['propC']).to.not.exist;

    expect(plan.currentConfig?.propA).to.eq('propA');
    expect(plan.currentConfig?.propB).to.eq(10);
    expect(plan.currentConfig?.propC).to.be.undefined;
  })

  it('Allows import required parameters customization', () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          importAndDestroy: {
            requiredParameters: [
              'propA',
              'propB',
            ]
          }
        }
      }
    };
  })

  it('Applies default input transformations', async () => {
    const home = os.homedir()
    const testPath = path.join(home, 'test/folder');

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'directory' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return { propA: testPath }
      }
    };

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'resourceType' }, { propA: '~/test/folder' } as any, null, false);

    expect(plan.changeSet.parameterChanges[0]).toMatchObject({
      operation: ParameterOperation.NOOP,
      newValue: testPath,
      previousValue: testPath,
    })
    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Ignores setting parameters when planning', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'string', setting: true },
            propB: { type: 'number' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return { propB: 64 }
      }
    };

    const controller = new ResourceController(resource);
    const plan = await controller.plan({ type: 'resourceType' }, { propA: 'setting', propB: 64 } as any, null, false);

    expect(plan.changeSet.parameterChanges).toMatchObject(
      expect.arrayContaining([
        {
          name: 'propA',
          operation: ParameterOperation.NOOP,
          previousValue: null,
          newValue: 'setting',
          isSensitive: false,
        },
        {
          name: 'propB',
          operation: ParameterOperation.NOOP,
          previousValue: 64,
          newValue: 64,
          isSensitive: false,
        }
      ])
    )

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Accepts an input parameters for imports', () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          importAndDestroy: {
            requiredParameters: ['propA'],
            refreshKeys: ['propB', 'propA'],
            defaultRefreshValues: {
              propB: 6,
            }
          }
        }
      }
    };
  })

  it('Accepts a string isEqual method which selects from one of the defaults', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'string', isEqual: 'version' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          propA: '10.0.0'
        }
      }
    };

    const controller = new ResourceController(resource);

    const result = await controller.plan({ type: 'resourceType' }, { propA: '10.0' }, null, false);
    expect(result.changeSet).toMatchObject({
      operation: ResourceOperation.NOOP,
    })
  });

  it('Object equals method (works when equal)', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propD: { type: 'object' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          propD: {
            testA: 'a',
            testB: 'b',
            testC: 10,
          }
        }
      }
    };

    const controller = new ResourceController(resource);

    const result = await controller.plan(
      { type: 'resourceType' },
      {
        propD: {
          testC: 10,
          testA: 'a',
          testB: 'b',
        }
      },
      null,
      false
    );

    expect(result.changeSet).toMatchObject({
      operation: ResourceOperation.NOOP,
    })
  });

  it('Object equals method (works when not equal)', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propD: { type: 'object' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          propD: {
            testA: 'a',
            testB: 'b',
          }
        }
      }
    };

    const controller = new ResourceController(resource);

    const result = await controller.plan(
      { type: 'resourceType' },
      {
        propD: {
          testC: 10,
          testA: 'a',
          testB: 'b',
        }
      },
      null,
      false
    );

    expect(result.changeSet).toMatchObject({
      operation: ResourceOperation.RECREATE,
    })
  });

  it('Transforms input parameters', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propD: {
              type: 'array',
              transformation: {
                to: (hosts: Record<string, unknown>[]) => hosts.map((h) => Object.fromEntries(
                    Object.entries(h)
                      .map(([k, v]) => [
                        k,
                        typeof v === 'boolean'
                          ? (v ? 'yes' : 'no') // The file takes 'yes' or 'no' instead of booleans
                          : v,
                      ])
                  )
                ),
                from: (hosts: Record<string, unknown>[]) => hosts.map((h) => Object.fromEntries(
                  Object.entries(h)
                    .map(([k, v]) => [
                      k,
                      v === 'yes',
                    ])
                ))
              }
            }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        expect(parameters.propD[0].AddKeysToAgent).to.eq('yes')
        expect(parameters.propD[1].AddKeysToAgent).to.eq('yes')
        expect(parameters.propD[1].UseKeychain).to.eq('yes')
        expect(parameters.propD[2].PasswordAuthentication).to.eq('yes')

        return null;
      }
    }

    const controller = new ResourceController(resource);
    await controller.plan(
      { type: 'resourceType' },
      {
      propD: [
        {
          Host: 'new.com',
          AddKeysToAgent: true,
          IdentityFile: 'id_ed25519'
        },
        {
          Host: 'github.com',
          AddKeysToAgent: true,
          UseKeychain: true,
        },
        {
          Match: 'User bob,joe,phil',
          PasswordAuthentication: true,
        }
      ]
      },
      null,
      false
    );

  })

  it('Transforms input parameters for stateful parameters', async () => {
    const sp = new class extends TestStatefulParameter {
      getSettings(): any {
        return {
          type: 'array',
          transformation: {
            to: (hosts: Record<string, unknown>[]) => hosts.map((h) => Object.fromEntries(
                Object.entries(h)
                  .map(([k, v]) => [
                    k,
                    typeof v === 'boolean'
                      ? (v ? 'yes' : 'no') // The file takes 'yes' or 'no' instead of booleans
                      : v,
                  ])
              )
            ),
            from: (hosts: Record<string, unknown>[]) => hosts.map((h) => Object.fromEntries(
              Object.entries(h)
                .map(([k, v]) => [
                  k,
                  v === 'yes',
                ])
            ))
          }
        }
      }

      async refresh(desired: any): Promise<any | null> {
        expect(desired[0].AddKeysToAgent).to.eq('yes')
        expect(desired[1].AddKeysToAgent).to.eq('yes')
        expect(desired[1].UseKeychain).to.eq('yes')
        expect(desired[2].PasswordAuthentication).to.eq('yes')

        return null;
      }
    }

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propD: { type: 'stateful', definition: sp }
          }
        }
      }
    }

    const controller = new ResourceController(resource);
    await controller.plan(
      { type: 'resourceType' },
      {
        propD: [
          {
            Host: 'new.com',
            AddKeysToAgent: true,
            IdentityFile: 'id_ed25519'
          },
          {
            Host: 'github.com',
            AddKeysToAgent: true,
            UseKeychain: true,
          },
          {
            Match: 'User bob,joe,phil',
            PasswordAuthentication: true,
          }
        ]
      },
      null,
      false
    );

  })

  it('Supports equality check for itemType', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'array', itemType: 'version' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          propA: ['10.0.0']
        }
      }
    };

    const controller = new ResourceController(resource);

    const result = await controller.plan({ type: 'resourceType' }, { propA: ['10.0'] }, null, false);
    expect(result.changeSet).toMatchObject({
      operation: ResourceOperation.NOOP,
    })
  })

  it('Supports transformations for itemType', async () => {
    const home = os.homedir()
    const testPath = path.join(home, 'test/folder');

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'array', itemType: 'directory' }
          }
        }
      }

      async refresh(parameters: Partial<TestConfig>): Promise<Partial<TestConfig> | null> {
        return {
          propA: [testPath]
        }
      }
    };

    const controller = new ResourceController(resource);

    const result = await controller.plan({ type: 'resourceType' }, { propA: ['~/test/folder'] }, null, false);
    expect(result.changeSet).toMatchObject({
      operation: ResourceOperation.NOOP,
    })
  })

  it('Supports matching using the identfying parameters', async () => {
    const home = os.homedir()
    const testPath = path.join(home, 'test/folder');

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'array', itemType: 'directory' }
          },
          allowMultiple: {
            identifyingParameters: ['propA']
          }
        }
      }
    };

    const controller = new ResourceController(resource);
    expect(controller.parsedSettings.matcher({
      propA: [testPath],
      propB: 'random1',
    }, {
      propA: [testPath],
      propB: 'random2',
    })).to.be.true;

    expect(controller.parsedSettings.matcher({
      propA: [testPath],
      propB: 'random1',
    }, {
      propA: [testPath, testPath],
      propB: 'random2',
    })).to.be.false;
  })

  it('Supports matching using custom matcher', async () => {
    const home = os.homedir()
    const testPath = path.join(home, 'test/folder');

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'array', itemType: 'directory' }
          },
          allowMultiple: {
            identifyingParameters: ['propA'],
            matcher: () => false,
          }
        }
      }
    };

    const controller = new ResourceController(resource);
    expect(controller.parsedSettings.matcher({
      propA: [testPath],
      propB: 'random1',
    }, {
      propA: [testPath],
      propB: 'random2',
    })).to.be.false;
  })

  it('Can match directories 1', async () => {
    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'resourceType',
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'directory' }
          },
        }
      }
    };

    const controller = new ResourceController(resource);
    const transformations = controller.parsedSettings.inputTransformations.propA;

    const to = transformations!.to('$HOME/abc/def')
    expect(to).to.eq(os.homedir() + '/abc/def')

    const from = transformations!.from(os.homedir() + '/abc/def')
    expect(from).to.eq('~/abc/def')

    const from2 = transformations!.from(os.homedir() + '/abc/def', '$HOME/abc/def')
    expect(from2).to.eq('$HOME/abc/def')

  })

  it('Can match directories 2', async () => {

    const schema = z.object({
      propA: z.string(),
      propB: z.number(),
    });

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<z.infer<typeof schema>> {
        return {
          id: 'resourceType',
          schema,
          operatingSystems: [OS.Darwin],
          parameterSettings: {
            propA: { type: 'directory' }
          },
        }
      }
    };

    const controller = new ResourceController(resource);
    const transformations = controller.parsedSettings.inputTransformations.propA;

    const to = transformations!.to('$HOME/abc/def')
    expect(to).to.eq(os.homedir() + '/abc/def')

    const from = transformations!.from(os.homedir() + '/abc/def')
    expect(from).to.eq('~/abc/def')

    const from2 = transformations!.from(os.homedir() + '/abc/def', '$HOME/abc/def')
    expect(from2).to.eq('$HOME/abc/def')

  })

})
