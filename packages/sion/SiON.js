import { installSiONAudio, SiONAudioHost } from "./SiONAudioHost.js"
/** Load the complete SiON engine. Supplying a context enables its playback APIs. */
export async function loadSiON(context, destination) {
	const library = await import("./sion/index.js")
	const { runtime } = await import("./sion/runtime.js")
	const audio = context ? installSiONAudio(context, runtime, destination) : undefined
	return { ...library, audio }
}

let sessionPresets

/** Independent live-note session sharing the engine tables, but never its driver or audio route. */
export async function createSiONSession(context, destination = context.destination) {
	const library = await loadSiON()
	sessionPresets ??= new library.SiONPresetVoice(library.SiONPresetVoice.INCLUDE_ALL)
	const previousDriver = library.SiONDriver.mutex
	const pluralDrivers = library.SiONDriver.allowPluralDrivers
	let driver
	try {
		library.SiONDriver.allowPluralDrivers = true
		driver = new library.SiONDriver()
	} finally {
		library.SiONDriver.allowPluralDrivers = pluralDrivers
		// The public mutex accessor is read-only; preserve the legacy player owner.
		library.SiONDriver._mutex = previousDriver
	}
	const audio = new SiONAudioHost(
		context,
		(await import("./sion/runtime.js")).runtime,
		destination
	)
	audio.bindSound(driver.sound)
	driver.autoStop = false
	driver.debugMode = true
	const presets = sessionPresets
	const voices = Object.keys(presets)
		.filter((name) => !name.startsWith("_") && presets[name] instanceof library.SiONVoice)
		.sort()
	return {
		driver,
		audio,
		presets,
		voices,
		dispose() {
			driver.stop()
			audio.dispose()
		}
	}
}