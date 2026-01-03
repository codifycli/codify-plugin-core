import { MessageHandler } from './handlers.js';
import { Plugin } from '../plugin/plugin.js';
import { describe, expect, it } from 'vitest';
import { mock } from 'vitest-mock-extended'
import { Resource } from '../resource/resource.js';
import { MessageStatus, ResourceOperation } from 'codify-schemas';
import { TestResource } from '../utils/test-utils.test.js';

describe('Message handler tests', () => {
  it('handles plan requests', async () => {
    const plugin = mock<Plugin>();
    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'plan_Response',
        status: MessageStatus.SUCCESS,
      });

      return true;
    }

    // Message handler also validates the response. That part does not need to be tested
    try {
      await handler.onMessage({
        cmd: 'plan',
        data: {
          core: {
            type: 'resourceType',
            name: 'name',
          },
          desired: {
            prop1: 'A',
            prop2: 'B',
          },
          isStateful: false,
        }
      })
    } catch (e) {}

    expect(plugin.plan.mock.calls.length).to.eq(1);
    process.send = undefined;
  })

  it('rejects bad plan requests', async () => {
    const plugin = mock<Plugin>();
    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'plan_Response',
        status: MessageStatus.ERROR,
      });

      return true;
    }

    // Message handler also validates the response. That part does not need to be tested
    try {
      await handler.onMessage({
        cmd: 'plan',
        data: {
          name: '1name',
          prop1: 'A',
          prop2: 'B',
        }
      })
    } catch (e) {
      console.log(e);
    }

    expect(plugin.plan.mock.calls.length).to.eq(0);
    process.send = undefined;
  })

  it('handles apply requests', async () => {
    const plugin = mock<Plugin>();
    const handler = new MessageHandler(plugin);

    // Message handler also validates the response. That part does not need to be tested
    try {
      await handler.onMessage({
        cmd: 'apply',
        data: {
          planId: '1803fff7-a378-4006-95bb-7c97cba02c82'
        }
      })
    } catch (e) {}

    expect(plugin.apply.mock.calls.length).to.be.eq(1);
  })

  it('rejects bad apply requests', async () => {
    const plugin = mock<Plugin>();
    const handler = new MessageHandler(plugin);

    // Message handler also validates the response. That part does not need to be tested
    try {
      await handler.onMessage({
        cmd: 'apply',
        data: {}
      })
    } catch (e) {}

    expect(plugin.apply.mock.calls.length).to.be.eq(0);
  })

  it('handles validate requests', async () => {
    const plugin = mock<Plugin>();
    const handler = new MessageHandler(plugin);

    // Message handler also validates the response. That part does not need to be tested
    try {
      await handler.onMessage({
        cmd: 'validate',
        data: {
          configs: [
            {
              type: 'type1',
              name: 'name1'
            },
            {
              type: 'type2',
              name: 'name2'
            },
            {
              type: 'type2',
              name: 'name3'
            }
          ]
        }
      })
    } catch (e) {}

    expect(plugin.validate.mock.calls.length).to.eq(1);
  })

  it('rejects bad validate requests', async () => {
    const plugin = mock<Plugin>();
    const handler = new MessageHandler(plugin);

    process.send = () => true;

    // Message handler also validates the response. That part does not need to be tested
    // This should not throw
    expect(await handler.onMessage({
      cmd: 'validate',
      data: {}
    })).to.eq(undefined);

    expect(plugin.apply.mock.calls.length).to.be.eq(0);
  })

  it('handles errors for plan', async () => {
    const resource = new TestResource()
    const plugin = testPlugin(resource);

    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'plan_Response',
        status: MessageStatus.ERROR,
        data: 'Refresh error',
      })
      return true;
    }

    expect(async () => await handler.onMessage({
      cmd: 'plan',
      data: {
        core: {
          type: 'resourceA',
        },
        desired: {
          type: 'resourceA'
        },
        isStateful: false,
      }
    })).rejects.to.not.throw;

    process.send = undefined;
  })

  it('handles errors for apply (create)', async () => {
    const resource = new TestResource()
    const plugin = testPlugin(resource);

    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'apply_Response',
        status: MessageStatus.ERROR,
      })
      return true;
    }

    expect(async () => await handler.onMessage({
      cmd: 'apply',
      data: {
        plan: {
          resourceType: 'resourceA',
          operation: ResourceOperation.CREATE,
          parameters: []
        }
      }
    })).rejects.to.not.throw;
  })

  it('handles errors for apply (destroy)', async () => {
    const resource = new TestResource()
    const plugin = testPlugin(resource);
    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'apply_Response',
        status: MessageStatus.ERROR,
      })
      return true;
    }

    expect(async () => await handler.onMessage({
      cmd: 'apply',
      data: {
        plan: {
          resourceType: 'resourceA',
          operation: ResourceOperation.DESTROY,
          parameters: []
        }
      }
    })).rejects.to.not.throw;

    process.send = undefined;
  })

  it('handles changing the verbosity level', async () => {
    const resource = new TestResource()
    const plugin = testPlugin(resource);
    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'setVerbosityLevel_Response',
        status: MessageStatus.SUCCESS,
      })
      return true;
    }

    expect(async () => await handler.onMessage({
      cmd: 'setVerbosityLevel',
      data: {
        verbosityLevel: 2,
      }
    })).rejects.to.not.throw;

    process.send = undefined;
  })

  it('Supports ipc message v2 (success)', async () => {
    const resource = new TestResource()
    const plugin = testPlugin(resource);
    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      console.log(message)
      expect(message).toMatchObject({
        cmd: 'plan_Response',
        requestId: 'abcdef',
        status: MessageStatus.SUCCESS,
      })
      return true;
    }

    await expect(handler.onMessage({
      cmd: 'plan',
      requestId: 'abcdef',
      data: {
        core: {
          type: 'type',
          name: 'name',
        },
        desired: {
          prop1: 'A',
          prop2: 'B',
        },
        isStateful: false,
      }
    })).resolves.to.eq(undefined);

    process.send = undefined;
  })

  it('Supports ipc message v2 (error)', async () => {
    const resource = new TestResource()
    const plugin = testPlugin(resource);
    const handler = new MessageHandler(plugin);

    process.send = (message) => {
      expect(message).toMatchObject({
        cmd: 'apply_Response',
        requestId: 'abcdef',
        status: MessageStatus.ERROR,
      })
      return true;
    }

    await expect(handler.onMessage({
      cmd: 'apply', // Supposed to be a plan so that's why it throws
      requestId: 'abcdef',
      data: {
        desired: {
          type: 'type',
          name: 'name',
          prop1: 'A',
          prop2: 'B',
        },
        isStateful: false,
      }
    })).resolves.to.eq(undefined);

    process.send = undefined;
  })
});

function testPlugin(resource: Resource<any>) {
  return Plugin.create('plugin', [resource])
}
