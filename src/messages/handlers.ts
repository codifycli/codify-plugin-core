import {
  ApplyRequestDataSchema,
  EmptyResponseDataSchema,
  GetResourceInfoRequestDataSchema,
  GetResourceInfoResponseDataSchema,
  ImportRequestDataSchema,
  ImportResponseDataSchema,
  InitializeRequestDataSchema,
  InitializeResponseDataSchema,
  IpcMessage,
  IpcMessageSchema,
  IpcMessageV2,
  IpcMessageV2Schema,
  MatchRequestDataSchema,
  MatchResponseDataSchema,
  MessageStatus,
  PlanRequestDataSchema,
  PlanResponseDataSchema,
  ResourceSchema,
  SetVerbosityRequestDataSchema,
  ValidateRequestDataSchema,
  ValidateResponseDataSchema
} from '@codifycli/schemas';
import { Ajv, SchemaObject, ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

import { SudoError } from '../errors.js';
import { Plugin } from '../plugin/plugin.js';

const SupportedRequests: Record<string, { handler: (plugin: Plugin, data: any) => Promise<unknown>; requestValidator: SchemaObject; responseValidator: SchemaObject }> = {
  'initialize': {
    handler: async (plugin: Plugin, data: any) => plugin.initialize(data),
    requestValidator: InitializeRequestDataSchema,
    responseValidator: InitializeResponseDataSchema
  },
  'validate': {
    handler: async (plugin: Plugin, data: any) => plugin.validate(data),
    requestValidator: ValidateRequestDataSchema,
    responseValidator: ValidateResponseDataSchema
  },
  'getResourceInfo': {
    handler: async (plugin: Plugin, data: any) => plugin.getResourceInfo(data),
    requestValidator: GetResourceInfoRequestDataSchema,
    responseValidator: GetResourceInfoResponseDataSchema
  },
  'setVerbosityLevel': {
    async handler(plugin: Plugin, data: any) {
      await plugin.setVerbosityLevel(data)
      return null;
    },
    requestValidator: SetVerbosityRequestDataSchema,
    responseValidator: EmptyResponseDataSchema,
  },
  'match': {
    handler: async (plugin: Plugin, data: any) => plugin.match(data),
    requestValidator: MatchRequestDataSchema,
    responseValidator: MatchResponseDataSchema
  },
  'import': {
    handler: async (plugin: Plugin, data: any) => plugin.import(data),
    requestValidator: ImportRequestDataSchema,
    responseValidator: ImportResponseDataSchema
  },
  'plan': {
    handler: async (plugin: Plugin, data: any) => plugin.plan(data),
    requestValidator: PlanRequestDataSchema,
    responseValidator: PlanResponseDataSchema
  },
  'apply': {
    async handler(plugin: Plugin, data: any) {
      await plugin.apply(data);
      return null;
    },
    requestValidator: ApplyRequestDataSchema,
    responseValidator: EmptyResponseDataSchema
  },
}

export class MessageHandler {
  private ajv: Ajv;
  private readonly plugin: Plugin;
  private messageSchemaValidatorV1: ValidateFunction;
  private messageSchemaValidatorV2: ValidateFunction;
  private requestValidators: Map<string, ValidateFunction>;
  private responseValidators: Map<string, ValidateFunction>;

  constructor(plugin: Plugin) {
    this.ajv = new Ajv({ strict: true, strictRequired: false });
    addFormats.default(this.ajv);
    this.ajv.addSchema(ResourceSchema);
    this.plugin = plugin;

    this.messageSchemaValidatorV1 = this.ajv.compile(IpcMessageSchema);
    this.messageSchemaValidatorV2 = this.ajv.compile(IpcMessageV2Schema);

    this.requestValidators = new Map(
      Object.entries(SupportedRequests)
        .map(([k, v]) => [k, this.ajv.compile(v.requestValidator)])
    )
    this.responseValidators = new Map(
      Object.entries(SupportedRequests)
        .map(([k, v]) => [k, this.ajv.compile(v.responseValidator)])
    )
  }

  async onMessage(message: unknown): Promise<void> {
    try {
      if (!this.validateMessageV2(message) && !this.validateMessage(message)) {
        throw new Error(`Plugin: ${this.plugin}. Message is malformed: ${JSON.stringify(this.messageSchemaValidatorV1.errors, null, 2)}`);
      }

      if (!this.requestValidators.has(message.cmd)) {
        throw new Error(`Plugin: ${this.plugin}. Unsupported message: ${message.cmd}`);
      }

      const requestValidator = this.requestValidators.get(message.cmd)!;
      if (!requestValidator(message.data)) {
        throw new Error(`Plugin: ${this.plugin}. cmd: ${message.cmd}. Malformed message data: ${JSON.stringify(requestValidator.errors, null, 2)}`)
      }

      const result = await SupportedRequests[message.cmd].handler(this.plugin, message.data);

      const responseValidator = this.responseValidators.get(message.cmd);
      if (responseValidator && !responseValidator(result)) {
        throw new Error(`Plugin: ${this.plugin.name}. Malformed response data: ${JSON.stringify(responseValidator.errors, null, 2)}. Received ${JSON.stringify(result, null, 2)}`);
      }

      process.send!({
        cmd: message.cmd + '_Response',
        data: result,
        // @ts-expect-error TS2239
        requestId: message.requestId || undefined,
        status: MessageStatus.SUCCESS,
      })

    } catch (error: unknown) {
      this.handleErrors(message, error as Error);
    }
  }

  private validateMessage(message: unknown): message is IpcMessage {
    return this.messageSchemaValidatorV1(message);
  }

  private validateMessageV2(message: unknown): message is IpcMessageV2 {
    return this.messageSchemaValidatorV2(message);
  }

  private handleErrors(message: unknown, e: Error) {
    if (!message) {
      return;
    }

    if (!message.hasOwnProperty('cmd')) {
      return;
    }

    // @ts-expect-error TS2239
    const cmd = message.cmd + '_Response';

    if (e instanceof SudoError) {
      return process.send?.({
        cmd,
        // @ts-expect-error TS2239
        requestId: message.requestId || undefined,
        data: `Plugin: '${this.plugin.name}'. Forbidden usage of sudo for command '${e.command}'. Please contact the plugin developer to fix this.`,
        status: MessageStatus.ERROR,
      })
    }

    const isDebug = process.env.DEBUG?.includes('*') ?? false;

    process.send?.({
      cmd,
      // @ts-expect-error TS2239
      requestId: message.requestId || undefined,
      data: isDebug ? e.stack : e.message,
      status: MessageStatus.ERROR,
    })
  }
}
