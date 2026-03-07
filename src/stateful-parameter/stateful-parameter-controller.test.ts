import { describe, expect, it } from 'vitest';
import { spy } from 'sinon';
import { ParameterOperation, ResourceOperation } from '@codifycli/schemas';
import {
  TestArrayStatefulParameter,
  TestConfig,
  testPlan,
  TestResource,
  TestStatefulParameter
} from '../utils/test-utils.test.js';
import { ArrayParameterSetting, ParameterSetting, ResourceSettings } from '../resource/resource-settings.js';
import { ResourceController } from '../resource/resource-controller.js';
import { StatefulParameterController } from './stateful-parameter-controller.js';

describe('Stateful parameter tests', () => {
  it('addItem is called the correct number of times', async () => {
    const plan = testPlan<TestConfig>({
      desired: { propZ: ['a', 'b', 'c'] },
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.CREATE);
    expect(plan.changeSet.parameterChanges.length).to.eq(1);

    const parameter = spy(new TestArrayStatefulParameter());
    const controller = new StatefulParameterController(parameter);
    await controller.add((plan.desiredConfig! as any).propZ, plan);

    expect(parameter.addItem.callCount).to.eq(3);
    expect(parameter.removeItem.called).to.be.false;
  })

  it('applyRemoveItem is called the correct number of times', async () => {
    const plan = testPlan<TestConfig>({
      desired: null,
      current: [{ propZ: ['a', 'b', 'c'] }],
      state: { propZ: ['a', 'b', 'c'] },
      isStateful: true,
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.DESTROY);
    expect(plan.changeSet.parameterChanges.length).to.eq(1);

    const parameter = spy(new TestArrayStatefulParameter());
    const controller = new StatefulParameterController(parameter);
    await controller.remove((plan.currentConfig as any).propZ, plan);

    expect(parameter.addItem.called).to.be.false;
    expect(parameter.removeItem.callCount).to.eq(3);
  })

  it('In stateless mode only applyAddItem is called only for modifies', async () => {
    const parameter = new TestArrayStatefulParameter()
    const plan = testPlan<TestConfig>({
      desired: { propZ: ['a', 'c', 'd', 'e', 'f'] }, // b to remove, d, e, f to add
      current: [{ propZ: ['a', 'b', 'c'] }],
      settings: { id: 'type', parameterSettings: { propZ: { type: 'stateful', definition: parameter } } },
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.MODIFY);
    expect(plan.changeSet.parameterChanges[0]).toMatchObject({
      name: 'propZ',
      previousValue: ['c', 'a'], // In stateless mode the previous value gets filtered to prevent deletes
      newValue: ['a', 'c', 'd', 'e', 'f'],
      operation: ParameterOperation.MODIFY,
    })


    const testParameter = spy(parameter);
    const controller = new StatefulParameterController(testParameter);
    await controller.modify((plan.desiredConfig as any).propZ, (plan.currentConfig as any).propZ, plan);

    expect(testParameter.addItem.calledThrice).to.be.true;
    expect(testParameter.removeItem.called).to.be.false;
  })

  it('isElementEqual is called for modifies', async () => {
    const testParameter = spy(new class extends TestArrayStatefulParameter {
      getSettings(): ArrayParameterSetting {
        return {
          type: 'array',
          isElementEqual: (desired, current) => current.includes(desired),
        }
      }
    });

    const plan = testPlan<TestConfig>({
      desired: { propZ: ['9.12', '9.13'] }, // b to remove, d, e, f to add
      current: [{ propZ: ['9.12.9'] }],
      settings: { id: 'type', parameterSettings: { propZ: { type: 'stateful', definition: testParameter } } }
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.MODIFY);
    expect(plan.changeSet.parameterChanges[0]).toMatchObject({
      name: 'propZ',
      previousValue: ['9.12.9'],
      newValue: ['9.12', '9.13'],
      operation: ParameterOperation.MODIFY,
    })

    const controller = new StatefulParameterController(testParameter);
    await controller.modify((plan.desiredConfig as any).propZ, (plan.currentConfig as any).propZ, plan);

    expect(testParameter.addItem.calledOnce).to.be.true;
    expect(testParameter.removeItem.called).to.be.false;
  })

  it('isEqual works with type defaults', () => {
    const testParameter = spy(new class extends TestStatefulParameter {
      getSettings(): ParameterSetting {
        return {
          type: 'version',
        }
      }
    });

    const plan = testPlan<TestConfig>({
      desired: { propZ: '20' },
      current: [{ propZ: '20.17.0' }],
      settings: { id: 'type', parameterSettings: { propZ: { type: 'stateful', definition: testParameter } } }
    });

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('isElementEquals test', async () => {
    const testParameter = spy(new class extends TestArrayStatefulParameter {
      getSettings(): ArrayParameterSetting {
        return {
          type: 'array',
          isElementEqual: (desired, current) => current.includes(desired),
        }
      }

      async refresh(): Promise<any> {
        return [
          '20.15.0',
          '20.15.1'
        ]
      }
    });

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          parameterSettings: { nodeVersions: { type: 'stateful', definition: testParameter } }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return {};
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      { nodeVersions: ['20.15'] } as any,
      null,
      false
    )

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Accepts a string equals value', async () => {
    const testParameter = spy(new class extends TestStatefulParameter {
      getSettings(): ParameterSetting {
        return {
          type: 'string',
          isEqual: 'version'
        }
      }

      async refresh(): Promise<any> {
        return '20.15.0';
      }
    });

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          parameterSettings: { propA: { type: 'stateful', definition: testParameter } }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return {};
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      { propA: '20.15', } as any,
      null,
      false
    )

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })

  it('Accepts a string isElementEquals value', async () => {
    const testParameter = spy(new class extends TestStatefulParameter {
      getSettings(): ParameterSetting {
        return {
          type: 'array',
          isElementEqual: 'version'
        }
      }

      async refresh(): Promise<any> {
        return [
          '20.15.0',
          '20.18.0'
        ]
      }
    });

    const resource = new class extends TestResource {
      getSettings(): ResourceSettings<any> {
        return {
          id: 'type',
          parameterSettings: { propA: { type: 'stateful', definition: testParameter } }
        }
      }

      async refresh(): Promise<Partial<any> | null> {
        return {};
      }
    }

    const controller = new ResourceController(resource);
    const plan = await controller.plan(
      { type: 'type' },
      { propA: ['20.15', '20.18'] } as any,
      null,
      false
    )

    expect(plan.changeSet.operation).to.eq(ResourceOperation.NOOP);
  })
})
