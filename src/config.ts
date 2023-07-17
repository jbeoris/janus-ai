export type OpenAIChatModel =
  'gpt-3.5-turbo' |
  'gpt-3.5-turbo-0301' |
  'gpt-3.5-turbo-0613' |
  'gpt-3.5-turbo-16k' |
  'gpt-3.5-turbo-16k-0613' |
  'gpt-4' |
  'gpt-4-0314' | 
  'gpt-4-0613'
  
export type RateLimit = { count: number, interval: 'second' | 'minute' }

export type ModelConfig = {
  rateLimits: {
    token: RateLimit,
    request: RateLimit
  }
}

export type ModelConfigs = { [key in OpenAIChatModel] : ModelConfig }
export type OptionalModelConfigs = { [key in OpenAIChatModel]? : ModelConfig }

export const ModelConfigs: ModelConfigs = {
  'gpt-3.5-turbo': {
    rateLimits: {
      token: { count: 90000, interval: 'minute' },
      request: { count: 3500, interval: 'minute' }
    }
  },
  'gpt-3.5-turbo-0301': {
    rateLimits: {
      token: { count: 90000, interval: 'minute' },
      request: { count: 3500, interval: 'minute' }
    }
  },
  'gpt-3.5-turbo-0613': {
    rateLimits: {
      token: { count: 90000, interval: 'minute' },
      request: { count: 3500, interval: 'minute' }
    }
  },
  'gpt-3.5-turbo-16k': {
    rateLimits: {
      token: { count: 180000, interval: 'minute' },
      request: { count: 3500, interval: 'minute' }
    }
  },
  'gpt-3.5-turbo-16k-0613': {
    rateLimits: {
      token: { count: 180000, interval: 'minute' },
      request: { count: 3500, interval: 'minute' }
    }
  },
  'gpt-4': {
    rateLimits: {
      token: { count: 40000, interval: 'minute' },
      request: { count: 200, interval: 'minute' }
    }
  },
  'gpt-4-0314': {
    rateLimits: {
      token: { count: 40000, interval: 'minute' },
      request: { count: 200, interval: 'minute' }
    }
  }, 
  'gpt-4-0613': {
    rateLimits: {
      token: { count: 40000, interval: 'minute' },
      request: { count: 200, interval: 'minute' }
    }
  }
}