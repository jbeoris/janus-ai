import * as _ from 'lodash'
import { encode, encodeChat } from 'gpt-tokenizer'

import { ModelConfigs, OpenAIChatModel, OptionalModelConfigs, RateLimit } from "./config"
import Redis from './redis'
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
  TOKEN_COUNTER,
  REQUEST_COUNTER,
  DATASET
}

export function getKey(redisKey: RedisKey, model: OpenAIChatModel, keyId: string) {
  switch (redisKey) {
    case RedisKey.TOKEN_COUNTER: return `tokencounter:${model}:${keyId}`
    case RedisKey.REQUEST_COUNTER: return `requestcounter:${model}:${keyId}`
    case RedisKey.DATASET: return `dataset:${model}:${keyId}`
  }
}

export class JanusAI {
  private config?: JanusAIConfig
  private modelConfigs: ModelConfigs
  private validators: JanusAIValidator[] = []
  private redis: Redis

  constructor(config?: JanusAIConfig) {
    this.config = config
    this.modelConfigs = config ? { ...ModelConfigs, ...config.modelConfigs } : ModelConfigs
    this.redis = new Redis()
  }

  getTokenLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.token
  getRequestLimit = (model: OpenAIChatModel): RateLimit => this.modelConfigs[model].rateLimits.request


    //  INPUT TOKENS
    //  Create a ZSET for each (model, keyId) pair
    //    - ZSET entries will have snowflake id and value will be token count
    //  Create KEY using INCRBY for each corresponding ZSET
    //    - add to/subtract from based on token addition/expiry/failure
    //  All operations will run a prune routine that will take expired keys and subtract them from the KEY value
    //  
    //  OUTPUT TOKENS
    //  Create a ZSET for each (model, keyId) pair
    //    - ZSET entries will have snowflake id and value will be token count
    //  Create KEY using INCRBY for each corresponding ZSET
    //    - add to/subtract from based on token addition/expiry [no failure possible here since]
    //  All operations will run a prune routine that will take expired keys and subtract them from the KEY value

    //  PRUNING
    //  ZRANGEBYSCORE to get entries that are expired. Use snowflake id creator using current timestamp (chalk-api code)
    //  sum all the entries (if any) then INCRBY the negative of this value for the key
    //  ZREMRANGEBYSCORE the ZSET with the snowflake ID generated above.
    //  
    //  Use Redis for snowflake ID generation - keep the latest count/iterators in memory.

  /**
   * @param model - string model name
   * @param chat - chat history
   * @param key used if cycling multiple keys (default 0)
   */
  async registerChatInput(model: OpenAIChatModel, chat: ChatMessage[], keyId: string = 'default'): Promise<DataObject> {
    const tokenCounterKey = getKey(RedisKey.TOKEN_COUNTER, model, keyId)
    const requestCounterKey = getKey(RedisKey.REQUEST_COUNTER, model, keyId)
    const datasetKey = getKey(RedisKey.REQUEST_COUNTER, model, keyId)

    // dataset items will have input/output flag so that we only subtract from request counter if input tokens.

    const tokenCount = encodeChat(chat).length

    const tokenLimit = this.getTokenLimit(model)
    const requestLimit = this.getRequestLimit(model)
    
    // Need to make this transactional. Watch these keys to see if they are being changed underneath our feet.
    // Should be atomic.

    // Prune set and adjust counts before checking below
    // All operations will run a prune routine that will take expired keys and subtract them from the KEY value

    const currentTokenCountString = (await this.redis.get(tokenCounterKey)) || '0'
    const currentTokenCount = parseInt(currentTokenCountString)

    const currentRequestCountString = (await this.redis.get(requestCounterKey)) || '0'
    const currentRequestCount = parseInt(currentRequestCountString)

    if (currentTokenCount + tokenCount > tokenLimit.count) throw new Error('Input will surpass token count rate limit.')
    if (currentRequestCount + 1 > requestLimit.count) throw new Error('Request will surpass request count rate limit.')

    const id = SnowflakeId.getNextId(0)
    const dataObject: DataObject = { id, type: 'input', tokenCount, model, keyId }

    await this.redis.incrby(tokenCounterKey, tokenCount)
    await this.redis.incrby(requestCounterKey, 1)
    await this.redis.zadd(datasetKey, id, JSON.stringify(dataObject))

    return dataObject
  }

  /**
   * @param dataObject - data object returned initially
   */
  async deregisterChatInput(dataObject: DataObject): Promise<boolean> {
    if (dataObject.type !== 'input') throw new Error('Can only deregister input data')

    const tokenCounterKey = getKey(RedisKey.TOKEN_COUNTER, dataObject.model, dataObject.keyId)
    const requestCounterKey = getKey(RedisKey.REQUEST_COUNTER, dataObject.model, dataObject.keyId)
    const datasetKey = getKey(RedisKey.REQUEST_COUNTER, dataObject.model, dataObject.keyId)

    const idBigIntIncremented = BigInt(dataObject.id) + BigInt(1)

    const success = await this.redis.zremrangebyscore(datasetKey, dataObject.id, `(${idBigIntIncremented.toString(10)}`)

    if (success > 0) { // only decrement if the object was still in the zset
      await this.redis.incrby(tokenCounterKey, -dataObject.tokenCount)
      await this.redis.incrby(requestCounterKey, -1)
    }

    return true
  }

  /**
   * @param model - string model name
   * @param output - output
   * @param key used if cycling multiple keys (default 0)
   */
  async registerChatOutput(model: OpenAIChatModel, output: string, keyId: string = 'default'): Promise<DataObject> {
    const tokenCounterKey = getKey(RedisKey.TOKEN_COUNTER, model, keyId)
    const datasetKey = getKey(RedisKey.REQUEST_COUNTER, model, keyId)

    const tokenCount = encode(output).length

    const tokenLimit = this.getTokenLimit(model)
    const requestLimit = this.getRequestLimit(model)

    const id = SnowflakeId.getNextId(0)

    await this.redis.incrby(tokenCounterKey, tokenCount)
    await this.redis.zadd(datasetKey, id, JSON.stringify({ id, type: 'input', tokenCount, key: datasetKey }))

    return { id, tokenCount }

    //  INPUT TOKENS
    //  Create a ZSET for each (model, keyId) pair
    //    - ZSET entries will have snowflake id and value will be token count
    //  Create KEY using INCRBY for each corresponding ZSET
    //    - add to/subtract from based on token addition/expiry/failure
    //  All operations will run a prune routine that will take expired keys and subtract them from the KEY value
    //  
    //  OUTPUT TOKENS
    //  Create a ZSET for each (model, keyId) pair
    //    - ZSET entries will have snowflake id and value will be token count
    //  Create KEY using INCRBY for each corresponding ZSET
    //    - add to/subtract from based on token addition/expiry [no failure possible here since]
    //  All operations will run a prune routine that will take expired keys and subtract them from the KEY value

    //  PRUNING
    //  ZRANGEBYSCORE to get entries that are expired. Use snowflake id creator using current timestamp (chalk-api code)
    //  sum all the entries (if any) then INCRBY the negative of this value for the key
    //  ZREMRANGEBYSCORE the ZSET with the snowflake ID generated above.
    //  
    //  Use Redis for snowflake ID generation - keep the latest count/iterators in memory.
  }
}

export default JanusAI