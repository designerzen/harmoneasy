import { deviceId } from "audiobus/io/device-definition"
import { installComponentUi } from "audiobus/io/component-ui"

// A device's createGui commonly returns one cached DOM element. Keep it mounted
// in one view at a time; moving/deleting a chain must not destroy another view.
const views = new WeakMap<
	object,
	{ hosts: Map<HTMLElement, boolean>; gui?: HTMLElement; loading?: Promise<void> }
>()

/**
 * Show a device's createGui element in host, sharing it with the device's other views.
 * A preferred host (an expanded node, a control surface) takes the GUI from the others.
 */
export function mountDeviceGui(device: any, host: HTMLElement, preferred = false): () => void {
	installComponentUi(device)
	host.dataset.midiScope = `device:${deviceId(device)}`
	host.dataset.midiLabel = device.name
	if (!device.createGui) {
		return () => {}
	}
	let view = views.get(device)
	if (!view) {
		views.set(device, (view = { hosts: new Map() }))
	}
	const shared = view
	shared.hosts.set(host, preferred)
	const place = () => {
		const first =
			[...shared.hosts].find(([, isPreferred]) => isPreferred)?.[0] ??
			shared.hosts.keys().next().value
		if (first && shared.gui && shared.gui.parentElement !== first) {
			first.replaceChildren(shared.gui)
		}
		for (const item of shared.hosts.keys()) {
			if (item !== first) {
				item.textContent = "Controls are shown in another view of this device."
			} else if (!shared.gui) {
				item.textContent = ""
			}
		}
	}
	const release = () => {
		if (shared.hosts.size || shared.loading) {
			return
		}
		shared.gui?.remove()
		shared.gui = undefined
		views.delete(device)
		void Promise.resolve()
			.then(() => device.destroyGui?.())
			.catch((error) => {
				console.warn("Device controls cleanup failed", error)
			})
	}
	if (!shared.gui && !shared.loading) {
		shared.loading = Promise.resolve()
			.then(() => device.createGui())
			.then((gui) => {
				shared.gui = gui
				place()
			})
			.catch((error) => {
				host.textContent = `Controls unavailable: ${String(error)}`
			})
			.finally(() => {
				shared.loading = undefined
				release()
			})
	}
	place()
	return () => {
		shared.hosts.delete(host)
		host.replaceChildren()
		place()
		queueMicrotask(release)
	}
}
