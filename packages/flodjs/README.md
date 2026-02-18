# @harmoneasy/flodjs

Flod.js music composition library integration for HarmonEasy.

## Overview

This package integrates Flod.js, a live coding environment for music composition:
- Pattern-based music generation
- Live coding support
- Algorithmic composition
- Educational music programming
- Real-time pattern editing

## Installation

```bash
pnpm install @harmoneasy/flodjs
```

## Usage

### Basic Pattern Creation

```typescript
import { Pattern, Synth } from '@harmoneasy/flodjs'

const pattern = new Pattern()
pattern.add('C4 8n', 'D4 8n', 'E4 8n', 'F4 8n')

const synth = new Synth()
synth.play(pattern)
```

### Live Coding

```typescript
import { LiveCoder } from '@harmoneasy/flodjs'

const coder = new LiveCoder()

// Define patterns with Flod.js syntax
const code = `
bass = "C1 1/4 G#0 1/4"
lead = "C4 1/16 D4 1/16 E4 1/16 F4 1/16"
drums = "x o x o"
`

coder.execute(code)
coder.play()
```

### Pattern Definition

```typescript
import { Pattern } from '@harmoneasy/flodjs'

// Notation: note duration (8n = eighth note, 4n = quarter note)
const melody = new Pattern('C4 4n D4 8n E4 8n F4 4n')

// Chords
const harmony = new Pattern('Cmaj 4n Dmin 4n Em 4n F 4n')

// Rests (using '-')
const rhythm = new Pattern('x - x o - x o x')

// Repeats
const loop = new Pattern('(C4 D4 E4)x2')
```

### Integration with HarmonEasy

```typescript
import { FlodJSIntegration } from '@harmoneasy/flodjs'
import { AudioEngine } from '@harmoneasy/audiobus'

const flodjs = new FlodJSIntegration()
const engine = new AudioEngine()

// Route Flod.js output to audio engine
flodjs.on('noteOn', (note, velocity) => {
  engine.noteOn(note, velocity)
})

flodjs.on('noteOff', (note) => {
  engine.noteOff(note)
})

// Start playing
await flodjs.play()
```

### Synth Instruments

```typescript
import { Synth, SynthOptions } from '@harmoneasy/flodjs'

const options: SynthOptions = {
  waveType: 'triangle', // 'sine', 'square', 'sawtooth', 'triangle'
  envelope: {
    attack: 0.01,
    decay: 0.1,
    sustain: 0.7,
    release: 0.5
  },
  filter: {
    frequency: 2000,
    resonance: 5,
    envelope: {
      attack: 0.02,
      decay: 0.2,
      sustain: 0.3,
      release: 0.4
    }
  }
}

const synth = new Synth(options)
synth.play(pattern)
```

### Drum Machine

```typescript
import { DrumMachine, DrumKit } from '@harmoneasy/flodjs'

const kit: DrumKit = {
  kick: 'C1 1/4',
  snare: '- x -',
  hihat: 'x x x x'
}

const drums = new DrumMachine(kit)
drums.play()
```

### Effect Chain

```typescript
import { Synth, Effects } from '@harmoneasy/flodjs'

const synth = new Synth()

// Add effects
synth.addEffect(new Effects.Reverb({
  decay: 3,
  wet: 0.3
}))

synth.addEffect(new Effects.Delay({
  time: 0.5,
  feedback: 0.4,
  wet: 0.2
}))

synth.play(pattern)
```

## API Reference

### Pattern

```typescript
class Pattern {
  constructor(notation?: string)
  add(...notes: string[]): void
  play(): void
  stop(): void
  setTempo(bpm: number): void
  getLength(): number
}
```

### Synth

```typescript
class Synth {
  constructor(options?: SynthOptions)
  play(pattern: Pattern): void
  stop(): void
  setWaveType(type: WaveType): void
  addEffect(effect: Effect): void
  removeEffect(effect: Effect): void
}
```

### LiveCoder

```typescript
class LiveCoder {
  execute(code: string): void
  play(): void
  stop(): void
  clear(): void
  getPatterns(): Pattern[]
}
```

### DrumMachine

```typescript
class DrumMachine {
  constructor(kit: DrumKit)
  play(): void
  stop(): void
  setKit(kit: DrumKit): void
}
```

## Notation Guide

### Notes
```
C4 C#4 D4 D#4 E4 F4 F#4 G4 G#4 A4 A#4 B4
```

### Durations
```
1w   - whole note
1h   - half note
1q   - quarter note
8n   - eighth note
16n  - sixteenth note
32n  - thirty-second note
```

### Chords
```
Cmaj Dmin Em F Gmaj
```

### Drums
```
x - kick
o - snare
h - hi-hat
t - tom
```

## Examples

### Simple Melody

```typescript
import { Pattern, Synth } from '@harmoneasy/flodjs'

const pattern = new Pattern()
pattern.add(
  'C4 4n', 'D4 4n', 'E4 4n', 'F4 4n',
  'G4 2n'
)

const synth = new Synth({
  waveType: 'sine',
  envelope: { attack: 0.01, decay: 0.1, sustain: 0.7, release: 0.2 }
})

synth.play(pattern)
```

### Looping Sequence

```typescript
const sequence = new Pattern('(C4 D4 E4 F4)x4')
synth.setTempo(120)
synth.play(sequence)
```

### Interactive Performance

```typescript
const coder = new LiveCoder()

// User types patterns in real-time
document.getElementById('editor').addEventListener('input', (e) => {
  const code = e.target.value
  try {
    coder.execute(code)
    coder.play()
  } catch (error) {
    console.error('Syntax error:', error)
  }
})
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14.1+
- Edge 90+

Requires Web Audio API.

## Performance

- Suitable for real-time pattern editing
- Can handle complex pattern combinations
- Optimized for live coding performance

## License

MIT

## See Also

- [@harmoneasy/audiobus](../audiobus) - Audio engine
- [Flod.js](https://github.com/rvega/flod)
- [Live Coding](https://toplap.org/)
- [Algorithmic Composition](https://en.wikipedia.org/wiki/Algorithmic_composition)
