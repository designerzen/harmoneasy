declare module "klattsch" {
	export interface CompileOptions {
		baseF0?: number
		rate?: number
		scale?: number
		vibratoDepth?: number
		vibratoRate?: number
		tremoloDepth?: number
		tremoloRate?: number
		aspiration?: number
		tilt?: number
		effort?: number
		bank?: string
	}
	export function compileString(
		input: string,
		options?: CompileOptions
	): {
		voices: { schedule: unknown[]; totalMs: number }[]
		warnings: unknown[]
		totalMs: number
	}
	export const banks: {
		list(): string[]
		get(name: string): { displayName: string; phonemes: Record<string, unknown> } | undefined
	}
}