# opendaw

Harmoneasy's recorded-note adapter for the openDAW scripting editor. The directory is `openDAW`, but the workspace package and import name is lowercase `opendaw`; see [package.json](package.json).

## Export a recording as a script

```ts
import { createOpenDAWProjectFromAudioEventRecording } from "opendaw"
const script = await createOpenDAWProjectFromAudioEventRecording(recording, { BPM: 120 })
// Show the text for copying into openDAW's scripting editor.
```

The host supplies `recording.events`, `duration` and `name` from audiobus's event recorder. Timestamps and duration use seconds. The adapter pairs notes by chain, source, channel and pitch, converts them to 960 pulses per quarter note, normalises velocity to 0–1, and returns a script creating one Vaporisateur note track. Tempo must be finite, 30–1000 BPM. This early scripting integration does not preserve a whole instrument/effect graph or distribute sample assets.

The only active public export is in [index.ts](index.ts), implemented in [the adapter](adapter-opendaw-audio-events-recording.ts). The former `openDAWLoader`, `openDAWSaver`, `openDAWExporter`, `openDAWValidator` and `@harmoneasy/openDAW` examples described unimplemented modules.

## Related integrations

- [audiobus DAWproject exporter](../audiobus/exporters/adapter-dawproject.ts) and [importer](../audiobus/importers/import-dawproject.ts) handle the separate interchange format.
- [Vaporisateur](../audiobus-output-opendaw-vaporisateur/README.md) supplies the live synthesizer.
- [Audiotool](../audiotool/README.md) sends note takes through Nexus.

Use the root pnpm workspace. This package provides `lint` and `lint:fix`, with no standalone build, server or test script.
