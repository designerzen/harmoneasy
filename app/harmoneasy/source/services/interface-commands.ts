import {
	getProtocolRegistry,
	ProtocolError,
	type Json,
	type Params
} from "audiobus/io/protocol-registry"
import {
	applyControlValue,
	available,
	currentValue,
	isValueControl,
	paletteControls,
	REMOTE_INTERFACE_COMMAND_PREFIX,
	type PaletteControl
} from "./command-palette"

const ACTION_INPUT_TYPES = new Set(["button", "submit", "reset"])
type Kind = "action" | "toggle" | "choice" | "text" | "number"

function kind(element: HTMLElement): Kind {
	if (element instanceof HTMLSelectElement) {
		return "choice"
	}
	if (element instanceof HTMLTextAreaElement) {
		return "text"
	}
	if (element instanceof HTMLInputElement) {
		if (["checkbox", "radio"].includes(element.type)) {
			return "toggle"
		}
		if (ACTION_INPUT_TYPES.has(element.type)) {
			return "action"
		}
		return ["number", "range"].includes(element.type) ? "number" : "text"
	}
	return element.getAttribute("aria-pressed") === null ? "action" : "toggle"
}

const slug = (text: string) =>
	text
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")

/** IDs derive from context and label, so they stay stable while the interface is unchanged. */
function identify(root: Document): Map<string, PaletteControl> {
	const controls = new Map<string, PaletteControl>()
	for (const control of paletteControls(root, root.getElementById("command-palette"))) {
		const base = [slug(control.context), slug(control.label)].filter(Boolean).join("/")
		let id = base
		for (let index = 2; controls.has(id); index++) {
			id = `${base}~${index}`
		}
		controls.set(id, control)
	}
	return controls
}

function describe(id: string, { element, label, context }: PaletteControl): Json {
	const type = kind(element)
	const description: Record<string, Json> = {
		id,
		label,
		context,
		kind: type,
		value: currentValue(element)
	}
	if (element instanceof HTMLSelectElement) {
		description.options = [...element.options]
			.filter((option) => !option.disabled)
			.map((option) => option.text)
	}
	if (element instanceof HTMLInputElement && type === "number") {
		for (const bound of ["min", "max", "step"] as const) {
			if (element[bound] !== "") {
				description[bound] = Number(element[bound])
			}
		}
	}
	return description
}

function find(root: Document, id: string): PaletteControl {
	const control = identify(root).get(id)
	if (!control || !available(control.element)) {
		throw new ProtocolError(
			"unavailable",
			`Unknown or unavailable control: ${id}. Call ui.list again.`
		)
	}
	return control
}

/**
 * Expose every control the command palette offers to paired applications, using the palette's
 * own discovery, labels and value handling. Controls requiring a user gesture, such as file
 * pickers or audio start, may still need local interaction.
 */
export function registerInterfaceCommands(root: Document, registry = getProtocolRegistry()) {
	const string = (description: string) => ({ type: "string" as const, description })
	const removals = [
		registry.register({
			id: `${REMOTE_INTERFACE_COMMAND_PREFIX}list`,
			title: "List interface controls",
			description:
				"List the visible buttons, toggles, choices and fields that the command palette offers",
			inputSchema: {
				type: "object",
				properties: {
					query: string("Only controls whose label or context contains this text")
				},
				additionalProperties: false
			},
			execute: ({ query }: Params) => {
				const needle = typeof query === "string" ? query.toLowerCase().trim() : ""
				return [...identify(root)]
					.filter(([, { label, context }]) =>
						`${context} ${label}`.toLowerCase().includes(needle)
					)
					.map(([id, control]) => describe(id, control))
			}
		}),
		registry.register({
			id: `${REMOTE_INTERFACE_COMMAND_PREFIX}activate`,
			title: "Press an interface control",
			description: "Press a button or switch a toggle listed by ui.list",
			inputSchema: {
				type: "object",
				properties: { id: string("Control ID from ui.list") },
				required: ["id"],
				additionalProperties: false
			},
			execute: ({ id }: Params) => {
				const control = find(root, id as string)
				if (!["action", "toggle"].includes(kind(control.element))) {
					throw new ProtocolError(
						"invalid_params",
						`${control.label} takes a value; use ui.setValue`
					)
				}
				control.element.click()
				return describe(id as string, control)
			}
		}),
		registry.register({
			id: `${REMOTE_INTERFACE_COMMAND_PREFIX}setValue`,
			title: "Set an interface value",
			description:
				"Set a choice, number or text field listed by ui.list; choices accept an option's text or value",
			inputSchema: {
				type: "object",
				properties: {
					id: string("Control ID from ui.list"),
					value: string("New value")
				},
				required: ["id", "value"],
				additionalProperties: false
			},
			execute: ({ id, value }: Params) => {
				const control = find(root, id as string)
				const element = control.element
				if (!isValueControl(element) || ["action", "toggle"].includes(kind(element))) {
					throw new ProtocolError(
						"invalid_params",
						`${control.label} has no value; use ui.activate`
					)
				}
				let next = value as string
				if (element instanceof HTMLSelectElement) {
					const option = [...element.options].find(
						(item) =>
							!item.disabled &&
							!(
								item.parentElement instanceof HTMLOptGroupElement &&
								item.parentElement.disabled
							) &&
							(item.value === next || item.text === next)
					)
					if (!option) {
						throw new ProtocolError(
							"invalid_params",
							`${control.label} has no available option ${next}`
						)
					}
					next = option.value
				} else if (kind(element) === "number") {
					const number = Number(next)
					const input = element as HTMLInputElement
					if (
						next.trim() === "" ||
						!Number.isFinite(number) ||
						(input.min !== "" && number < Number(input.min)) ||
						(input.max !== "" && number > Number(input.max))
					) {
						throw new ProtocolError(
							"invalid_params",
							`${control.label} needs a number${input.min !== "" ? ` from ${input.min}` : ""}${input.max !== "" ? ` to ${input.max}` : ""}`
						)
					}
				}
				applyControlValue(element, next)
				return describe(id as string, control)
			}
		})
	]
	return () => removals.forEach((remove) => remove())
}