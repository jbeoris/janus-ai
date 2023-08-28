# janus-ai

A TypeScript / JavaScript library for tracking AI rate limits across multiple services.

## Usage

```typescript
import JanusAI from 'janus-ai';

export const janus = new JanusAI();

janus.connect();

const registerInput = async () => {
  const janusDataObject = await janus.registerChatInput({
    model: 'gpt-4', 
    data: { 
      messages: [
        {
          role: "user",
          content: "Hello, Janus!"
        }
      ] 
    }
  });

  console.log(janusDataObject.system.load);
};

const janusDataObject = await janus.registerChatInput({
  model: data.model, 
  data: { messages: data.messages, functions: data.functions }
})
```

## Development and testing

Built in TypeScript, tested with Jest.

```bash
$ yarn install
$ yarn test
```