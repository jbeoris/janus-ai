import JanusAI, { RegisterChatOptions } from '../index';
import { RedisClientType, createClient } from 'redis';

let defaultJanus: JanusAI | undefined
const makeDefaultJanus = () => new JanusAI()

let overrideJanus: JanusAI | undefined
const makeOverrideJanus = () => new JanusAI({ 
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

beforeEach(async () => {
  defaultJanus = makeDefaultJanus()
  overrideJanus = makeOverrideJanus()
  await defaultJanus.connect()
  await overrideJanus.connect()
});

afterEach(async () => {
  await defaultJanus?.disconnect()
  await overrideJanus?.disconnect()
});

test('Get Default Model TPM', () => {
  expect(defaultJanus?.getTokenLimit('gpt-3.5-turbo')?.count).toBe(90000);
});

test('Get Default Model RPM', () => {
  expect(defaultJanus?.getRequestLimit('gpt-3.5-turbo')?.count).toBe(3500);
});

test('Get Override Model TPM', () => {
  expect(defaultJanus?.getTokenLimit('gpt-3.5-turbo')?.count).toBe(90000);
  expect(overrideJanus?.getTokenLimit('gpt-3.5-turbo', 'one')?.count).toBe(300);
});

test('Get Override Model RPM', () => {
  expect(defaultJanus?.getRequestLimit('gpt-3.5-turbo')?.count).toBe(3500);
  expect(overrideJanus?.getRequestLimit('gpt-3.5-turbo', 'one')?.count).toBe(200);
});

test('test rate limit', async () => {
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

  const results = await defaultJanus?.registerChatInput(chatInput)

  console.log(results)

  return
})