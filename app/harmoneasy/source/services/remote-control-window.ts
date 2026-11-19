import { EVENT_CLICK } from "audiobus/events/event-constants"

/** The remote control demo, told to drive the window that opened it instead of embedding one. */
export const REMOTE_CONTROL_URL = `${import.meta.env.BASE_URL}protocol-remote.html?target=opener`
const WINDOW_NAME = "harmoneasy-remote-control"

/**
 * Opens the audioBus Protocol remote control beside this window. It must keep `window.opener`
 * (so no `noopener`): the demo talks to this window through it, as any other application would.
 */
export function createRemoteControlButton(root: Document) {
	root.getElementById("btn-remote-control")?.addEventListener(EVENT_CLICK, () => {
		const remote = window.open(REMOTE_CONTROL_URL, WINDOW_NAME, "popup,width=1100,height=900")
		remote?.focus()
	})
}