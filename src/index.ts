import * as _ from 'lodash'
import { encode, encodeChat } from 'gpt-tokenizer'
import { RedisClientType } from 'redis'

import { ModelConfigs, OpenAIChatModel, OptionalModelConfigs, RateLimit } from "./config"
import * as SnowflakeId from './snowflakeId'

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
  id: string,
  type: 'input' | 'output',
  tokenCount: number,
  model: OpenAIChatModel,
  keyId: string
}

export enum RedisKey {
  INPUT_TOKEN_COUNTER,
  OUTPUT_TOKEN_COUNTER,
  REQUEST_COUNTER,
  DATASET
}

const DEFAULT_KEY_ID = 'default'

export type RegisterChatOptions = {
  model: OpenAIChatModel, 
  data: string | ChatMessage[], 
  keyId?: string
}

export function getKey(redisKey: RedisKey, model: OpenAIChatModel, keyId: string) {
  switch (redisKey) {
    case RedisKey.INPUT_TOKEN_COUNTER: return `input-token-counter:${model}:${keyId}`
    case RedisKey.OUTPUT_TOKEN_COUNTER: return `output-token-counter:${model}:${keyId}`
    case RedisKey.REQUEST_COUNTER: return `request-counter:${model}:${keyId}`
    case RedisKey.DATASET: return `dataset:${model}:${keyId}`
  }
}

export class JanusAI {
  private config?: JanusAIConfig
  private modelConfigs: ModelConfigs
  private validators: JanusAIValidator[] = []
  private redis: RedisClientType

  constructor(redis: RedisClientType, config?: JanusAIConfig) {
    this.redis = redis
    this.config = config
    this.modelConfigs = config ? { ...ModelConfigs, ...config.modelConfigs } : ModelConfigs
  }

  getTokenLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.token
  getRequestLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.request

  private getTokenCount(data: string | ChatMessage[]) {
    return typeof data === 'string' ? encode(data).length : encodeChat(data).length
  }

  private async prune(datasetKey: string, inputTokenCounterKey: string, outputTokenCounterKey: string, interval: 'minute' | 'second') {
    // TODO - MAKE ATOMIC
    const target = SnowflakeId.getTime(new Date(new Date().getTime() - (1000 * (interval === 'minute' ? 60 : 1))))

    const batchSize = 100

    // TODO - decrement request count here too

    let inputTokenCount = 0
    let outputTokenCount = 0
    let start = 0

    while (true) {
      const elements = await this.redis.zrangebyscore(datasetKey, '-inf', target, { count: batchSize, offset: start })

      for (let element of elements) {
        // TODO - add the tokenCount of the element
      }

      if (elements.length === 0) break

      start += batchSize
    }

    await this.redis.zremrangebyscore(datasetKey, '-inf', target)
    await this.redis.incrby(inputTokenCounterKey, -inputTokenCount)
    await this.redis.incrby(outputTokenCounterKey, -outputTokenCount)
  }

  //  TODO - Use Redis for snowflake ID generation - keep the latest count/iterators in memory.

  /**
   * @param model - string model name
   * @param chat - chat history
   * @param key used if cycling multiple keys (default 0)
   */
  async registerChatInput(options: RegisterChatOptions): Promise<DataObject> {
    const { model, keyId = DEFAULT_KEY_ID, data } = options
    const inputTokenCounterKey = getKey(RedisKey.INPUT_TOKEN_COUNTER, model, keyId)
    const outputTokenCounterKey = getKey(RedisKey.OUTPUT_TOKEN_COUNTER, model, keyId)
    const requestCounterKey = getKey(RedisKey.REQUEST_COUNTER, model, keyId)
    const datasetKey = getKey(RedisKey.DATASET, model, keyId)

    // dataset items will have input/output flag so that we only subtract from request counter if input tokens.

    const tokenCount = this.getTokenCount(data)

    const tokenLimit = this.getTokenLimit(model)
    const requestLimit = this.getRequestLimit(model)
    
    // Need to make this transactional. Watch these keys to see if they are being changed underneath our feet.
    // Should be atomic.

    await this.prune(datasetKey, inputTokenCounterKey, outputTokenCounterKey, tokenLimit.interval)

    // Prune set and adjust counts before checking below
    // All operations will run a prune routine that will take expired keys and subtract them from the KEY value

    const currentInputTokenCountString = (await this.redis.get(inputTokenCounterKey)) || '0'
    const currentInputTokenCount = parseInt(currentInputTokenCountString)

    const currentOutputTokenCountString = (await this.redis.get(outputTokenCounterKey)) || '0'
    const currentOutputTokenCount = parseInt(currentOutputTokenCountString)

    const currentTokenCount = currentInputTokenCount + currentOutputTokenCount

    const currentRequestCountString = (await this.redis.get(requestCounterKey)) || '0'
    const currentRequestCount = parseInt(currentRequestCountString)

    if (currentTokenCount + tokenCount > tokenLimit.count) throw new Error('Input will surpass token count rate limit.')
    if (currentRequestCount + 1 > requestLimit.count) throw new Error('Request will surpass request count rate limit.')

    const id = SnowflakeId.getNextId(0)
    const dataObject: DataObject = { id, type: 'input', tokenCount, model, keyId }

    await this.redis.incrby(inputTokenCounterKey, tokenCount)
    await this.redis.incrby(requestCounterKey, 1)
    await this.redis.zadd(datasetKey, id, JSON.stringify(dataObject))

    return dataObject
  }

  /**
   * @param model - string model name
   * @param output - output
   * @param key used if cycling multiple keys (default 0)
   */
  async registerChatOutput(options: RegisterChatOptions): Promise<DataObject> {
    const { model, keyId = DEFAULT_KEY_ID, data } = options
    const outputTokenCounterKey = getKey(RedisKey.OUTPUT_TOKEN_COUNTER, model, keyId)
    const datasetKey = getKey(RedisKey.DATASET, model, keyId)

    const tokenCount = this.getTokenCount(data)

    const id = SnowflakeId.getNextId(0)
    const dataObject: DataObject = { id, type: 'output', tokenCount, model, keyId }

    await this.redis.incrby(outputTokenCounterKey, tokenCount)
    await this.redis.zadd(datasetKey, id, JSON.stringify(dataObject))

    return dataObject
  }

  /**
   * @param dataObject - data object returned initially
   */
  async deregisterChatInput(dataObject: DataObject): Promise<boolean> {
    if (dataObject.type !== 'input') throw new Error('Can only deregister input data')

    const inputTokenCounterKey = getKey(RedisKey.INPUT_TOKEN_COUNTER, dataObject.model, dataObject.keyId)
    const requestCounterKey = getKey(RedisKey.REQUEST_COUNTER, dataObject.model, dataObject.keyId)
    const datasetKey = getKey(RedisKey.DATASET, dataObject.model, dataObject.keyId)

    const idBigIntIncremented = BigInt(dataObject.id) + BigInt(1)

    const success = await this.redis.zremrangebyscore(datasetKey, dataObject.id, `(${idBigIntIncremented.toString(10)}`)

    if (success > 0) { // only decrement if the object was still in the zset
      await this.redis.incrby(inputTokenCounterKey, -dataObject.tokenCount)
      await this.redis.incrby(requestCounterKey, -1)
    }

    return true
  }
}

export default JanusAI