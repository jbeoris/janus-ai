import JanusAI, { RegisterChatOptions } from '../index';
import { RedisClientType, createClient } from 'redis';

const redis: RedisClientType = createClient()

const makeDefaultJanus = async () => {
  await redis.connect()
  return new JanusAI(redis)
}
const makeOverrideJanus = () => new JanusAI(redis, { 
  customLimits: { 
    'gpt-3.5-turbo': {
      'one': {
        rateLimits: {
          token: { count: 300, interval: 'minute' },
          request: { count: 200, interval: 'minute' }
        }
      }
    } 
  } 
})

// test('Get Default Model TPM', () => {
//   expect(makeDefaultJanus().getTokenLimit('gpt-3.5-turbo')?.count).toBe(90000);
// });

// test('Get Default Model RPM', () => {
//   expect(makeDefaultJanus().getRequestLimit('gpt-3.5-turbo')?.count).toBe(3500);
// });

// test('Get Override Model TPM', () => {
//   expect(makeDefaultJanus().getTokenLimit('gpt-3.5-turbo')?.count).toBe(90000);
//   expect(makeOverrideJanus().getTokenLimit('gpt-3.5-turbo', 'one')?.count).toBe(300);
// });

// test('Get Override Model RPM', () => {
//   expect(makeDefaultJanus().getRequestLimit('gpt-3.5-turbo')?.count).toBe(3500);
//   expect(makeOverrideJanus().getRequestLimit('gpt-3.5-turbo', 'one')?.count).toBe(200);
// });

test('test rate limit', async () => {
  const janus = await makeDefaultJanus()

  const chatInput: RegisterChatOptions = { 
    model: 'gpt-3.5-turbo', 
    data: { 
      messages: [
        { 
          role: 'system',
          content: 'you are an AI'
        },
        { 
          role: 'user',
          content: 'Hello'
        }
      ] 
    }
  }

  for (let i = 0; i < 10000; i++) {
    try {
      await janus.registerChatInput(chatInput)
    } catch (err) {
      console.error(err)
    }
  }

  return await redis.disconnect()
})