# photosynth

Camera-based facial-expression analysis, musical mapping and the accessible `<photosynth-controller>` element. This is separate from the older Photosynth synthesizers inside audiobus. It emits musical messages: route them to an audio or MIDI destination to hear sound.

## Build and embed

```sh
pnpm --filter photosynth build
```

```ts
import "photosynth/element"
import { PHOTOSYNTH_MUSIC } from "photosynth"

const element = document.createElement("photosynth-controller")
element.addEventListener(PHOTOSYNTH_MUSIC, event => {
  const message = (event as CustomEvent).detail
  // Route message to your synthesizer or MIDI adapter.
  console.log(message)
})
document.body.append(element)
```

The element registers on import and starts camera capture only when the user presses Start. The root entry exports helpers, controller classes, constants and types; it does not register the element. Package imports resolve to `dist/`: build before consuming them.

## Controller, events and options

[PhotosynthController](src/controller.ts) exposes `start(video, deviceId?)`, `stop()` and `state`. Options: `wasmPath`, `modelAssetPath`, `delegate` (`GPU` or `CPU`), `mirrored`, positive `framesPerSecond`, and a `createDetector` override. GPU detector setup can fall back to CPU. Capture needs HTTPS or localhost, camera permission and `getUserMedia`. Model/runtime assets download on first use unless hosted separately.

[Event constants](src/events.ts) identify frame, state, error, music, emoji and overlay-error events. [Types](src/types.ts) define the details: frames have a timestamp and optional face prediction; musical messages use `noteon`, `noteoff`, `controlchange` or `pitchbend`, MIDI ranges and channels 1–16. [music.ts](src/music.ts) defines mapping, smoothing, thresholds and note ranges. [element.ts](src/element.ts) integrates capture, mapping, expression display and an optional WebGPU overlay.

Inference runs on the device; expression labels describe facial actions. See [LICENSE](LICENSE) and the separately licensed [emoji font](src/assets/OFL.txt).

## Development

The manifest defines `dev`, `build`, `type-check` and `test`. The [example](example/index.html) imports source for development. `pnpm --filter photosynth test` runs unit tests; camera permissions and actual device behavior need a browser check.
