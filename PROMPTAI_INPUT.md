# PromptAI Input

## Overview

The PromptAI Input is an AI-powered MIDI generator that allows users to describe musical sequences and patterns in natural language, which are then converted to MIDI note sequences using an LLM (Language Model).

## Features

- **Natural Language Input**: Describe notes or sequences in plain English (e.g., "C major scale ascending")
- **AI-Generated Sequences**: Uses OpenAI API to generate MIDI note numbers based on descriptions
- **Real-time Playback**: Generated notes are dispatched as MIDI commands to the audio pipeline
- **Visual Feedback**: Shows generated notes as tags for easy reference
- **Error Handling**: Validates API responses and provides user-friendly error messages

## Implementation

### Files

- **input-prompt-ai.ts** - Core implementation of PromptAI input class
- **prompt-ai.scss** - Styling for the UI panel
- **input-types.ts** - Added `PROMPT_AI` type constant
- **input-factory.ts** - Added PromptAI to the input factory registry

### Class Structure

```typescript
class InputPromptAI extends AbstractInput implements IAudioInput
```

### Key Methods

- `createGui()` - Creates the UI panel with textarea and controls
- `destroyGui()` - Cleans up UI elements
- `generateSequenceFromPrompt(prompt: string)` - Initiates sequence generation
- `callAIApi(prompt: string)` - Calls OpenAI API to generate notes
- `dispatchNoteSequence(notes: number[])` - Sends MIDI note on/off commands

## Configuration

### Options

```typescript
interface PromptAIOptions {
  apiKey?: string      // OpenAI API key (required for operation)
  model?: string       // Default: "gpt-3.5-turbo"
  temperature?: number // Default: 0.7 (creativity level)
  maxTokens?: number   // Default: 500 (response length)
}
```

### Usage

```typescript
const promptAI = new InputPromptAI({
  apiKey: "sk-...", // Your OpenAI API key
  model: "gpt-4",   // Optional: use GPT-4 for better results
  temperature: 0.5  // Optional: lower for more deterministic results
})

await promptAI.createGui() // Add UI to main element
```

## API Integration

The implementation uses OpenAI's Chat Completions API with a structured prompt that ensures responses are valid JSON arrays of MIDI note numbers:

```javascript
const response = await fetch("https://api.openai.com/v1/chat/completions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  },
  body: JSON.stringify({
    model: "gpt-3.5-turbo",
    messages: [
      { role: "system", content: "..." },
      { role: "user", content: userPrompt }
    ]
  })
})
```

### Expected Response Format

The API is instructed to return only a JSON array of MIDI note numbers:

```json
[60, 62, 64, 65, 67, 69, 71, 72]
```

Valid range: 0-127 (MIDI note numbers)

## UI Components

The panel includes:

- **Text Area**: For entering natural language prompts
- **Generate Button**: Triggers sequence generation
- **Stop Button**: Cancels ongoing generation
- **Status Message**: Displays success/error messages
- **Notes Display**: Shows generated notes as visual tags

## Playback

Generated notes are dispatched to the audio pipeline with:

- **Duration**: 500ms per note
- **Velocity**: 100 (out of 127)
- **Timing**: Sequential with small delays between dispatches
- **From**: Marked as "PromptAI" input source

## Error Handling

The implementation includes:

- API availability checks
- Response validation
- JSON parsing with fallback error messages
- Note number range validation (0-127)
- User-friendly error display

## Example Prompts

- "C major scale ascending"
- "Pentatonic minor pattern"
- "C minor chord"
- "Arpeggiated G major"
- "Chromatic sequence from C to G"
- "Blues scale in A"

## Future Enhancements

- Support for additional AI providers (Anthropic Claude, local LLMs)
- Chord progression generation
- Rhythm pattern suggestions
- Model selection UI
- Prompt history/templates
- Batch generation (multiple sequences)
- Export generated patterns

## Integration with HarmonEasy

The PromptAI input is registered in the Input Factory and available through:

1. The "Add Input" menu in the UI
2. Direct instantiation via `createInputById("prompt-ai")`
3. Programmatic creation with configuration options

Notes generated are dispatched as standard MIDI commands (`NOTE_ON` / `NOTE_OFF`) and flow through the normal audio transformation pipeline, allowing them to be transposed, quantized, and transformed like any other input.
