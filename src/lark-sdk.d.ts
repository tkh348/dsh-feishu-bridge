declare module '@larksuiteoapi/node-sdk' {
  export const Domain: { Feishu: unknown; Lark: unknown }
  export const LoggerLevel: { info: unknown }

  export interface NormalizedMessage {
    messageId: string
    chatId: string
    chatType: 'p2p' | 'group'
    senderId: string
    content: string
    threadId?: string
    rootId?: string
    replyToMessageId?: string
  }

  export interface ChannelSink {
    append(text: string): Promise<unknown>
  }

  export interface LarkChannel {
    botIdentity?: { name?: string }
    connect(): Promise<void>
    disconnect(): Promise<void>
    send(chatId: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>
    stream(chatId: string, producer: { markdown(sink: ChannelSink): Promise<void> }, options?: Record<string, unknown>): Promise<unknown>
    on(event: 'message', listener: (message: NormalizedMessage) => void | Promise<void>): () => void
    on(event: 'reject', listener: (event: { reason: string }) => void): () => void
    on(event: 'error', listener: (error: unknown) => void): () => void
    on(event: 'reconnecting' | 'reconnected', listener: () => void): () => void
  }

  export function createLarkChannel(options: Record<string, unknown>): LarkChannel
}
