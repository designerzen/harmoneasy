import catalogue from "../../../../packages/audiobus/io/transformer-presets.json"
import type { PresetLibrary } from "audiobus/io/preset-library"

// Data-only entry point: static page generation must not construct audio devices.
export const DEFAULT_PRESET_LIBRARY = catalogue as PresetLibrary

export const GENRE_BPM: Record<string, number> = {
	"acid-house": 126,
	techno: 134,
	dub: 74,
	disco: 116,
	"drum-and-bass": 172,
	funk: 100,
	soul: 90,
	breakbeat: 130,
	electro: 125,
	"uk-garage": 132,
	dubstep: 140,
	trap: 140,
	footwork: 160,
	samba: 110,
	"bossa-nova": 80,
	salsa: 100,
	cumbia: 95,
	jazz: 120,
	"synth-punk": 170,
	afrobeat: 105,
	ambient: 64
}