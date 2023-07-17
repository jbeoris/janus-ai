import * as _ from 'lodash'
import { ModelConfigs, OpenAIChatModel, OptionalModelConfigs, RateLimit } from "./config"

export type JanusAIConfig = {
  modelConfigs: OptionalModelConfigs
}
export type JanusAIValidator = {
}

export type ChatMessage = { role: string, content: string }

export class JanusAI {
  private config?: JanusAIConfig
  private modelConfigs: ModelConfigs
  private validators: JanusAIValidator[] = []

  constructor(config?: JanusAIConfig) {
    this.config = config
    this.modelConfigs = config ? { ...ModelConfigs, ...config.modelConfigs } : ModelConfigs
  }

  getTokenLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.token
  getRequestLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.request

  /**
   * @param model - string model name
   * @param chat - chat history
   * @param key used if cycling multiple keys (default 0)
   */
  registerChatInput(model: OpenAIChatModel, chat: ChatMessage[], key: number = 0) {

  }
}

export default JanusAI