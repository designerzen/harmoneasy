import { clamp } from "./model"

/** Pointer Events uses 0.5 for contact without pressure hardware. Once a touch
 * reports a different pressure, retain its analogue readings for that contact. */
export function contactPressure(
	pressure: number,
	pointerType: string,
	known = false
): number | undefined {
	if (!Number.isFinite(pressure) || pointerType === "mouse") {
		return undefined
	}
	if (
		pointerType === "pen" ||
		(pointerType === "touch" && (known || (pressure > 0 && pressure !== 0.5)))
	) {
		return clamp(pressure)
	}
	return undefined
}