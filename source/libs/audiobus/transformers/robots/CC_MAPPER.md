# CC Mapper Transformer

Adds MIDI Control Change (CC) codes to the audio command stream based on a JSON descriptor. Maps note numbers, velocity ranges, or command types to specific CC values.

## Features

- Map note ranges to CC values (e.g., high notes trigger modulation)
- Map velocity ranges to CC values (e.g., soft notes = low CC, loud notes = high CC)
- Trigger on specific command types
- Optional passthrough of original commands
- Multiple descriptors in a single transformer

## JSON Descriptor Format

```typescript
interface CCMapDescriptor {
  // MIDI CC number (0-127)
  controller: number
  
  // CC value to send (0-127)
  value: number
  
  // Optional: trigger on note range [min, max]
  noteRange?: [number, number]
  
  // Optional: trigger on velocity range [min, max]
  velocityRange?: [number, number]
  
  // Optional: trigger on specific command type
  commandType?: string
}
```

## Examples

### Example 1: Volume Control
Send CC 7 (volume) at full value when any note plays:

```json
[
  {
    "controller": 7,
    "value": 127,
    "commandType": "note-on"
  }
]
```

### Example 2: Velocity-Based Modulation
Map velocity ranges to modulation wheel (CC 1):

```json
[
  {
    "controller": 1,
    "value": 127,
    "velocityRange": [100, 127]
  },
  {
    "controller": 1,
    "value": 64,
    "velocityRange": [64, 99]
  },
  {
    "controller": 1,
    "value": 32,
    "velocityRange": [0, 63]
  }
]
```

### Example 3: Note Range Expression
Send expression (CC 11) based on note range:

```json
[
  {
    "controller": 11,
    "value": 50,
    "noteRange": [36, 48]
  },
  {
    "controller": 11,
    "value": 85,
    "noteRange": [49, 60]
  },
  {
    "controller": 11,
    "value": 127,
    "noteRange": [61, 127]
  }
]
```

### Example 4: Multiple Conditions
Note range AND velocity range (all conditions must match):

```json
[
  {
    "controller": 7,
    "value": 127,
    "noteRange": [60, 72],
    "velocityRange": [100, 127]
  }
]
```

## Configuration Options

- **insertCC** (boolean): Whether to insert CC commands into the stream. Default: `true`
- **passthrough** (boolean): Whether to pass original commands through. Default: `true`

## Usage in Code

### Load from JSON String

```typescript
import { TransformerCCMapper } from "./transformer-cc-mapper.ts"

const mapper = new TransformerCCMapper()
const descriptor = JSON.stringify([
  { controller: 7, value: 127, commandType: "note-on" }
])
mapper.loadDescriptor(descriptor)
```

### Load from Object

```typescript
import { createCCMapperFromDescriptor } from "./transformer-cc-mapper.ts"

const mapper = createCCMapperFromDescriptor([
  { controller: 7, value: 127, commandType: "note-on" }
])
```

### Use Built-in Examples

```typescript
import { TransformerCCMapper, EXAMPLE_DESCRIPTORS } from "./transformer-cc-mapper.ts"

const mapper = new TransformerCCMapper()
mapper.loadDescriptor(EXAMPLE_DESCRIPTORS.velocityToModulation)
```

## MIDI CC Reference

| Number | Name | Use Case |
|--------|------|----------|
| 1 | Modulation Wheel | Dynamic timbral effects |
| 7 | Channel Volume | Overall output level |
| 10 | Pan | Left/right stereo positioning |
| 11 | Expression | Dynamic control over time |
| 64 | Sustain Pedal | Hold notes |
| 65 | Portamento | Smooth pitch transitions |
| 91 | Reverb Send | Effects depth |
| 93 | Chorus Send | Effects depth |

## Notes

- All matching descriptors are applied to each command
- Multiple matches stack (all matching CCs are sent)
- Original command order is preserved
- If `passthrough` is disabled, only CC commands are sent
- If `insertCC` is disabled, original commands pass through unchanged
