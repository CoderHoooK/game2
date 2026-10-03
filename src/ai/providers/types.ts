export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
export interface Provider {
  name: string;
  complete(messages: ChatMessage[]): Promise<string>;
}
