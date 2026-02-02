# PromptAI Input Implementation Summary

## Overview
Added an AI-powered input module to HarmonEasy that allows users to generate MIDI note sequences by describing them in natural language. Uses OpenAI API to convert descriptions like "C major scale ascending" into MIDI note numbers.

## Files Created

### Core Implementation
- **source/libs/audiobus/io/inputs/input-prompt-ai.ts** (245 lines)
  - Main `InputPromptAI` class extending `AbstractInput`
  - Implements `IAudioInput` interface
  - OpenAI API integration for generating note sequences
  - UI panel creation with textarea and controls
  - MIDI command dispatching for playback

### Styling
- **source/assets/style/prompt-ai.scss** (150+ lines)
  - Dark-themed panel styling matching HarmonEasy design
  - Responsive layout for mobile and desktop
  - Status message styling (success, error, info)
  - Note tags visual display
  - Button and textarea styling

### Documentation
- **PROMPTAI_INPUT.md** (150+ lines)
  - Complete API documentation
  - Usage examples and configuration options
  - Error handling details
  - Example prompts for users
  - Future enhancement suggestions

## Files Modified

### Input System Integration
- **source/libs/audiobus/io/inputs/input-types.ts**
  - Added `PROMPT_AI = "prompt-ai"` constant
  - Added `PROMPT_AI` to `InputId` union type

- **source/libs/audiobus/io/input-factory.ts**
  - Added import case in `loadSupportingLibrary()`
  - Added factory entry in `INPUT_FACTORIES` array
  - Registers PromptAI as available input

### Styling
- **source/assets/style/index.scss**
  - Added import for `prompt-ai.scss`

### Documentation
- **AGENTS.md**
  - Added `InputPromptAI` to Key Classes list
  - Added new "PromptAI Input" section with feature overview

## Key Features

### User Interface
- Textarea for entering natural language prompts
- Generate/Stop buttons for control
- Status messages (success/error/info)
- Visual display of generated notes as tags
- Responsive design for all screen sizes

### AI Integration
- OpenAI Chat Completions API support
- Configurable model (default: gpt-3.5-turbo)
- Temperature and max_tokens customization
- Structured prompting to ensure JSON array responses
- Response validation and error handling

### MIDI Playback
- Generates MIDI NOTE_ON/NOTE_OFF commands
- 500ms per note duration (configurable)
- Velocity 100 (out of 127)
- Sequential dispatch with timing
- Full integration with audio transformation pipeline

### Example Prompts
Users can input descriptions like:
- "C major scale ascending"
- "Pentatonic minor pattern"
- "C minor chord"
- "Arpeggiated G major"
- "Blues scale in A"
- "Chromatic sequence from C to G"

## Technical Details

### API Configuration
```typescript
const promptAI = new InputPromptAI({
  apiKey: "sk-...", // Required: OpenAI API key
  model: "gpt-3.5-turbo", // Optional
  temperature: 0.7, // Optional
  maxTokens: 500 // Optional
})
```

### System Prompt
The implementation uses a detailed system prompt that instructs the AI to:
1. Generate only MIDI note numbers (0-127)
2. Return results as valid JSON arrays
3. Understand music theory concepts
4. Provide no explanations, only JSON

### Error Handling
- API key validation
- Network error handling
- JSON response validation
- MIDI note number range validation (0-127)
- User-friendly error messages in UI

## Integration Points

1. **Input Factory**: Registered in `INPUT_FACTORIES` for UI selection
2. **Audio Pipeline**: Dispatches standard MIDI commands
3. **Styling System**: Uses existing SCSS variables and layout
4. **Note Model**: Uses `NoteModel` for note name display
5. **Audio Commands**: Uses `AudioCommand` with `NOTE_ON`/`NOTE_OFF` types

## Usage in Application

Users can:
1. Click "Add Input" in the UI
2. Select "PromptAI Generator" from the list
3. Enter an OpenAI API key in options
4. Type a musical description in the textarea
5. Click "Generate Sequence"
6. Watch notes play and see visual feedback

Generated notes flow through:
- Note generation (PromptAI)
- Audio transformation (transposition, quantization)
- Output adapters (synthesizers, MIDI devices)
- Audio playback

## Browser/Environment Requirements

- **Browser APIs**: No special requirements beyond standard Web APIs
- **Network**: Internet connection required for OpenAI API
- **API Key**: Valid OpenAI API key with Chat Completions access
- **Permissions**: No special permissions needed

## Future Enhancements

- Support for local LLMs (Ollama, LlamaIndex)
- Multiple AI provider support (Anthropic, HuggingFace)
- Chord progression generation
- Rhythm pattern suggestions
- Prompt history and templates
- Model selection UI
- Batch generation of multiple sequences
- Export patterns as reusable presets
- Integration with other music generation models

## Testing

To verify the implementation:
1. Build the project: `npm run build`
2. Run tests: `npm test`
3. Start dev server: `npm run dev`
4. Check browser console for any TypeScript errors
5. Verify "Add Input" menu includes "PromptAI Generator"
6. Configure with OpenAI API key and test prompt generation

## Notes

- The implementation follows HarmonEasy's code style and architecture
- All imports include file extensions as required by Vite
- Uses TypeScript with strict mode enabled
- Error handling at boundaries (API responses)
- No external dependencies beyond OpenAI API
- Compatible with existing input types and audio pipeline
