import * as _ from 'lodash'
import { RedisClientType } from 'redis'
import * as OpenAIChatTokens from 'openai-chat-tokens'

import { ModelConfigs, OpenAIChatModel, OptionalModelConfigs, DefaultModelConfigs, RateLimit } from "./config"
import * as SnowflakeId from './snowflakeId'
import { Snowflake } from './snowflakeId'

export type JanusAIConfig = {
  modelConfigs: ModelConfigs
}

export type JanusAIOptions = {
  customLimits?: OptionalModelConfigs
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
  data: { messages: ChatMessage[], functions?: any[] } , 
  keyId?: string
}

interface OuputInnerData { 
  content?: string, 
  function_call?: { 
    arguments?: string, 
    name?: string 
  } 
} 

interface StandardOutputChoice { message: OuputInnerData }
interface StreamOutputChoice { delta: OuputInnerData }

export type RegisterOutputOptions = {
  type: 'standard' | 'stream',
  model: OpenAIChatModel, 
  data: { 
    choices: StandardOutputChoice[] | StreamOutputChoice[]
  } , 
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
  private config: JanusAIConfig
  private redis: RedisClientType

  constructor(redis: RedisClientType, options?: JanusAIOptions) {
    this.redis = redis
    this.config = { 
      modelConfigs: _.merge(DefaultModelConfigs, options?.customLimits)
    }
  }

  getTokenLimit = (
    model: OpenAIChatModel, 
    keyId: string = 'default'
  ): RateLimit | undefined => this.config.modelConfigs[model][keyId].rateLimits.token

  getRequestLimit = (
    model: OpenAIChatModel, 
    keyId: string = 'default'
  ): RateLimit | undefined => this.config.modelConfigs[model][keyId].rateLimits.request

  private async pruneAndCount(
    inputTokensKey: string, 
    outputTokensKey: string, 
    requestsKey: string, 
    interval: 'minute' | 'second'
  ): Promise<{ inputTokenCount: number, outputTokenCount: number, requestCount: number }> {
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

    const tokenCount = OpenAIChatTokens.promptTokensEstimate(data)
    const tokenLimit = this.getTokenLimit(model, keyId)
    const requestLimit = this.getRequestLimit(model, keyId)

    if (tokenLimit === undefined || requestLimit === undefined) throw new Error('Invalid model keyId')
    
    const { inputTokenCount, outputTokenCount, requestCount} = await this.pruneAndCount(inputTokensKey, outputTokensKey, requestsKey, tokenLimit.interval)

    console.log(inputTokenCount, outputTokenCount, requestCount)

    const currentTokenCount = inputTokenCount + outputTokenCount

    if (currentTokenCount + tokenCount > tokenLimit.count) throw new Error('Input will surpass token count rate limit.')
    if (requestCount + 1 > requestLimit.count) throw new Error('Request will surpass request count rate limit.')

    const id = SnowflakeId.next(0)
    const dataObject: DataObject = { id, type: 'input', tokenCount, model, keyId }

    let zAddCommand = ['ZADD', inputTokensKey]

    for (let i = 0; i < tokenCount; i++) {
      zAddCommand.push(id, `${id}:${i.toString(10)}`)
    }

    await this.redis.sendCommand(zAddCommand)
    await this.redis.sendCommand(['ZADD', requestsKey, id, `${id}:${tokenCount.toString(10)}`])

    return dataObject
  }

  async registerChatOutput(options: RegisterOutputOptions): Promise<DataObject> {
    const { model, keyId = DEFAULT_KEY_ID, data } = options
    const outputTokensKey = getKey(RedisKey.OUTPUT_TOKENS, model, keyId)

    let tokenCount = 0

    for (let choice of options.data.choices) {
      const innerData: OuputInnerData = options.type === 'standard' ? 
        (choice as StandardOutputChoice).message : 
        (choice as StreamOutputChoice).delta
        
      if (innerData.content) tokenCount += OpenAIChatTokens.stringTokens(innerData.content)
      if (innerData.function_call?.name) tokenCount += OpenAIChatTokens.stringTokens(innerData.function_call?.name)
      if (innerData.function_call?.arguments) tokenCount += OpenAIChatTokens.stringTokens(innerData.function_call?.arguments)
    }

    const id = SnowflakeId.next(0)
    const dataObject: DataObject = { id, type: 'output', tokenCount, model, keyId }

    let zAddCommand = ['ZADD', outputTokensKey]

    for (let i = 0; i < tokenCount; i++) {
      zAddCommand.push(id, i.toString(10))
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