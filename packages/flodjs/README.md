# flodjs

An incomplete TypeScript port of Christian Corti's FlodJS tracker playback code. The workspace package is `flodjs`, as declared in [package.json](package.json). It is a tracker-file toolkit, not a live-coding or pattern-composition language.

## Current exports and limits

[index.ts](index.ts) exports `FlodJS`, `FileLoader`, `createFileLoader`, byte-stream helpers, core player/mixer factories, Soundblaster helpers and related types. `Pattern`, `Synth`, `LiveCoder`, `DrumMachine` and `FlodJSIntegration` are not exported.

The high-level `FlodJS` constructor does not initialise its internal `fileLoader`; `load()` catches the resulting failure and returns 0. Do not treat it as a working complete player. [FileLoader](FileLoader.ts) recognises selected FastTracker/Amiga signatures, but playback depends on legacy players on `window.neoart`; ZIP handling also needs the legacy unzip implementation. A name in the format table does not prove a decoder is present.

Lower-level byte access is independent:

```ts
import { createByteStream } from "flodjs"
const bytes = createByteStream(new Uint8Array([0x4d, 0x2e, 0x4b, 0x2e]).buffer)
const signature = bytes.readString(4)
```

See [types](types.ts), [ByteStream](ByteStream.ts), [CorePlayer](CorePlayer.ts), [CoreMixer](CoreMixer.ts) and [Soundblaster](Soundblaster.ts). Harmoneasy's separate [tracker importer](../audiobus/importers/import-tracker-file.ts) is the starting point for app file conversion.

## Development and provenance

Use the root pnpm workspace. The package defines `lint` and `lint:fix`; it has no build or test script. The source header in [index.ts](index.ts) identifies FlodJS 2.1 and Creative Commons Attribution-Noncommercial-Share Alike 3.0 Unported; the former README's MIT claim was incorrect.
