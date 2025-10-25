import { Ajv } from 'ajv';
import { IpcMessageV2, IpcMessageV2Schema, MessageCmd, PressKeyToContinueRequestData } from 'codify-schemas';
import { nanoid } from 'nanoid';

const ajv = new Ajv({
  strict: true,
});

/**
 * Send requests to the Codify CLI
 */
class CodifyCliSenderImpl {
  private readonly validateIpcMessageV2 = ajv.compile(IpcMessageV2Schema);

  async requestPressKeyToContinuePrompt(message?: string): Promise<void> {
    await this.sendAndWaitForResponse(<IpcMessageV2>{
      cmd: MessageCmd.PRESS_KEY_TO_CONTINUE_REQUEST,
      data: <PressKeyToContinueRequestData>{
        promptMessage: message,
      }
    })
  }

  async getCodifyCliCredentials(): Promise<string> {
    const data = await this.sendAndWaitForResponse(<IpcMessageV2>{
      cmd: MessageCmd.CODIFY_CREDENTIALS_REQUEST,
      data: {},
    })

    if (typeof data.data !== 'string') {
      throw new Error('Expected string back from credentials request');
    }

    return data.data;
  }

  private async sendAndWaitForResponse(message: IpcMessageV2): Promise<IpcMessageV2> {
    return new Promise((resolve) => {
      const requestId = nanoid(8);
      const listener = (data: IpcMessageV2) => {
        if (data.requestId === requestId) {
          process.removeListener('message', listener);

          if (!this.validateIpcMessageV2(data)) {
            throw new Error(`Invalid response for request.
Request:                        
${JSON.stringify(message, null, 2)}
Response:
${JSON.stringify(data, null, 2)}
Error:
${JSON.stringify(this.validateIpcMessageV2.errors, null, 2)}`);
          }

          resolve(data);
        }
      }

      process.on('message', listener);

      const ipcMessage = {
        ...message,
        requestId,
      }
      process.send!(ipcMessage)
    })
  }
}

export const CodifyCliSender = new CodifyCliSenderImpl();
