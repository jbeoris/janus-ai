import JanusAI from '../index';

const makeDefaultJanus = () => new JanusAI()
const makeOverrideJanus = () => new JanusAI({ 
  modelConfigs: { 
    'gpt-3.5-turbo': {
      rateLimits: {
        token: { count: 300, interval: 'minute' },
        request: { count: 200, interval: 'minute' }
      }
    } 
  } 
})

test('Get Default Model TPM', () => {
  expect(makeDefaultJanus().getTokenLimit('gpt-3.5-turbo').count).toBe(90000);
});

test('Get Default Model RPM', () => {
  expect(makeDefaultJanus().getRequestLimit('gpt-3.5-turbo').count).toBe(3500);
});

test('Get Override Model TPM', () => {
  expect(makeOverrideJanus().getTokenLimit('gpt-3.5-turbo').count).toBe(300);
});

test('Get Override Model RPM', () => {
  expect(makeOverrideJanus().getRequestLimit('gpt-3.5-turbo').count).toBe(200);
});