# OpenDAW

OpenDAW project file format support and .dawProject integration for HarmonEasy.

## Overview

This package provides comprehensive support for:
- OpenDAW (.dawProject) file format reading/writing
- DAW project interchange
- Standard audio project metadata
- Plugin automation and settings
- Cross-DAW compatibility

## Installation

```bash
pnpm install @harmoneasy/openDAW
```

## Usage

### Loading Projects

```typescript
import { openDAWLoader } from '@harmoneasy/openDAW'

// Load from file
const file = await fetch('project.dawProject')
const arrayBuffer = await file.arrayBuffer()
const project = await openDAWLoader.parse(arrayBuffer)

console.log(project.metadata.name) // Project name
console.log(project.tracks) // Array of tracks
```

### Saving Projects

```typescript
import { openDAWSaver } from '@harmoneasy/openDAW'

const projectData = {
  metadata: {
    name: 'My Song',
    author: 'John Doe',
    version: '1.0'
  },
  tracks: [
    {
      name: 'Piano',
      channel: 1,
      midiEvents: events
    }
  ]
}

const buffer = await openDAWSaver.serialize(projectData)
// Save buffer to file
```

### Exporting to DAW

```typescript
import { openDAWExporter } from '@harmoneasy/openDAW'

// Export HarmonEasy session to .dawProject
const exported = await openDAWExporter.exportSession({
  harmoneasyProject: currentProject,
  targetFormat: 'dawProject'
})

// Create download link
const blob = new Blob([exported], { type: 'audio/dawproject' })
const url = URL.createObjectURL(blob)
const a = document.createElement('a')
a.href = url
a.download = 'export.dawProject'
a.click()
```

### Project Metadata

```typescript
import { openDAWLoader } from '@harmoneasy/openDAW'

const project = await openDAWLoader.parse(buffer)

// Access metadata
console.log(project.metadata.name)
console.log(project.metadata.author)
console.log(project.metadata.description)
console.log(project.metadata.sampleRate)
console.log(project.metadata.tempo)
console.log(project.metadata.timeSignature)
```

### Track Management

```typescript
// Add track to project
const track = {
  id: 'track-1',
  name: 'Synth',
  channel: 1,
  volume: 1.0,
  pan: 0.0,
  midiEvents: [],
  audioClips: [],
  effects: []
}

project.tracks.push(track)

// Save updated project
const buffer = await openDAWSaver.serialize(project)
```

### Plugin Automation

```typescript
// Define plugin automation
const automation = {
  pluginId: 'reverb-1',
  parameter: 'decay',
  events: [
    { time: 0, value: 0.5 },
    { time: 4, value: 1.0 },
    { time: 8, value: 0.5 }
  ]
}

track.automation.push(automation)
```

## File Format

### .dawProject Structure

```
.dawProject (zip archive)
├── META-INF/
│   └── manifest.xml
├── ProjectMetadata.xml
├── Tracks.xml
├── MasterTrack.xml
├── Automation/
├── Plugins/
└── Media/
    ├── Audio/
    └── MIDI/
```

## API Reference

### Functions

- `openDAWLoader.parse(buffer)` - Parse .dawProject file
- `openDAWSaver.serialize(project)` - Serialize to .dawProject
- `openDAWExporter.exportSession(config)` - Export from HarmonEasy
- `openDAWValidator.validate(project)` - Validate project structure

### Types

```typescript
interface DAWProject {
  metadata: ProjectMetadata
  tracks: DAWTrack[]
  masterTrack?: DAWTrack
  tempo: number
  timeSignature: string
}

interface ProjectMetadata {
  name: string
  author?: string
  description?: string
  version: string
  sampleRate: number
  bitDepth: number
  created: Date
  modified: Date
}

interface DAWTrack {
  id: string
  name: string
  channel: number
  volume: number
  pan: number
  midiEvents: MIDIEvent[]
  audioClips: AudioClip[]
  effects: Effect[]
  automation: Automation[]
}

interface MIDIEvent {
  time: number
  duration: number
  note: number
  velocity: number
  channel: number
}

interface AudioClip {
  id: string
  name: string
  startTime: number
  duration: number
  file: string
}

interface Effect {
  id: string
  name: string
  params: Record<string, number>
}

interface Automation {
  pluginId: string
  parameter: string
  events: AutomationEvent[]
}
```

## Examples

### Round-trip Export/Import

```typescript
import { openDAWLoader, openDAWSaver } from '@harmoneasy/openDAW'

// Load existing project
const buffer1 = await fetch('original.dawProject').then(r => r.arrayBuffer())
const project = await openDAWLoader.parse(buffer1)

// Modify project
project.metadata.name = 'Modified Version'
project.tracks[0].volume = 0.8

// Save back
const buffer2 = await openDAWSaver.serialize(project)
```

### Full Export Pipeline

```typescript
import { openDAWExporter, openDAWSaver } from '@harmoneasy/openDAW'
import { exportAudio } from '@harmoneasy/audiobus'

// Get current HarmonEasy session
const session = getCurrentSession()

// Create DAW project
const dawProject = await openDAWExporter.exportSession({
  harmoneasyProject: session,
  includeAudio: true,
  audioFormat: 'wav'
})

// Serialize and download
const buffer = await openDAWSaver.serialize(dawProject)
const blob = new Blob([buffer], { type: 'application/zip' })
downloadBlob(blob, `${session.name}.dawProject`)
```

## Supported DAWs

The .dawProject format is supported by:
- Serum (native support)
- Cakewalk by BandLab
- BandLab
- Many upcoming DAWs

## Limitations

- Audio clips require proper file references
- Plugin parameters limited to standard parameters
- Requires OPFS or File System Access API for file operations

## License

MIT

## See Also

- [@harmoneasy/audiobus](../audiobus) - Audio engine
- [openDAW Specification](https://www.opendaw.com)
- [.dawProject Format](https://www.dawproject.com)
