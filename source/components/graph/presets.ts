import { TRANSFORMER_TYPE } from "../../libs/audiobus/io/transformer-factory";

export const PRESETS = [
	{
		name:"Chord Arpeggiator",
		description: "Quantizes input, generates chords, and arpeggiates them for flowing melodic patterns",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_ARPEGGIATOR]
	},
	{
		name:"Random Patch",
		description: "Adds randomness with quantization and note shortening for experimental textures",
		transformers: [TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_NOTE_SHORTENER]
	},
	{
		name:"Chord Repeater",
		description: "Quantizes, generates chords, and repeats notes for hypnotic rhythmic effects",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_NOTE_REPEATER]
	},
	{
		name:"Harmonic Randomiser",
		description: "Combines quantization, randomness, and harmony for chaotic yet musical results",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_CHORDIFIER]
	},
	{
		name:"Staccato Arp",
		description: "Creates short, quick arpeggiated bursts with quantized timing",
		transformers: [TRANSFORMER_TYPE.ID_QUANTISE, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_SHORTENER]
	},
	{
		name:"Complex Pattern",
		description: "Combines all transformations for intricate, layered harmonic patterns",
		transformers: [TRANSFORMER_TYPE.ID_RANDOMISER, TRANSFORMER_TYPE.ID_HARMONISER, TRANSFORMER_TYPE.ID_CHORDIFIER, TRANSFORMER_TYPE.ID_ARPEGGIATOR, TRANSFORMER_TYPE.ID_NOTE_REPEATER]
	}
]