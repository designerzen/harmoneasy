# audiotool

Harmoneasy's browser connection to Audiotool through `@audiotool/nexus`. This workspace package sends recorded note takes into Audiotool projects. Its package name is `audiotool`; see [the manifest](package.json) and [public exports](index.ts).

## Connection and export

```ts
import { AudioToolConnection, captureAudioToolTake } from "audiotool"

const connection = new AudioToolConnection(localStorage)
await connection.prepare() // Load the SDK before showing a Connect button.
// In a user's click handler, call connection.connect() for popup sign-in.
// After authentication and project selection:
const projects = await connection.listProjects()
const take = captureAudioToolTake(recordedCommands, 120, endedAtSeconds, "My take")
await connection.sendTake(projects[0].name, take, { placement: "end", setTempo: false })
```

The host supplies `recordedCommands` and `endedAtSeconds`, in seconds. `placement` is `"start"` or `"end"`; `trackId` selects an existing track. Note pairing separates chain, source, channel and pitch. The adapter converts seconds to Audiotool ticks and MIDI velocity to 0–1, and accepts tempos from 30 to 1000 BPM.

[AudioToolConnection](audio-tool-connect.ts) also exposes `createProject`, `inspectProject`, `rememberProject`, `connectWithToken`, `disconnect`, and the `isConnected` and `selectedProject` getters. `isConnected` is a property. Personal-token connection is an alternative to popup sign-in; the token stays in memory. Popup sign-in requires an HTTP(S) origin and user activation.

[createAudioToolPanel](audio-tool-io.ts) provides the host UI; its source defines the callbacks and options. [The recording adapter](adapter-audiotool-audio-events-recording.ts) defines `RecordedCommand`, `AudioToolTake` and `TakeDestination`, and exports `appendAudioToolTake` for an existing Nexus transaction.

This package exports recorded notes; it does not provide a generic audio-effect host, live MIDI router or the former `AudioToolIntegration` class. The old `@harmoneasy/audiotool` imports and API-key environment examples do not match this implementation.

## Development and related packages

Use the root pnpm workspace installation. The manifest has `lint` and `lint:fix`; there is no package build or standalone server. See [audiobus](../audiobus/README.md) for recording and [openDAW](../openDAW/README.md) for the separate script exporter.
