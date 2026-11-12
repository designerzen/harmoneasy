// Mount the control-surface demo, then add the app's musical-key handler to it.
import "../../../packages/control-surface/tests/browser-entry.ts"
import { addKeyboardDownEvents } from "audiobus/hardware/keyboard/keyboard"

Object.assign((window as unknown as { surfaceSmoke: object }).surfaceSmoke, {
	addKeyboardDownEvents
})
