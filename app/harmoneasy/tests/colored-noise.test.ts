import { expect, it } from "vitest"
import { fillNoise, createNoiseBuffer, PerlinNoise } from "../../../packages/audiobus/synthesis"

it("generates reproducible colored noise with progressively smoother sample changes", () => {
	const colors = ["white", "pink", "brown"] as const
	const differences = colors.map((color) => {
		let seed = 42
		const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296
		const data = fillNoise(new Float32Array(48000), color, random)
		expect(data.every(Number.isFinite)).toBe(true)
		expect(data.some((sample) => sample < 0)).toBe(true)
		expect(data.some((sample) => sample > 0)).toBe(true)
		return data.reduce((sum, value, i) => sum + (i ? (value - data[i - 1]) ** 2 : 0), 0)
	})
	expect(differences[0]).toBeGreaterThan(differences[1])
	expect(differences[1]).toBeGreaterThan(differences[2])
})
it("uses the supplied audio context sample rate and validates duration", () => {
	const context = {
		sampleRate: 48000,
		createBuffer: (_channels: number, length: number, sampleRate: number) => ({
			length,
			sampleRate,
			getChannelData: () => new Float32Array(length)
		})
	} as unknown as AudioContext
	expect(createNoiseBuffer(context, "pink", 0.25)).toMatchObject({
		length: 12000,
		sampleRate: 48000
	})
	expect(() => createNoiseBuffer(context, "white", NaN)).toThrow(RangeError)
})
it("restores seeded simplex modulation with continuous, repeatable values", () => {
	PerlinNoise.seed(123)
	const values = Array.from({ length: 100 }, (_, i) => PerlinNoise.simplex1(i / 100))
	PerlinNoise.seed(123)
	expect(Array.from({ length: 100 }, (_, i) => PerlinNoise.simplex1(i / 100))).toEqual(values)
	expect(values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1)).toBe(true)
	expect(
		Math.abs(PerlinNoise.simplex2(0.2, 0.3) - PerlinNoise.simplex2(0.20001, 0.3))
	).toBeLessThan(0.001)
})