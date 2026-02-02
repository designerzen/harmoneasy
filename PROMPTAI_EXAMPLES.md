# PromptAI Usage Examples

## Basic Usage

### Setup
```typescript
import InputPromptAI from './source/libs/audiobus/io/inputs/input-prompt-ai.ts'

// Create instance with API key
const promptAI = new InputPromptAI({
  apiKey: process.env.OPENAI_API_KEY,
  model: "gpt-3.5-turbo"
})

// Add UI to page
await promptAI.createGui()
```

### Configuration Options
```typescript
// Minimal (requires API key from environment)
const promptAI1 = new InputPromptAI()

// With custom model
const promptAI2 = new InputPromptAI({
  apiKey: "sk-...",
  model: "gpt-4"  // For better music generation
})

// Fine-tuned parameters
const promptAI3 = new InputPromptAI({
  apiKey: "sk-...",
  model: "gpt-3.5-turbo",
  temperature: 0.5,  // More deterministic
  maxTokens: 300
})

// Creative mode
const promptAI4 = new InputPromptAI({
  apiKey: "sk-...",
  temperature: 0.9,  // More creative/random
  maxTokens: 500
})
```

## Example Prompts and Expected Results

### Scale Examples

**Input:** "C major scale ascending"
**Output:** `[60, 62, 64, 65, 67, 69, 71, 72]`
**Plays:** C → D → E → F → G → A → B → C

**Input:** "Minor pentatonic scale starting from A"
**Output:** `[57, 60, 62, 65, 67]`
**Plays:** A → C → D → E → G

**Input:** "Blues scale in G"
**Output:** `[43, 46, 48, 49, 51, 53, 55]`
**Plays:** G → Bb → B → C → D → E → F (one octave)

### Chord Examples

**Input:** "C major triad"
**Output:** `[60, 64, 67]`
**Plays:** C → E → G (simultaneously or arpeggiated)

**Input:** "D minor chord"
**Output:** `[62, 65, 69]`
**Plays:** D → F → A

**Input:** "G7 dominant seventh chord"
**Output:** `[67, 71, 74, 77]`
**Plays:** G → B → D → F

### Melodic Examples

**Input:** "Happy ascending melody in C major"
**Output:** `[60, 62, 64, 62, 67]`
**Plays:** C → D → E → D → G

**Input:** "Sad descending pattern"
**Output:** `[72, 71, 69, 67, 65, 64]`
**Plays:** C → B → A → G → F# → E (descending)

**Input:** "Arpeggio pattern C major"
**Output:** `[60, 64, 67, 72]`
**Plays:** C → E → G → C (one octave higher)

### Interval Examples

**Input:** "Perfect fourth starting from C"
**Output:** `[60, 65]`
**Plays:** C → F (4 semitones apart)

**Input:** "Octave leap from middle C"
**Output:** `[60, 72]`
**Plays:** C → C (one octave higher)

**Input:** "Tritone interval starting at F"
**Output:** `[65, 72]`
**Plays:** F → B (devil's interval)

### Rhythm Pattern Examples

**Input:** "Quarter note pulse in C for 8 notes"
**Output:** `[60, 60, 60, 60, 60, 60, 60, 60]`
**Plays:** Repeating C note pattern

**Input:** "Ascending eighth notes from C to G"
**Output:** `[60, 62, 64, 65, 67]`
**Plays:** Quick ascending pattern

## Integration with HarmonEasy Audio Pipeline

### Example: Generate → Transform → Play

```typescript
// 1. User types in PromptAI panel
prompt = "C major scale ascending"

// 2. System generates notes
notes = [60, 62, 64, 65, 67, 69, 71, 72]

// 3. Notes dispatched as MIDI commands
// NOTE_ON (60), NOTE_OFF (60), NOTE_ON (62), NOTE_OFF (62), ...

// 4. Commands flow through transformers
// - Transpose to shared key (if in ensemble mode)
// - Quantize to beat grid (if needed)
// - Apply effects/transformations

// 5. Output to synthesizer
// Audio plays through speakers
```

### Example: Using with Transposer Transformer

```typescript
// Generate scale in C
prompt = "C major scale"
// Output: [60, 62, 64, 65, 67, 69, 71, 72]

// But if transposer is set to +2 semitones:
// Final output: [62, 64, 66, 67, 69, 71, 73, 74] (D major scale)
```

## Advanced Usage

### Programmatic Sequence Generation

```typescript
// Generate multiple sequences in a row
const promptAI = new InputPromptAI({ apiKey: "sk-..." })

// Generate bass line
await promptAI.generateSequenceFromPrompt("Low bass line descending from G")

// Generate melody (after first completes)
await promptAI.generateSequenceFromPrompt("Melody starting high in C major")

// Generate harmony
await promptAI.generateSequenceFromPrompt("Chord progression: C major, F major, G major")
```

### Custom Note Duration

```typescript
// The default is 500ms per note
// To customize, modify the dispatchNoteSequence method:

// For faster notes (250ms each)
// Good for fast runs or arpeggios
prompt = "Fast ascending sixteenth notes"

// For slower notes (1000ms each)
// Good for sustained melodic lines
prompt = "Slow held notes descending from C"
```

### Error Handling

```typescript
const promptAI = new InputPromptAI({
  apiKey: "invalid-key"
})

try {
  await promptAI.generateSequenceFromPrompt("C major scale")
} catch (error) {
  // Error displayed in UI status message
  // Also logged to console:
  console.error("PromptAI generation error:", error)
}

// Status messages shown to user:
// - "API key not configured" - No API key provided
// - "Failed to generate: API Error: Invalid API key" - Bad key
// - "Failed to generate: Could not parse note numbers" - Model returned invalid JSON
// - "Sequence generated successfully" - Success!
```

## Tips for Best Results

### General Tips
1. **Be specific**: "C major scale" → "8-note ascending C major scale in treble clef"
2. **Use music terms**: Scales, chords, intervals, progressions are well understood
3. **Name the key**: "in C major" or "starting from G"
4. **Describe the direction**: "ascending", "descending", "arpeggiating"

### For Scales
- ✅ "C major scale ascending"
- ✅ "A natural minor scale descending"
- ✅ "G pentatonic scale"
- ❌ "Make a musical scale" (too vague)

### For Chords
- ✅ "C major chord"
- ✅ "D minor seventh chord"
- ✅ "F augmented triad"
- ❌ "A chord" (ambiguous)

### For Melodies
- ✅ "Happy melody in C major starting high"
- ✅ "Sad descending pattern using minor intervals"
- ✅ "Jazz-style chromatic run from C to G"
- ❌ "Play something nice" (too abstract)

## Model Selection Tips

### gpt-3.5-turbo (Default)
- Fast responses
- Good for scales and common patterns
- Cost-effective
- Sufficient for most use cases

### gpt-4
- Better understanding of complex patterns
- More creative options
- Handles ambiguous prompts better
- Higher cost

**Recommendation**: Start with gpt-3.5-turbo, upgrade to gpt-4 if results are unsatisfactory.

## Integration Examples

### With Keyboard Input
```typescript
// User can combine keyboard and PromptAI
keyboard.createGui()  // Player uses keyboard
promptAI.createGui()  // Player uses PromptAI

// Both dispatch MIDI commands to same pipeline
// Notes combine and can be transformed together
```

### With Transformers
```typescript
// PromptAI generates base melody
prompt1 = "C major arpeggio ascending"

// Transposer transformer shifts notes
transformer.transpose = 5  // Up 5 semitones

// Quantizer snaps to beat grid
transformer.quantize = "eighth"

// Result: PromptAI notes are transformed as they play
```

### In Ensemble Mode
```typescript
// Multiple players using PromptAI
player1.promptAI.generateSequence("Bass line in C")
player2.promptAI.generateSequence("Harmony in C major")

// Notes are combined, transposed to shared key, and synced
// Creates ensemble performance
```

## Troubleshooting

### API Key Issues
```
Error: "API key not configured"
Solution: Set apiKey option when creating InputPromptAI

Error: "API Error: Invalid API key"
Solution: Check your OpenAI API key is correct and active
```

### Response Issues
```
Error: "Could not parse note numbers from response"
Cause: Model returned invalid JSON
Solution: Try a simpler, more specific prompt

Error: "Invalid note numbers in response"
Cause: Notes outside 0-127 range
Solution: Specify octave in prompt ("notes in the treble clef")
```

### UI Issues
```
Error: "Could not find main container element"
Cause: No main element exists when createGui() called
Solution: Ensure index.html has <main> element

Status shows error but no message
Cause: API error with no details
Solution: Check browser console for full error details
```

## Performance Considerations

- **API Call Time**: 1-3 seconds depending on model and complexity
- **Note Dispatch**: Instant after API returns
- **Playback Duration**: Depends on note count and duration (default 500ms per note)
- **Memory**: Minimal - only stores response notes and UI elements

## Security Notes

- Store API keys in environment variables, never in code
- Use CORS properly if deploying to production
- Consider using proxy/backend for API calls in public deployments
- Validate API responses before dispatch
