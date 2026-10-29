import { vi } from "vitest"

// Finish dynamic factory imports and asynchronous native event handlers between UI actions.
export function runUI<T>(action: () => T): T {
	const result = action()
	if (result instanceof Promise) {
		return result.then(async (value) => {
			await vi.dynamicImportSettled()
			return value
		}) as T
	}
	return result
}