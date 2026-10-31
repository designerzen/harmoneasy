// Max for Live JS runs on the low-priority thread (deferlow before this object).
/* eslint-disable no-var */
// The legacy Max js host requires ES5 and invokes these entry points by name.
autowatch = 1
inlets = 1
outlets = 2
var song = null
var previous = []
var previousMask = -1
var scales = {
	2741: "Major",
	1453: "Minor",
	2477: "Harmonic Minor",
	2733: "Melodic Minor",
	1709: "Dorian",
	1717: "Mixolydian",
	661: "Major Pentatonic",
	1193: "Minor Pentatonic",
	1365: "Whole Tone"
}
function init() {
	song = new LiveAPI(null, "live_set")
}
function release() {
	for (var i = 0; i < previous.length; i++) {
		outlet(0, [previous[i], 0, 1])
	}
	previous = []
	previousMask = -1
}
// eslint-disable-next-line no-unused-vars
function anything() {
	var args = arrayfromargs(arguments)
	if (messagename !== "/harmoneasy/state" || args.length < 3) {
		return
	}
	var root = Number(args[0]),
		scale = Number(args[1]),
		chord = Number(args[2])
	if (
		root % 1 ||
		root < 0 ||
		root > 11 ||
		scale % 1 ||
		scale < 0 ||
		scale > 4095 ||
		chord % 1 ||
		chord < 0 ||
		chord > 4095
	) {
		return
	}
	if (!song) {
		init()
	}
	if (chord !== previousMask) {
		release()
		previousMask = chord
		for (var pitch = 0; pitch < 12; pitch++) {
			if (chord & (1 << pitch)) {
				previous.push(60 + pitch)
				outlet(0, [60 + pitch, 90, 1])
			}
		}
	}
	var relative = 0
	for (var p = 0; p < 12; p++) {
		if (scale & (1 << p)) {
			relative |= 1 << ((p - root + 12) % 12)
		}
	}
	try {
		song.set("root_note", root)
		if (scales[relative]) {
			song.set("scale_name", scales[relative])
			song.set("scale_mode", 1)
			outlet(1, "Live scale: " + scales[relative] + "; Push follows Live's scale selection")
		} else {
			song.set("scale_mode", 0)
			outlet(1, "Custom scale: chord MIDI active; Live has no matching named scale")
		}
		var bpm = Number(args[3])
		if (isFinite(bpm) && bpm >= 20 && bpm <= 303) {
			song.set("tempo", bpm)
		}
	} catch (error) {
		outlet(1, "Live API: " + error.message)
	}
}
// eslint-disable-next-line no-unused-vars
function notifydeleted() {
	release()
}