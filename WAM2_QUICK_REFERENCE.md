# WAM2 Registry - Quick Reference

## TL;DR

```typescript
// 1. Create WAM2 output
const wam = new OutputWAM2(audioContext)

// 2. Show plugin selector GUI
const gui = await wam.createGui()
document.body.appendChild(gui)

// 3. User clicks a plugin... then:
wam.noteOn(60, 127)   // Play note C4 at full velocity
wam.noteOff(60)       // Stop note
```

---

## Registry API

```typescript
// Initialize (one-time)
await wam2Registry.initialize()

// Get plugins
wam2Registry.getAll()                    // All plugins
wam2Registry.getInstruments()            // Instruments only
wam2Registry.getEffects()                // Effects only
wam2Registry.search("synth")             // Search
wam2Registry.getByCategory("Instrument") // By category
wam2Registry.getById("com....")          // By ID

// Get URLs
wam2Registry.getPluginUrl(plugin)        // Load URL
wam2Registry.getThumbnailUrl(plugin)     // Thumbnail URL

// Organization
wam2Registry.getGroupedByCategory()      // Map<category, plugins>
```

---

## OutputWAM2 API

```typescript
// Create
const wam = new OutputWAM2(audioContext)
const wam = new OutputWAM2(audioContext, "plugin-url")
const wam = new OutputWAM2(audioContext, undefined, "Name")

// GUI
const gui = await wam.createGui()       // Interactive selector
await wam.destroyGui()                  // Cleanup

// Loading
await wam.loadPlugin(descriptor)        // Load plugin by descriptor
await wam.connect()                     // Load plugin by URL

// Control
wam.noteOn(noteNumber, velocity)        // Play note (0-127 velocity)
wam.noteOff(noteNumber)                 // Stop note
wam.allNotesOff()                       // Silence all
wam.sendControlChange(cc, value, chan)  // Send CC message
wam.processMidi([status, data1, data2]) // Send raw MIDI

// Info
wam.getPluginInfo()                     // Get loaded plugin metadata
wam.getActiveNoteCount()                // Count playing notes

// Cleanup
await wam.disconnect()                  // Unload plugin
```

---

## Plugin Categories

| Category | Examples |
|----------|----------|
| **Instrument** | Synth-101, Soundfont Player, Modal |
| **Effect** | Distortion, Reverb, Delay, EQ, Filter |
| **Modulation** | Phaser, Flanger, Envelope Follower |
| **MIDI** | Piano Roll, Sequencer, MIDI I/O |
| **Utility** | Audio Input, MIDI Debug |
| **Video** | ButterChurn, ISF Shader, ThreeJS |
| **Visualization** | Oscilloscope, Spectrogram |

---

## Code Snippets

### Find Synth-101
```typescript
const synth = wam2Registry.getById('com.sequencerParty.synth101')
if (synth) await wam.loadPlugin(synth)
```

### Play C Major Scale
```typescript
const notes = [60, 62, 64, 65, 67]  // C D E F G
notes.forEach((n, i) => {
  setTimeout(() => wam.noteOn(n, 100), i * 400)
  setTimeout(() => wam.noteOff(n), i * 400 + 300)
})
```

### Search for Distortions
```typescript
const distortions = wam2Registry.search('distortion')
distortions.forEach(p => console.log(p.name))
```

### List All Instruments
```typescript
const instruments = wam2Registry.getInstruments()
instruments.forEach(p => {
  console.log(`${p.name} by ${p.vendor}`)
})
```

### Custom Plugin Picker
```typescript
const effects = wam2Registry.getEffects()
effects.forEach(plugin => {
  const btn = document.createElement('button')
  btn.textContent = plugin.name
  btn.onclick = () => wam.loadPlugin(plugin)
  document.body.appendChild(btn)
})
```

---

## Plugin Object

```typescript
{
  identifier: string              // "com.vendor.plugin-name"
  name: string                    // "Plugin Name"
  vendor: string                  // "Vendor Name"
  website?: string                // Optional vendor site
  description: string             // Full description
  keywords: string[]              // ["synth", "wavetable", ...]
  category: string[]              // ["Instrument", "Synthesizer"]
  thumbnail?: string              // Image path
  thumbnailDimensions?: {width, height}
  path: string                    // Relative path to index.js
}
```

---

## MIDI Notes Reference

```
C4 = 60   C#4 = 61  D4 = 62   D#4 = 63  E4 = 64   F4 = 65
F#4 = 66  G4 = 67   G#4 = 68  A4 = 69   A#4 = 70  B4 = 71
C5 = 72   (middle C is C4 = 60)
```

---

## Common CC Messages

| CC | Name | Range |
|----|------|-------|
| 1 | Modulation Wheel | 0-127 |
| 7 | Volume | 0-127 |
| 10 | Pan | 0 (L) to 127 (R) |
| 11 | Expression | 0-127 |
| 74 | Filter Cutoff | 0-127 |
| 123 | All Notes Off | 0 |

```typescript
wam.sendControlChange(7, 100, 0)   // Volume = 100 on channel 0
wam.sendControlChange(74, 64, 0)   // Filter = middle position
```

---

## Common Patterns

### Play a Chord
```typescript
wam.noteOn(60, 100)  // C
wam.noteOn(64, 100)  // E
wam.noteOn(67, 100)  // G
setTimeout(() => wam.allNotesOff(), 2000)
```

### Fade Volume
```typescript
for (let v = 127; v > 0; v -= 5) {
  setTimeout(() => wam.sendControlChange(7, v), (127-v) * 50)
}
```

### Filter Sweep
```typescript
for (let f = 0; f <= 127; f += 2) {
  setTimeout(() => wam.sendControlChange(74, f), f * 30)
}
```

### Arpeggio
```typescript
const notes = [60, 64, 67, 72]
let i = 0
setInterval(() => {
  wam.noteOff(notes[i % notes.length])
  wam.noteOn(notes[++i % notes.length], 100)
}, 400)
```

---

## Error Handling

```typescript
try {
  const gui = await wam.createGui()
  document.body.appendChild(gui)
} catch (error) {
  console.error('Failed to create GUI:', error)
  // Fallback: manual selection or error message
}
```

---

## Browser DevTools Tips

```javascript
// In console to explore registry:
wam2Registry.getAll()                    // See all plugins
wam2Registry.search("synth")             // Search results
wam2Registry.getGroupedByCategory()      // Category map

// Find a specific plugin:
wam2Registry.getAll().find(p => p.name.includes("Synth"))

// Get plugin URL:
const p = wam2Registry.getAll()[0]
wam2Registry.getPluginUrl(p)             // Full URL to load
```

---

## Integration with HarmonEasy

```typescript
import OutputWAM2 from './source/libs/audiobus/io/outputs/output-wam2.ts'

// Create and add to chain
const wam = new OutputWAM2(audioContext)
const chain = (window as any).chain as IOChain
chain.addOutput(wam)

// OutputNode automatically calls createGui()
// GUI appears in the node's container
```

---

## Performance Notes

- **Registry fetch:** ~500ms on first `createGui()` call
- **Plugin loading:** 1-3 seconds depending on plugin
- **Note response:** < 1ms (sample-accurate)
- **Search:** Instant (< 10ms)
- **Memory:** ~5MB for registry + active plugin

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No plugins in GUI | Check network, reload page |
| Plugin won't load | Check browser console for errors |
| No sound | Make sure you called `noteOn()` |
| GUI not visible | Check z-index, parent element display |
| Plugin crashes | Try a different plugin, check console |

---

## Resources

- 📖 [Full Integration Guide](./WAM2_REGISTRY_INTEGRATION.md)
- 💻 [Code Examples](./examples/wam2-registry-usage.ts)
- 📋 [Implementation Details](./WAM2_IMPLEMENTATION_SUMMARY.md)
- 🌐 [WAM2 Docs](https://www.webaudiomodules.com/)
- 🎵 [Community Plugins](https://www.webaudiomodules.com/community)

---

**Last Updated:** 2026-01-31
