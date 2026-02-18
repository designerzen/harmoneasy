# @harmoneasy/audiotool

AudioTool SDK integration for HarmonEasy.

## Overview

This package provides integration with the AudioTool web platform, allowing HarmonEasy to:
- Export compositions to AudioTool projects
- Leverage AudioTool's synthesis and effects
- Share projects between applications
- Access AudioTool's plugin ecosystem

## Installation

```bash
pnpm install @harmoneasy/audiotool
```

## Usage

### Initialization

```typescript
import { AudioToolIntegration } from '@harmoneasy/audiotool'

const integration = new AudioToolIntegration()
await integration.initialize()
```

### Project Export

```typescript
// Export HarmonEasy project to AudioTool
const project = await integration.exportProject({
  name: 'My Song',
  bpm: 120,
  timeSignature: '4/4',
  tracks: audioTracks
})

// Open in AudioTool
window.open(project.url)
```

### MIDI Mapping

```typescript
// Route MIDI to AudioTool instruments
const mapping = integration.createMIDIMapping({
  channel: 1,
  instrument: 'Synth-A',
  effects: ['Reverb', 'Delay']
})

midiInput.routeTo(mapping)
```

### Audio Processing

```typescript
// Use AudioTool effects and instruments
const processor = await integration.createProcessor('Reverb', {
  decay: 2.0,
  wet: 0.5
})

audioOutput.addEffect(processor)
```

### Project Management

```typescript
// List available AudioTool projects
const projects = await integration.listProjects()

// Load project
const loaded = await integration.loadProject(projectId)

// Save project
await integration.saveProject(projectId, data)

// Share project
const shareUrl = await integration.shareProject(projectId)
```

## API Reference

### Classes

- **AudioToolIntegration** - Main integration class

### Methods

- `initialize()` - Initialize AudioTool connection
- `exportProject(data)` - Export to AudioTool project
- `importProject(url)` - Import AudioTool project
- `createMIDIMapping(config)` - Create MIDI routing
- `createProcessor(name, params)` - Create audio processor
- `listProjects()` - Get available projects
- `loadProject(id)` - Load specific project
- `saveProject(id, data)` - Save project data
- `shareProject(id)` - Generate share URL
- `isConnected()` - Check connection status

### Types

```typescript
interface AudioToolProject {
  id: string
  name: string
  bpm: number
  timeSignature: string
  url: string
  created: Date
  modified: Date
}

interface MIDIMapping {
  channel: number
  instrument: string
  effects: string[]
}

interface ProcessorConfig {
  name: string
  params: Record<string, number>
}
```

## Configuration

### Environment Variables

```bash
AUDIOTOOL_API_KEY=your_api_key
AUDIOTOOL_BASE_URL=https://www.audiotool.com
```

## Examples

### Export Composition

```typescript
import { AudioToolIntegration } from '@harmoneasy/audiotool'

const integration = new AudioToolIntegration()
await integration.initialize()

// Prepare project data
const projectData = {
  name: 'My Composition',
  bpm: 120,
  tracks: [
    {
      name: 'Piano',
      events: midiEvents,
      volume: 1.0
    }
  ]
}

// Export to AudioTool
const project = await integration.exportProject(projectData)
console.log(`Project URL: ${project.url}`)
```

### Real-time Routing

```typescript
// Route live MIDI to AudioTool
const midiInput = await createMIDIInput()
const mapping = integration.createMIDIMapping({
  channel: 1,
  instrument: 'Synth-A'
})

midiInput.onMessage((event) => {
  mapping.send(event.data)
})
```

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14.1+
- Edge 90+

Requires HTTPS for production use.

## Limitations

- Requires AudioTool account
- API key needed for advanced features
- Rate limiting applies to bulk operations
- Some features may require AudioTool Pro subscription

## License

MIT

## See Also

- [@harmoneasy/audiobus](../audiobus) - Audio engine
- [AudioTool](https://www.audiotool.com)
- [AudioTool API Docs](https://docs.audiotool.com)
