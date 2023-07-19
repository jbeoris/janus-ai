import { RedisClientType, createClient } from 'redis';

class RedisAdapter {
  private client: RedisClientType

  constructor() {
    this.client = createClient()
    
    this.client.on('error', this.handleError)

    this.connect()
  }

  get(key: string) {
    return this.client.get(key)
  }

  zadd(key: string, score: string, value: string) {
    return this.client.sendCommand(['ZADD', key, score, value])
  }

  zremrangebyscore(key: string, min: string, max: string) {
    return this.client.zRemRangeByScore(key, min, max)
  }

  incrby(key: string, increment: number) {
    return this.client.incrBy(key, increment)
  }

  zrangebyscore() {

  }

  private async connect() {
    try {
      await this.client.connect()
    } catch (err) {
      console.error('JanusAI Redis Connect Error:', err)
    }
  }

  private handleError(err: any) {
    console.error('JanusAI Redis Error:', err)
  }
}

export default RedisAdapter