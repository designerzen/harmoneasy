import type { ControlChoice, ControlDescriptor } from "./types"

/** Strokes on a 24-unit grid as flat x,y pairs. One vocabulary feeds both SVG and GPU faces. */
export const CONTROL_ICONS: Record<string, number[][]> = {
	volume: [
		[3, 9, 7, 9, 12, 5, 12, 19, 7, 15, 3, 15, 3, 9],
		[16, 9, 17.5, 12, 16, 15],
		[19, 6, 21.5, 12, 19, 18]
	],
	pan: [
		[3, 12, 21, 12],
		[6, 9, 3, 12, 6, 15],
		[18, 9, 21, 12, 18, 15],
		[12, 5, 12, 19]
	],
	filter: [[2, 8, 11, 8, 15, 10, 18, 16, 22, 20]],
	resonance: [[2, 14, 10, 14, 13, 4, 15, 14, 17, 18, 22, 18]],
	envelope: [[2, 20, 6, 4, 10, 11, 16, 11, 22, 20]],
	tempo: [
		[7, 21, 10, 3, 14, 3, 17, 21, 7, 21],
		[12, 17, 16, 7]
	],
	play: [[7, 4, 19, 12, 7, 20, 7, 4]],
	stop: [[6, 6, 18, 6, 18, 18, 6, 18, 6, 6]],
	pause: [
		[8, 5, 8, 19],
		[16, 5, 16, 19]
	],
	record: [[12, 5, 17, 7, 19, 12, 17, 17, 12, 19, 7, 17, 5, 12, 7, 7, 12, 5]],
	mute: [
		[3, 9, 7, 9, 12, 5, 12, 19, 7, 15, 3, 15, 3, 9],
		[16, 9, 22, 15],
		[22, 9, 16, 15]
	],
	wave: [[2, 12, 4.5, 6, 7, 6, 9.5, 12, 12, 18, 14.5, 18, 17, 12, 19.5, 6, 22, 6]],
	octave: [
		[5, 10, 12, 3, 19, 10],
		[12, 3, 12, 21],
		[5, 21, 19, 21]
	],
	transpose: [
		[7, 20, 7, 4],
		[3, 8, 7, 4, 11, 8],
		[17, 4, 17, 20],
		[13, 16, 17, 20, 21, 16]
	],
	reverb: [
		[3, 12, 6, 12],
		[9, 7, 11, 12, 9, 17],
		[14, 4, 17, 12, 14, 20],
		[19, 2, 23, 12, 19, 22]
	],
	delay: [
		[3, 12, 3, 18],
		[9, 14, 9, 18],
		[15, 15.5, 15, 18],
		[21, 16.5, 21, 18],
		[2, 18, 22, 18]
	],
	drive: [[2, 12, 5, 5, 8, 5, 9, 12, 12, 19, 15, 19, 16, 12, 19, 5, 22, 5]],
	mix: [
		[6, 3, 6, 21],
		[12, 3, 12, 21],
		[18, 3, 18, 21],
		[3, 15, 9, 15],
		[9, 8, 15, 8],
		[15, 13, 21, 13]
	],
	keys: [
		[3, 5, 21, 5, 21, 19, 3, 19, 3, 5],
		[9, 5, 9, 19],
		[15, 5, 15, 19],
		[7, 5, 7, 13, 11, 13, 11, 5],
		[13, 5, 13, 13, 17, 13, 17, 5]
	],
	strum: [
		[3, 5, 21, 5],
		[3, 10, 21, 10],
		[3, 15, 21, 15],
		[3, 20, 21, 20],
		[16, 2, 8, 22]
	],
	grid: [
		[3, 4, 21, 4, 21, 20, 3, 20, 3, 4],
		[3, 12, 21, 12],
		[9, 4, 9, 20],
		[15, 4, 15, 20]
	],
	pad: [
		[4, 4, 20, 4, 20, 20, 4, 20, 4, 4],
		[9, 9, 15, 9, 15, 15, 9, 15, 9, 9]
	],
	xy: [
		[4, 4, 20, 4, 20, 20, 4, 20, 4, 4],
		[12, 7, 12, 17],
		[7, 12, 17, 12]
	],
	scale: [[3, 20, 7, 20, 7, 16, 11, 16, 11, 12, 15, 12, 15, 8, 19, 8, 19, 4, 22, 4]],
	chord: [
		[5, 7, 9, 7],
		[10, 12, 14, 12],
		[15, 17, 19, 17],
		[3, 21, 21, 21]
	],
	random: [
		[4, 4, 20, 4, 20, 20, 4, 20, 4, 4],
		[8, 8, 8.5, 8],
		[12, 12, 12.5, 12],
		[16, 16, 16.5, 16]
	],
	power: [
		[12, 3, 12, 11],
		[7, 6, 4, 10, 4, 15, 7, 19, 12, 21, 17, 19, 20, 15, 20, 10, 17, 6]
	],
	preset: [[5, 3, 19, 3, 19, 21, 12, 16, 5, 21, 5, 3]],
	visualiser: [
		[3, 20, 3, 4],
		[3, 20, 21, 20],
		[6, 15, 10, 9, 14, 13, 20, 4]
	],
	metronome: [
		[6, 21, 10, 3, 14, 3, 18, 21, 6, 21],
		[12, 15, 7, 6]
	],
	up: [
		[12, 20, 12, 4],
		[6, 10, 12, 4, 18, 10]
	],
	down: [
		[12, 4, 12, 20],
		[6, 14, 12, 20, 18, 14]
	],
	off: [
		[12, 4, 18, 7, 20, 12, 18, 17, 12, 20, 6, 17, 4, 12, 6, 7, 12, 4],
		[6, 18, 18, 6]
	],
	control: [
		[4, 7, 20, 7],
		[4, 17, 20, 17],
		[9, 4, 9, 10],
		[15, 14, 15, 20]
	]
}

const RULES: [RegExp, string][] = [
	[/\b(mute|silence)\b/, "mute"],
	[/\b(volume|gain|level|loudness|amp(litude)?|velocity)\b/, "volume"],
	[/\b(pan|balance|stereo)\b/, "pan"],
	[/\b(resonance|q|emphasis)\b/, "resonance"],
	[/\b(cutoff|filter|lpf|hpf|frequency|tone|brightness)\b/, "filter"],
	[/\b(attack|decay|sustain|release|envelope|adsr)\b/, "envelope"],
	[/\b(metronome|click)\b/, "metronome"],
	[/\b(tempo|bpm|speed|rate)\b/, "tempo"],
	[/\b(play|start|trigger)\b/, "play"],
	[/\b(stop|panic|reset)\b/, "stop"],
	[/\b(pause|hold)\b/, "pause"],
	[/\b(record|rec|capture)\b/, "record"],
	[/\b(wave(form)?|shape|oscillator|osc)\b/, "wave"],
	[/\b(octave)\b/, "octave"],
	[/\b(transpose|pitch|semitone|detune|tune)\b/, "transpose"],
	[/\b(reverb|room|space)\b/, "reverb"],
	[/\b(delay|echo|feedback)\b/, "delay"],
	[/\b(drive|distortion|saturation|crush|fuzz)\b/, "drive"],
	[/\b(mix|wet|dry|blend)\b/, "mix"],
	[/\b(scale|mode)\b/, "scale"],
	[/\b(chord|harmony|voicing|progression)\b/, "chord"],
	[/\b(random|chance|probability|humani[sz]e|shuffle)\b/, "random"],
	[/\b(enable[ds]?|bypass|power|active|on)\b/, "power"],
	[/\b(preset|patch|program|instrument|sound)\b/, "preset"]
]
const WIDGET_ICONS: Partial<Record<ControlDescriptor["widget"], string>> = {
	"piano-roll": "grid",
	"guitar-tab": "grid",
	"relative-keys": "keys",
	strum: "strum",
	pad: "pad",
	xy: "xy",
	visualiser: "visualiser"
}

/** Lower-case words from the id, label and group, with camelCase and snake_case split. */
export function controlWords(d: ControlDescriptor): string {
	return `${d.id} ${d.label} ${d.group ?? ""}`
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.toLowerCase()
}

/** Author icons win; otherwise words in the id, label and group choose a meaningful glyph. */
export function controlIcon(d: ControlDescriptor): string | undefined {
	if (d.icon && CONTROL_ICONS[d.icon]) {
		return d.icon
	}
	const words = controlWords(d)
	return RULES.find(([pattern]) => pattern.test(words))?.[1] ?? WIDGET_ICONS[d.widget]
}

/** Only unambiguous one-word choices receive icons; others keep a clear text label. */
export function choiceIcon(choice: ControlChoice): string | undefined {
	const word = choice.label.trim().toLowerCase()
	return (
		{
			play: "play",
			start: "play",
			stop: "stop",
			pause: "pause",
			record: "record",
			random: "random",
			up: "up",
			down: "down",
			off: "off",
			none: "off"
		} as Record<string, string>
	)[word]
}

export function iconPath(name: string): string {
	return (CONTROL_ICONS[name] ?? CONTROL_ICONS.control)
		.map((stroke) =>
			stroke
				.reduce<string[]>(
					(parts, value, index) =>
						index % 2 ? parts : [...parts, `${value} ${stroke[index + 1]}`],
					[]
				)
				.map((point, index) => `${index ? "L" : "M"}${point}`)
				.join("")
		)
		.join("")
}