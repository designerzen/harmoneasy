# @harmoneasy/pink-trombone

Pink Trombone speech synthesis integration for HarmonEasy.

## Overview

This package integrates Neil Thapen's Pink Trombone vocal synthesizer for:
- Speech synthesis from MIDI input
- Realistic vocal formant manipulation
- Pitch and duration control
- Real-time voice manipulation
- Expressive vocal performance

## Installation

```bash
pnpm install @harmoneasy/pink-trombone
```

## Usage

### Basic Voice Synthesis

```typescript
import { PinkTrombone } from '@harmoneasy/pink-trombone'

const voice = new PinkTrombone(audioContext)
await voice.initialize()

// Play a note
voice.play(60) // Middle C

// Stop playing
voice.stop()
```

### Vocal Parameters

```typescript
// Adjust vibrato
voice.setVibrato({
  amount: 0.5,
  speed: 5.0
})

// Control vocal tract
voice.setVocalTract({
  tenseness: 0.6,
  intensity: 0.8
})

// Set formants for vowel shaping
voice.setVowel({
  vowel: 'a', // 'a', 'e', 'i', 'o', 'u'
  brightness: 0.5
})
```

### MIDI Integration

```typescript
import { PinkTrombone } from '@harmoneasy/pink-trombone'

const voice = new PinkTrombone(audioContext)
await voice.initialize()

// Listen to MIDI input
midiInput.onNoteOn(({ note, velocity }) => {
  // Convert velocity to vocal intensity
  const intensity = velocity / 127
  voice.setIntensity(intensity)
  voice.play(note)
})

midiInput.onNoteOff(({ note }) => {
  voice.stop()
})
```

### Voice Modulation

```typescript
// Breathing simulation
voice.setBreathing({
  enabled: true,
  amount: 0.1,
  speed: 2.0
})

// Throat vibration
voice.setVibrato({
  amount: 0.3,
  speed: 6.0,
  phase: 0
})

// Tongue position
voice.setTonguePosition({
  x: 0.5, // -1 to 1
  y: 0.5  // -1 to 1
})
```

### Real-time Control

```typescript
// Automate vocal parameters
const automation = {
  tenseness: {
    initial: 0.5,
    target: 0.8,
    duration: 2000 // ms
  },
  intensity: {
    initial: 0.6,
    target: 0.9,
    duration: 1500
  }
}

voice.automate(automation)

// Morph between vowels
voice.morphVowel('a', 'e', 1000) // 1 second transition
```

## API Reference

### PinkTrombone Class

```typescript
class PinkTrombone {
  constructor(audioContext: AudioContext)
  initialize(): Promise<void>
  play(note: number): void
  stop(): void
  setIntensity(value: number): void
  setVibrato(params: VibratoParams): void
  setVocalTract(params: VocalTractParams): void
  setVowel(params: VowelParams): void
  setBreathing(params: BreathingParams): void
  setTonguePosition(params: Position): void
  automate(animation: AutomationParams): void
  morphVowel(from: Vowel, to: Vowel, duration: number): void
  getOutput(): AudioNode
  dispose(): void
}
```

### Types

```typescript
type Vowel = 'a' | 'e' | 'i' | 'o' | 'u'

interface VibratoParams {
  amount: number // 0-1
  speed: number // Hz
  phase?: number // 0-1
}

interface VocalTractParams {
  tenseness: number // 0-1 (rougher to smoother)
  intensity: number // 0-1
}

interface VowelParams {
  vowel: Vowel
  brightness: number // 0-1
}

interface BreathingParams {
  enabled: boolean
  amount: number // 0-1
  speed: number // Hz
}

interface Position {
  x: number // -1 to 1
  y: number // -1 to 1
}

interface AutomationParams {
  [key: string]: {
    initial: number
    target: number
    duration: number
  }
}
```

## Examples

### Singing Bot

```typescript
import { PinkTrombone } from '@harmoneasy/pink-trombone'
import { Scale } from '@harmoneasy/pitfalls'

const voice = new PinkTrombone(audioContext)
await voice.initialize()

const scale = new Scale('major', 60) // C Major
const notes = scale.getNotes()

// Simple melody
for (const note of notes) {
  voice.play(note)
  voice.setVowel({ vowel: 'a' })
  await sleep(500)
  voice.stop()
  await sleep(100)
}
```

### Vocal Expression

```typescript
// Create expressive vocal phrase
voice.morphVowel('a', 'e', 200)
await sleep(200)
voice.morphVowel('e', 'i', 200)
await sleep(200)
voice.morphVowel('i', 'o', 200)
await sleep(200)

// Add vibrato as note sustains
voice.setVibrato({
  amount: 0.4,
  speed: 5.0
})
```

### Lyric-based Control

```typescript
const lyrics = [
  { word: 'Hello', notes: [60, 62], vowel: 'e' },
  { word: 'World', notes: [64], vowel: 'o' }
]

for (const { word, notes, vowel } of lyrics) {
  voice.setVowel({ vowel })
  for (const note of notes) {
    voice.play(note)
    await sleep(500)
  }
  voice.stop()
}
```

## Performance Considerations

- Pink Trombone is CPU-intensive
- Use `dispose()` when finished to free resources
- Can handle multiple instances but may affect performance
- Real-time parameter changes require smooth automation

## Browser Support

- Chrome 60+
- Firefox 55+
- Safari 14.1+
- Edge 79+

Requires Web Audio API.

## Limitations

- Monophonic only (one note at a time)
- Formant-based vowels (not phoneme-based)
- Limited consonant support
- No built-in lyric system

## Credits

Pink Trombone created by [Neil Thapen](https://dood.al/pinktrombone/)

## License

MIT (wrapper)
Pink Trombone has its own license - see original source

## See Also

- [@harmoneasy/audiobus](../audiobus) - Audio engine
- [Pink Trombone](https://dood.al/pinktrombone/)
- [Vocal Synthesis](https://en.wikipedia.org/wiki/Speech_synthesis)
