import type { OutputRegistration } from "audiobus/io/output-factory"

export const KLATTSCH_OUTPUT_ID = "klattsch"

export const klattschOutput: OutputRegistration = {
	definition: {
		id: KLATTSCH_OUTPUT_ID,
		type: "engine",
		subtype: "instrument",
		name: "Klattsch",
		description: "Retro formant speech and singing from editable phoneme sequences",
		category: "Synthesis",
		icon: "/icons/device-speech.svg",
		attribution: {
			author: "Tony Gies",
			sourceUrl: "https://github.com/tgies/klattsch",
			license: "MIT",
			licenseUrls: ["https://github.com/tgies/klattsch/blob/main/LICENSE"]
		}
	},
	requires: ["audioWorklet"],
	create: async (options) => {
		const { default: OutputKlattsch } = await import("./output-klattsch")
		const output = new OutputKlattsch(options)
		try {
			await output.connect()
			return output
		} catch (error) {
			output.destroy()
			throw error
		}
	}
}