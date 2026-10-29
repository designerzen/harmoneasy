// Each renderer owns a reference to a port. Multiple graph nodes share that reference
// through the preload, and multiple windows share the native handle here.
export function registerMidi2IPC(ipcMain, loadNative) {
	let native
	const ports = { input: new Map(), output: new Map() }
	const watched = new Set()
	const addon = () => (native ??= loadNative())
	function close(sender, type, index) {
		const owners = ports[type].get(index)
		if (!owners?.delete(sender)) {
			return
		}
		if (!owners.size) {
			ports[type].delete(index)
			addon()[type === "input" ? "closeUmpInput" : "closeUmpOutput"](index)
		}
	}
	for (const method of ["getUmpInputs", "getUmpOutputs", "getCapabilities"]) {
		ipcMain.handle(`midi2:${method}`, (_event, diagnostics = false) =>
			addon()[method](diagnostics === true)
		)
	}
	for (const type of ["input", "output"]) {
		const suffix = type === "input" ? "Input" : "Output"
		ipcMain.handle(`midi2:openUmp${suffix}`, ({ sender }, index) => {
			if (!Number.isInteger(index) || index < 0) {
				throw new Error("Invalid MIDI device index")
			}
			if (!watched.has(sender)) {
				watched.add(sender)
				const cleanup = () => {
					for (const direction of ["input", "output"]) {
						for (const id of ports[direction].keys()) {
							close(sender, direction, id)
						}
					}
				}
				sender.on("render-process-gone", cleanup)
				sender.on("did-start-navigation", (_event, _url, inPlace, mainFrame) => {
					if (mainFrame && !inPlace) {
						cleanup()
					}
				})
				sender.once("destroyed", () => {
					cleanup()
					watched.delete(sender)
				})
			}
			let owners = ports[type].get(index)
			if (!owners) {
				owners = new Set()
				if (type === "input") {
					addon().openUmpInput(index, (device, words, timestamp) => {
						for (const owner of ports.input.get(device) ?? []) {
							if (!owner.isDestroyed()) {
								owner.send("midi2:input", device, words, timestamp)
							}
						}
					})
				} else {
					addon().openUmpOutput(index)
				}
				ports[type].set(index, owners)
			}
			owners.add(sender)
		})
		ipcMain.handle(`midi2:closeUmp${suffix}`, ({ sender }, index) => close(sender, type, index))
	}
	ipcMain.handle("midi2:sendUmp", ({ sender }, index, words) => {
		if (!ports.output.get(index)?.has(sender)) {
			throw new Error("MIDI output is not open")
		}
		if (
			!Array.isArray(words) ||
			!words.length ||
			words.length > 4 ||
			words.some((word) => !Number.isInteger(word) || word < 0 || word > 0xffffffff)
		) {
			throw new Error("Invalid UMP words")
		}
		addon().sendUmp(index, words)
	})
}