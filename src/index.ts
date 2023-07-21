import * as _ from 'lodash'
import { encode, encodeChat } from 'gpt-tokenizer'
import { RedisClientType } from 'redis'

import { ModelConfigs, OpenAIChatModel, OptionalModelConfigs, RateLimit } from "./config"
import * as SnowflakeId from './snowflakeId'
import { Snowflake } from './snowflakeId'

export type JanusAIConfig = {
  modelConfigs: OptionalModelConfigs
}

export type JanusAIValidator = {
}

export type ChatMessage = { 
  role: 'system' | 'user' | 'assistant' | undefined, 
  content: string 
}

export type DataObject = {
  id: Snowflake,
  type: 'input' | 'output',
  tokenCount: number,
  model: OpenAIChatModel,
  keyId: string
}

export enum RedisKey {
  INPUT_TOKENS,
  OUTPUT_TOKENS,
  REQUESTS
}

const DEFAULT_KEY_ID = 'default'

export type RegisterChatOptions = {
  model: OpenAIChatModel, 
  data: string | ChatMessage[], 
  keyId?: string
}

export function getKey(redisKey: RedisKey, model: OpenAIChatModel, keyId: string) {
  switch (redisKey) {
    case RedisKey.INPUT_TOKENS: return `input-tokens:${model}:${keyId}`
    case RedisKey.OUTPUT_TOKENS: return `output-tokens:${model}:${keyId}`
    case RedisKey.REQUESTS: return `requests:${model}:${keyId}`
  }
}

export class JanusAI {
  private config?: JanusAIConfig
  private modelConfigs: ModelConfigs
  private validators: JanusAIValidator[] = []
  private redis: RedisClientType

  // TODO - set this up so that there are per key rate limits
  constructor(redis: RedisClientType, config?: JanusAIConfig) {
    this.redis = redis
    this.config = config
    this.modelConfigs = config ? { ...ModelConfigs, ...config.modelConfigs } : ModelConfigs
  }

  private getTokenLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.token
  private getRequestLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.request

  private getTokens(data: string | ChatMessage[]) {
    return typeof data === 'string' ? encode(data) : encodeChat(data)
  }

  private async pruneAndCount(inputTokensKey: string, outputTokensKey: string, requestsKey: string, interval: 'minute' | 'second'): Promise<{ inputTokenCount: number, outputTokenCount: number, requestCount: number }> {
    const target = SnowflakeId.makeFromTime(new Date(new Date().getTime() - (1000 * (interval === 'minute' ? 60 : 1))))

    const results = await this.redis.multi()
      .zRemRangeByScore(inputTokensKey, '-inf', target)
      .zRemRangeByScore(outputTokensKey, '-inf', target)
      .zRemRangeByScore(requestsKey, '-inf', target)
      .zCard(inputTokensKey)
      .zCard(outputTokensKey)
      .zCard(requestsKey)
      .exec()

    return {
      inputTokenCount: results[3] as number,
      outputTokenCount: results[4] as number,
      requestCount: results[5] as number
    }
  }

  async registerChatInput(options: RegisterChatOptions): Promise<DataObject> {
    const { model, keyId = DEFAULT_KEY_ID, data } = options

    const inputTokensKey = getKey(RedisKey.INPUT_TOKENS, model, keyId)
    const outputTokensKey = getKey(RedisKey.OUTPUT_TOKENS, model, keyId)
    const requestsKey = getKey(RedisKey.REQUESTS, model, keyId)

    const tokens = this.getTokens(data)
    const tokenLimit = this.getTokenLimit(model)
    const requestLimit = this.getRequestLimit(model)
    
    const { inputTokenCount, outputTokenCount, requestCount} = await this.pruneAndCount(inputTokensKey, outputTokensKey, requestsKey, tokenLimit.interval)

    const currentTokenCount = inputTokenCount + outputTokenCount

    if (currentTokenCount + tokens.length > tokenLimit.count) throw new Error('Input will surpass token count rate limit.')
    if (requestCount + 1 > requestLimit.count) throw new Error('Request will surpass request count rate limit.')

    const id = SnowflakeId.next(0)
    const dataObject: DataObject = { id, type: 'input', tokenCount: tokens.length, model, keyId }

    let zAddCommand = ['ZADD', inputTokensKey]

    for (let token of tokens) {
      zAddCommand.push(id, token.toString(10))
    }

    await this.redis.sendCommand(zAddCommand)
    await this.redis.sendCommand(['ZADD', requestsKey, id, tokens.length.toString(10)])

    return dataObject
  }

  async registerChatOutput(options: RegisterChatOptions): Promise<DataObject> {
    const { model, keyId = DEFAULT_KEY_ID, data } = options
    const outputTokensKey = getKey(RedisKey.OUTPUT_TOKENS, model, keyId)

    const tokens = this.getTokens(data)

    const id = SnowflakeId.next(0)
    const dataObject: DataObject = { id, type: 'output', tokenCount: tokens.length, model, keyId }

    let zAddCommand = ['ZADD', outputTokensKey]

    for (let token of tokens) {
      zAddCommand.push(id, token.toString(10))
    }

    await this.redis.sendCommand(zAddCommand)

    return dataObject
  }

  async deregisterChatInput(dataObject: DataObject): Promise<void> {
    if (dataObject.type !== 'input') throw new Error('Can only deregister input data')

    const inputTokensKey = getKey(RedisKey.INPUT_TOKENS, dataObject.model, dataObject.keyId)
    const requestsKey = getKey(RedisKey.REQUESTS, dataObject.model, dataObject.keyId)

    await this.redis.zRemRangeByScore(inputTokensKey, dataObject.id, dataObject.id)
    await this.redis.zRemRangeByScore(requestsKey, dataObject.id, dataObject.id)
  }
}

export default JanusAI