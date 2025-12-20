import { describe, expect, it, vitest } from 'vitest';
import { TestConfig, TestResource } from '../utils/test-utils.test.js';
import { getPty, IPty } from './index.js';
import { Plugin } from '../plugin/plugin.js'
import { CreatePlan } from '../plan/plan-types.js';
import { OS, ResourceOperation } from 'codify-schemas';
import { ResourceSettings } from '../resource/resource-settings.js';
import { SequentialPty } from './seqeuntial-pty.js';

describe('General tests for PTYs', () => {
  it('Can get pty within refresh', async () => {
    const testResource = new class extends TestResource {
      async refresh(): Promise<Partial<TestConfig> | null> {
        const $ = getPty();
        const lsResult = await $.spawnSafe('ls');

        expect(lsResult.exitCode).to.eq(0);
        expect(lsResult.data).to.be.not.null;
        expect(lsResult.status).to.eq('success');

        return {};
      }
    }

    const spy = vitest.spyOn(testResource, 'refresh')

    const plugin = Plugin.create('test plugin', [testResource])
    const plan = await plugin.plan({
      core: { type: 'type' },
      desired: {},
      state: undefined,
      isStateful: false,
    })

    expect(plan).toMatchObject({
      operation: 'noop',
      resourceType: 'type',
    })
    expect(spy).toHaveBeenCalledOnce()
  })

  it('The same pty instance is shared cross multiple resources', async () => {
    let pty1: IPty;
    let pty2: IPty;

    const testResource1 = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type1',
          operatingSystems: [OS.Darwin],
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        const $ = getPty();
        const lsResult = await $.spawnSafe('ls');

        expect(lsResult.exitCode).to.eq(0);
        pty1 = $;

        return {};
      }
    }

    const testResource2 = new class extends TestResource {
      getSettings(): ResourceSettings<TestConfig> {
        return {
          id: 'type2',
          operatingSystems: [OS.Darwin],
        }
      }

      async refresh(): Promise<Partial<TestConfig> | null> {
        const $ = getPty();
        const pwdResult = await $.spawnSafe('pwd');

        expect(pwdResult.exitCode).to.eq(0);
        pty2 = $;

        return {};
      }
    }

    const spy1 = vitest.spyOn(testResource1, 'refresh')
    const spy2 = vitest.spyOn(testResource2, 'refresh')

    const plugin = Plugin.create('test plugin', [testResource1, testResource2]);
    await plugin.plan({
      core: { type: 'type1' },
      desired: {},
      state: undefined,
      isStateful: false,
    })

    await plugin.plan({
      core: { type: 'type2' },
      desired: {},
      state: undefined,
      isStateful: false,
    })

    expect(spy1).toHaveBeenCalledOnce();
    expect(spy2).toHaveBeenCalledOnce();

    // The main check here is that the refresh method for both are sharing the same pty instance.
    expect(pty1).to.eq(pty2);
  })

  it('Sequential pty should be available for applies', async () => {
    const testResource = new class extends TestResource {
      create(plan: CreatePlan<TestConfig>): Promise<void> {
        const $ = getPty();
        expect($).to.instanceof(SequentialPty)
      }
    }

    const spy = vitest.spyOn(testResource, 'create')

    const plugin = Plugin.create('test plugin', [testResource])
    await plugin.apply({
      plan: {
        operation: ResourceOperation.CREATE,
        resourceType: 'type',
        parameters: [],
      }
    })
    expect(spy).toHaveBeenCalledOnce()
  })
})
