# @harmoneasy/pitfalls

Music theory utilities for scales, intervals, chords, and microtonality.

## Overview

Pitfalls provides comprehensive music theory tools for:
- Scale generation and analysis
- Interval calculations
- Chord recognition and generation
- Equal Division of Octave (EDO) microtonal systems
- Note transposition
- Harmonic analysis

## Installation

```bash
pnpm install @harmoneasy/pitfalls
```

## Usage

### Scales

```typescript
import { Scale } from '@harmoneasy/pitfalls'

// Create C Major scale
const scale = new Scale('major', 60) // C4

// Get scale notes
const notes = scale.getNotes() // [60, 62, 64, 65, 67, 69, 71]

// Get scale degree names
scale.getDegree(0) // 'root'
scale.getDegree(2) // 'third'
scale.getDegree(4) // 'fifth'

// Check if note is in scale
scale.contains(64) // true
scale.contains(63) // false

// Get scale intervals
const intervals = scale.getIntervals() // [2, 2, 1, 2, 2, 2, 1]
```

### Available Scales

- `major` - Ionian mode
- `minor` - Natural minor (Aeolian)
- `harmonic_minor` - Harmonic minor
- `melodic_minor` - Melodic minor
- `dorian` - Dorian mode
- `phrygian` - Phrygian mode
- `lydian` - Lydian mode
- `mixolydian` - Mixolydian mode
- `locrian` - Locrian mode
- `pentatonic_major` - Major pentatonic
- `pentatonic_minor` - Minor pentatonic
- `blues` - Blues scale
- `chromatic` - All 12 semitones

### Intervals

```typescript
import { Interval } from '@harmoneasy/pitfalls'

// Create interval
const interval = new Interval('perfect_fifth', 60)
console.log(interval.semitones) // 7
console.log(interval.getCentsDeviation()) // 0

// Transpose note by interval
const transposed = interval.transpose(60)
console.log(transposed) // 67 (G4)

// Get interval name
const interval2 = Interval.fromSemitones(4) // 4 semitones
console.log(interval2.name) // 'major_third'
```

### Available Intervals

- `minor_second` (1 semitone)
- `major_second` (2 semitones)
- `minor_third` (3 semitones)
- `major_third` (4 semitones)
- `perfect_fourth` (5 semitones)
- `augmented_fourth` (6 semitones)
- `perfect_fifth` (7 semitones)
- `minor_sixth` (8 semitones)
- `major_sixth` (9 semitones)
- `minor_seventh` (10 semitones)
- `major_seventh` (11 semitones)
- `octave` (12 semitones)

### Chords

```typescript
import { Chord } from '@harmoneasy/pitfalls'

// Create chord
const chord = new Chord('maj7', 60) // C Major 7

// Get chord notes
console.log(chord.notes) // [60, 64, 67, 71]

// Get chord intervals
console.log(chord.intervals) // ['root', 'major_third', 'perfect_fifth', 'major_seventh']

// Invert chord
const inverted = chord.invert(1) // First inversion
console.log(inverted.notes) // [64, 67, 71, 60]

// Get chord name
console.log(chord.name) // 'Cmaj7'
```

### Available Chord Types

**Triads:**
- `major`, `maj`, `M` - Major (1, 3, 5)
- `minor`, `min`, `m` - Minor (1, b3, 5)
- `diminished`, `dim` - Diminished (1, b3, b5)
- `augmented`, `aug` - Augmented (1, 3, #5)

**Seventh Chords:**
- `maj7` - Major 7 (1, 3, 5, 7)
- `min7` - Minor 7 (1, b3, 5, b7)
- `dom7` - Dominant 7 (1, 3, 5, b7)
- `minmaj7` - Minor Major 7 (1, b3, 5, 7)
- `dim7` - Diminished 7 (1, b3, b5, b7)

**Extensions:**
- `maj9`, `min9`, `dom9` - 9th chords
- `maj11`, `min11`, `dom11` - 11th chords
- `maj13`, `min13`, `dom13` - 13th chords

### Equal Division of Octave (EDO)

```typescript
import { EDOSystem } from '@harmoneasy/pitfalls'

// Create 12-TET (standard tuning)
const edo12 = new EDOSystem(12)
console.log(edo12.getFrequency(60)) // 261.63 Hz

// Create alternative tuning system (e.g., 19-TET)
const edo19 = new EDOSystem(19)
const freq = edo19.getFrequency(60)

// Get cent deviation from 12-TET
const cents = edo19.getCentDeviation(60)
```

## API Reference

### Scale

```typescript
interface Scale {
  name: string
  root: number
  getNotes(): number[]
  getIntervals(): number[]
  getDegree(degree: number): string
  contains(note: number): boolean
  transpose(semitones: number): Scale
}
```

### Interval

```typescript
interface Interval {
  name: string
  semitones: number
  cents: number
  transpose(note: number): number
  invert(): Interval
}
```

### Chord

```typescript
interface Chord {
  name: string
  type: string
  root: number
  notes: number[]
  intervals: string[]
  invert(inversions: number): Chord
  contains(note: number): boolean
}
```

### EDOSystem

```typescript
interface EDOSystem {
  divisions: number
  getFrequency(note: number): number
  getNote(frequency: number): number
  getCentDeviation(note: number): number
}
```

## Examples

### Harmonization

```typescript
import { Scale, Chord } from '@harmoneasy/pitfalls'

const scale = new Scale('major', 60) // C Major
const scaleNotes = scale.getNotes()

// Build chord on each scale degree
const harmonizedChords = scaleNotes.map((root, degree) => {
  const chordType = ['maj7', 'min7', 'min7', 'maj7', 'dom7', 'min7', 'min7b5'][degree]
  return new Chord(chordType, root)
})
```

### Microtonality

```typescript
import { EDOSystem } from '@harmoneasy/pitfalls'

// Quarter-tone system (24 divisions)
const edo24 = new EDOSystem(24)
const quarterSharp = edo24.getFrequency(60.5) // Half of semitone sharp

// Neutral third tuning (19-TET)
const edo19 = new EDOSystem(19)
const neutralThird = edo19.getFrequency(64) // Between major and minor third
```

## License

MIT

## See Also

- [@harmoneasy/audiobus](../audiobus) - Audio engine
- [Music Theory](https://en.wikipedia.org/wiki/Music_theory)
- [12 Equal Temperament](https://en.wikipedia.org/wiki/Equal_temperament)
- [Just Intonation](https://en.wikipedia.org/wiki/Just_intonation)
