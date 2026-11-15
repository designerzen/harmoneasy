import path from "node:path"
import {
	createMidiDeviceStore,
	MIDI_DEVICE_DIRECTORY
} from "audiobus/hardware/midi-devices/device-files.js"
import {
	refreshMidiDeviceProfiles,
	setMidiDeviceProfileSource
} from "../../../packages/audiobus/hardware/midi-devices/device-profiles"

export const bundledMidiDevices = MIDI_DEVICE_DIRECTORY
export function useTestMidiProfileFiles(roots = [bundledMidiDevices]) {
	const store = createMidiDeviceStore(() => roots)
	setMidiDeviceProfileSource("http://midi.test/midi-devices/", async (input) => {
		const relative = new URL(String(input)).pathname.replace(/^\/midi-devices\//, "")
		if (!relative) {
			return new Response(JSON.stringify(await store.list()), {
				headers: { "Content-Type": "application/json" }
			})
		}
		const file = await store.read(relative.split(path.sep).join("/"))
		return file
			? new Response(file.bytes.toString("utf8"), { headers: { "Content-Type": file.type } })
			: new Response(null, { status: 404 })
	})
}
useTestMidiProfileFiles()
await refreshMidiDeviceProfiles(true)