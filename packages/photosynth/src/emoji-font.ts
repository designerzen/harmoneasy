export const EMOJI_FONT_FAMILY = "Photosynth Noto Emoji"
export const EMOJI_FONT_URL = new URL("./assets/NotoEmoji-Regular.ttf", import.meta.url)

export interface EmojiFont {
	family: string
	/** Self-contained font source for SVG images, which cannot access document fonts. */
	dataUrl: string
}

let pending: Promise<EmojiFont> | undefined

/** Share one font download between the WebGPU atlas and every component's DOM fallback. */
export function loadEmojiFont(): Promise<EmojiFont> {
	if (!pending) {
		pending = (async () => {
			const response = await fetch(EMOJI_FONT_URL)
			if (!response.ok) throw new Error(`Unable to load bundled Noto Emoji font (${response.status}).`)
			const buffer = await response.arrayBuffer()
			const face = new FontFace(EMOJI_FONT_FAMILY, buffer, { style: "normal", weight: "400" })
			await face.load()
			document.fonts.add(face)
			const bytes = new Uint8Array(buffer)
			let binary = ""
			for (let offset = 0; offset < bytes.length; offset += 8192) {
				binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
			}
			return { family: EMOJI_FONT_FAMILY, dataUrl: `data:font/ttf;base64,${btoa(binary)}` }
		})().catch(error => {
			pending = undefined
			throw error
		})
	}
	return pending
}
