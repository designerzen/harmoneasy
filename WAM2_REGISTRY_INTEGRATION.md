# WAM2 Registry Integration Guide

This guide explains how to use the WAM2 registry integration to select and load WAM2 audio plugins from the online community registry.

## Overview

The WAM2 registry integration consists of two main components:

1. **WAM2Registry** (`wam2-registry.ts`) - Manages fetching and caching plugins from the online registry
2. **OutputWAM2** (enhanced `output-wam2.ts`) - Implements plugin selection GUI and audio output

## Features

- ✅ Fetch plugins from https://www.webaudiomodules.com/community/plugins.json
- ✅ Search and filter plugins by name, vendor, keywords
- ✅ Browse plugins by category (Instrument, Effect, Modulation, etc.)
- ✅ Real-time plugin switching with automatic unload/load
- ✅ Interactive GUI with plugin details display
- ✅ Full TypeScript support with type safety

## Quick Start

### Basic Usage

```typescript
import OutputWAM2 from './source/libs/audiobus/io/outputs/output-wam2.ts'
import wam2Registry from './source/libs/audiobus/io/outputs/wam/registry.ts'

// Create a WAM2 output
const wam = new OutputWAM2(audioContext)

// Initialize and create GUI
await wam.initialize() // Optional if you want to load without GUI
const gui = await wam.createGui() // Shows plugin selector UI
document.getElementById('container').appendChild(gui)

// Once a plugin is loaded, use it
wam.noteOn(60, 127) // C4, full velocity
wam.noteOff(60)
```

### With Preset Plugin URL

```typescript
import OutputWAM2 from './source/libs/audiobus/io/outputs/output-wam2.ts'
import wam2Registry from './source/libs/audiobus/io/outputs/wam/registry.ts'

const wam = new OutputWAM2(audioContext)
const pluginUrl = wam2Registry.getPluginUrl(somePluginDescriptor)
const wam2 = new OutputWAM2(audioContext, pluginUrl, "My Synth")
await wam2.initialize()
```

## WAM2Registry API

The registry singleton is located at `source/libs/audiobus/io/outputs/wam/registry.ts` and provides the following methods:

### Initialization

```typescript
await wam2Registry.initialize()
```

Fetches plugins from the online registry. Call once before using other methods.

### Getting Plugins

```typescript
// Get all plugins
const allPlugins = wam2Registry.getAll()

// Get by identifier
const plugin = wam2Registry.getById('com.sequencerParty.synth101')

// Get by category
const instruments = wam2Registry.getByCategory('Instrument')
const effects = wam2Registry.getEffects()
const utilities = wam2Registry.getUtilities()

// Search by text
const results = wam2Registry.search('synth')
```

### Plugin Metadata

```typescript
// Get full plugin URL for loading
const url = wam2Registry.getPluginUrl(plugin)

// Get thumbnail URL
const thumbUrl = wam2Registry.getThumbnailUrl(plugin)

// Get plugins grouped by category
const grouped = wam2Registry.getGroupedByCategory()
// Returns: Map<string, WAM2PluginDescriptor[]>
```

## Plugin Types

Available categories include:

- **Instrument** - Synthesizers and samplers (Synth-101, Soundfont Player, etc.)
- **Effect** - Audio effects (Distortion, Reverb, Delay, EQ, Modulation, etc.)
- **Modulation** - Modulators and envelope followers
- **MIDI** - MIDI utilities and sequencers
- **Utility** - General utilities
- **Video** - Video generators and effects
- **Visualization** - Visual displays (Oscilloscope, Spectrogram, etc.)

## Creating Custom GUIs

If you don't want to use the built-in GUI, you can create your own:

```typescript
import wam2Registry from './source/libs/audiobus/io/outputs/wam/registry.ts'

await wam2Registry.initialize()

// Search for synths
const synths = wam2Registry.getByCategory('Instrument')
  .filter(p => p.keywords.includes('synthesizer'))

// Load a specific plugin
const selected = synths[0]
await wam.loadPlugin(selected)

// Get metadata
console.log(selected.name)        // "Synth-101"
console.log(selected.vendor)      // "Sequencer Party"
console.log(selected.description) // Full description
```

## GUI Features

The built-in GUI (`createGui()`) provides:

- **Current Plugin Display** - Shows loaded plugin info with vendor and description
- **Search Box** - Real-time search across plugin names, vendors, and keywords
- **Category Filter** - Dropdown to filter by category
- **Plugin List** - Scrollable list of matching plugins with vendor and category tags
- **Click to Load** - Click any plugin to immediately load it
- **Visual Feedback** - Highlighted selection and hover effects

### Styling

The GUI uses dark theme (#1e1e1e background) with light text. You can customize by modifying the `createGui()` method or wrapping it with your own CSS.

## Error Handling

The implementation includes error handling for:

- Network failures when fetching registry
- Invalid or missing WAM2 plugins
- Plugin loading failures
- Plugin switching errors

Errors are logged to console and displayed in the GUI where appropriate.

## Plugin Descriptor Format

Each plugin has this structure:

```typescript
interface WAM2PluginDescriptor {
  identifier: string           // Unique ID (e.g., "com.sequencerParty.synth101")
  name: string                 // Display name
  vendor: string               // Creator/vendor
  website?: string             // Optional vendor website
  description: string          // Plugin description
  keywords: string[]           // Search tags
  category: string[]           // Categories (multiple possible)
  thumbnail?: string           // Path to thumbnail image
  thumbnailDimensions?: {
    width: number
    height: number
  }
  path: string                 // Relative path to index.js on webaudiomodules.com
}
```

## Integration with HarmonEasy

To integrate into the HarmonEasy UI graph:

1. **Create an OutputNode** for WAM2:
   ```tsx
   import OutputWAM2 from '../../libs/audiobus/io/outputs/output-wam2.ts'
   
   const wam = new OutputWAM2(audioContext)
   // OutputNode will call createGui() automatically when added to graph
   ```

2. **The OutputNode component** already checks for `createGui` and `destroyGui` methods:
   ```tsx
   if (output?.createGui && output?.destroyGui) {
     gui = await output.createGui()
   }
   ```

3. **No additional changes needed** - WAM2 output works like any other output with GUI support

## Performance Considerations

- Registry is fetched once and cached in memory
- Plugin switching may take a moment due to unload/load cycle
- Network fetch happens on first `createGui()` call
- No blocking operations - all async/await

## Browser Support

Requires:
- Modern browser with Web Audio API
- ES2020+ JavaScript support
- Fetch API for registry download
- No external dependencies beyond Web Audio APIs

## Example: Creating a Synth Instrument Panel

```typescript
import OutputWAM2 from './output-wam2.ts'
import wam2Registry from './wam2-registry.ts'

async function createSynthPanel() {
  const container = document.getElementById('synth-panel')
  const wam = new OutputWAM2(audioContext)
  
  // Get only instruments
  await wam2Registry.initialize()
  const instruments = wam2Registry.getInstruments()
  
  // Create GUI
  const gui = await wam.createGui()
  container.appendChild(gui)
  
  // Now users can select an instrument and play notes
  return wam
}
```

## Troubleshooting

**"WAM2 host not available"**
- Ensure WAM2 polyfill is loaded in your HTML
- Check browser console for more details

**"Failed to initialize WAM2 plugin"**
- Plugin URL might be invalid
- Browser security/CORS issues
- Plugin format incompatibility

**"No plugins found" in GUI**
- Registry fetch failed (check network tab)
- Filter is too restrictive
- Try clearing search/category filters

**Plugin doesn't produce sound**
- Not all WAM2 plugins are instruments
- Some require specific MIDI setup
- Check browser console for plugin-specific errors

## Future Enhancements

Possible improvements:

- [ ] Plugin thumbnail display in selector
- [ ] Plugin ratings/reviews
- [ ] Local plugin caching
- [ ] WAM2 plugin parameters automation UI
- [ ] Preset save/load for plugin parameters
- [ ] Plugin chaining/pedalboard support
- [ ] Real-time parameter display
- [ ] Plugin comparison view

## References

- [Web Audio Modules Documentation](https://www.webaudiomodules.com/docs/intro)
- [WAM2 GitHub Repository](https://github.com/webaudiomodules)
- [WAM Community Plugin Registry](https://www.webaudiomodules.com/community)
- [WAM Examples](https://github.com/boourns/wam-community)
