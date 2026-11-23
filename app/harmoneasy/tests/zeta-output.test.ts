// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"
import {
	zetaTerm,
	zetaSequence,
	zetaSpectrum,
	ZETA_VARIATIONS
} from "../../../packages/audiobus/instruments/zeta/zeta-wave"
import { ZETA_ZEROS } from "../../../packages/audiobus/instruments/zeta/zeros"
import OutputZeta from "../../../packages/audiobus/io/outputs/output-zeta"
import { createOutputById } from "../../../packages/audiobus/io/output-factory"
import { deviceDefinition } from "../../../packages/audiobus/io/device-definition"

const settings = { variation: 0, n: 12, firstZero: 1, zeroCount: 32 }

describe("Zeta mathematics", () => {
	it("ships consecutive measured zeros, including the paper's full 30,000-zero range", () => {
		expect(ZETA_ZEROS).toHaveLength(30000)
		expect(ZETA_ZEROS.slice(0, 3)).toEqual([14.134725142, 21.022039639, 25.01085758])
		expect(ZETA_ZEROS.every((v, j) => !j || v > ZETA_ZEROS[j - 1])).toBe(true)
	})
	it("matches an independent convergent Ei power series, including the imaginary branch", () => {
		const x = Math.log(2) / 2,
			y = ZETA_ZEROS[0] * Math.log(2)
		let r = x,
			i = y
		let real = 0.5772156649015329 + Math.log(Math.hypot(x, y))
		let imag = Math.atan2(y, x) - Math.PI
		for (let k = 1; k < 100; k++) {
			real += r / k
			imag += i / k
			const nextR = (r * x - i * y) / (k + 1)
			i = (r * y + i * x) / (k + 1)
			r = nextR
		}
		const actual = zetaTerm(2, ZETA_ZEROS[0])
		expect(actual[0]).toBeCloseTo(real, 8)
		expect(actual[1]).toBeCloseTo(imag, 8)
	})
	it("matches independent fine quadrature in the asymptotic region", () => {
		const n = 12,
			gamma = ZETA_ZEROS[10],
			x = Math.log(n) / 2,
			y = gamma * Math.log(n)
		let r = 0,
			i = 0
		const h = 40 / 16384
		for (let j = 0; j <= 16384; j++) {
			const s = j * h,
				d = (s - x) ** 2 + y * y
			const w = Math.exp(-s) * (j === 0 || j === 16384 ? 1 : j % 2 ? 4 : 2)
			r += (w * (s - x)) / d
			i += (w * y) / d
		}
		const scale = (-Math.sqrt(n) * h) / 3
		const term = zetaTerm(n, gamma)
		expect(term[0]).toBeCloseTo(scale * (Math.cos(y) * r - Math.sin(y) * i), 12)
		expect(term[1]).toBeCloseTo(scale * (Math.sin(y) * r + Math.cos(y) * i), 12)
	})
	it.each([0, 1])("sums component %s before selecting a later range", (variation) => {
		const terms = zetaSequence({ ...settings, variation })
		const sum = zetaSequence({ ...settings, variation: variation + 2 })
		let total = 0
		for (let j = 0; j < terms.length; j++) {
			total += terms[j]
			expect(sum[j]).toBeCloseTo(total, 12)
		}
		const later = zetaSequence({
			...settings,
			firstZero: 10,
			zeroCount: 5,
			variation: variation + 2
		})
		expect([...later]).toEqual([...sum.slice(9, 14)])
	})
	it("implements figure 2 and clips the range at the last bundled zero", () => {
		const approximation = zetaSequence({ ...settings, variation: 4 })
		const phase = (6 * Math.PI) ** (5 / 8)
		expect(approximation[0]).toBeCloseTo(Math.sin(phase) / (3 * phase), 14)
		expect(zetaSequence({ ...settings, firstZero: 29999 })).toHaveLength(2)
		expect(() => zetaTerm(1, 14)).toThrow(RangeError)
	})
	it("converts sine samples into Web Audio's Fourier convention and removes DC", () => {
		const points = Float64Array.from(
			{ length: 64 },
			(_, j) => 3 + Math.sin((2 * Math.PI * j) / 64)
		)
		const spectrum = zetaSpectrum(points)
		expect(spectrum.real[0]).toBe(0)
		expect(spectrum.imag[1]).toBeCloseTo(1, 6)
		expect(spectrum.real[1]).toBeCloseTo(0, 6)
	})
	it.each([0, 1, 2, 3, 4])(
		"produces finite audible coefficients for variation %s",
		(variation) => {
			const spectrum = zetaSpectrum(
				zetaSequence({ ...settings, variation, n: 1295, zeroCount: 30000 })
			)
			expect([...spectrum.real, ...spectrum.imag].every(Number.isFinite)).toBe(true)
			expect([...spectrum.real, ...spectrum.imag].some((v) => Math.abs(v) > 1e-8)).toBe(true)
		}
	)
})

it("registers Zeta, saves its settings and synchronizes the non-React controls", async () => {
	const context = {
		currentTime: 0,
		destination: {},
		createGain: () => ({
			connect: vi.fn(),
			disconnect: vi.fn(),
			gain: { setTargetAtTime: vi.fn() }
		})
	} as unknown as AudioContext
	vi.stubGlobal("AudioContext", class {})
	const output = (await createOutputById("zeta", {
		audioContext: context,
		variation: 3,
		n: 1302
	})) as OutputZeta
	try {
		const gui = await output.createGui()
		const select = gui.querySelector<HTMLSelectElement>("select[name=variation]")!
		expect([...select.options].map((o) => o.textContent)).toEqual([...ZETA_VARIATIONS])
		expect(select.value).toBe("3")
		select.value = "1"
		select.dispatchEvent(new Event("change"))
		expect(output.options).toMatchObject({ variation: 1, n: 1302 })
		const saved = JSON.parse(JSON.stringify(deviceDefinition(output)))
		expect(saved).toMatchObject({
			factory: "output",
			type: "zeta",
			options: { variation: 1, n: 1302 }
		})
		output.configure({ variation: 4, n: Infinity, zeroCount: 1, firstZero: 90000 })
		expect(select.value).toBe("4")
		expect(output.options).toMatchObject({ n: 1302, zeroCount: 2, firstZero: 29999 })
		expect(await output.createGui()).toBe(gui)
		await output.destroyGui()
		expect(await output.createGui()).not.toBe(gui)
	} finally {
		output.destroy()
		vi.unstubAllGlobals()
	}
})