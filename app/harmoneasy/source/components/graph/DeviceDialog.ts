import { EVENT_CLOSE, EVENT_KEY_DOWN } from "audiobus/event-constants"
import { createDevicePicker } from "./DevicePicker"
import { createTransformerPicker } from "./Transformers"
import type AbstractInput from "audiobus/io/inputs/abstract-input"
import type { IAudioOutput } from "audiobus/io/outputs/output-interface"
import type { Transformer } from "audiobus/io/transformers/abstract-transformer"
import type { ChainUIContext } from "./chain-ui-context"
import { element, type NativeView } from "./dom"

function createPickerDialog(
	title: string,
	className: string,
	cancelLabel: string,
	onClose: () => void,
	createPicker: (header: HTMLElement, close: () => void) => NativeView,
	titleInHeader = false
) {
	const dialog = element("dialog", `${className} nodrag nopan nowheel`)
	dialog.setAttribute("aria-label", title)
	dialog.setAttribute("closedby", "any")
	const header = element("header", titleInHeader ? "" : "device-picker-header")
	const content = element("div", "dialog-content")
	const headingParent = titleInHeader ? header : content
	headingParent.append(element("h5", titleInHeader ? "" : "device-picker-title", title))
	const picker = createPicker(header, () => dialog.close())
	content.append(picker.element)
	const form = element("form")
	form.method = "dialog"
	const cancel = element("button", "btn-close", "×")
	cancel.type = "submit"
	cancel.title = "Cancel"
	cancel.setAttribute("aria-label", cancelLabel)
	form.append(cancel)
	dialog.append(header, content, form)
	const stopPropagation = (event: Event) => event.stopPropagation()
	dialog.addEventListener(EVENT_KEY_DOWN, stopPropagation)
	let destroyed = false
	const destroy = () => {
		if (destroyed) {
			return
		}
		destroyed = true
		dialog.removeEventListener(EVENT_CLOSE, closed)
		dialog.removeEventListener(EVENT_KEY_DOWN, stopPropagation)
		picker.destroy()
		dialog.remove()
	}
	const closed = () => {
		destroy()
		onClose()
	}
	dialog.addEventListener(EVENT_CLOSE, closed)
	document.body.append(dialog)
	dialog.showModal()
	return { element: dialog, destroy }
}
export function createDeviceDialog(
	context: ChainUIContext,
	{
		direction,
		replacing,
		onClose
	}: {
		direction: "input" | "output"
		replacing?: AbstractInput | IAudioOutput
		onClose: () => void
	}
) {
	return createPickerDialog(
		`${replacing ? "Swap" : "Add New"} ${direction === "input" ? "Input" : "Output"}`,
		`add-${direction}-dialog`,
		`Cancel ${replacing ? "swapping" : "adding"} ${direction}`,
		onClose,
		(header, close) =>
			createDevicePicker(context, {
				direction,
				replacing,
				dialog: true,
				filterHeader: header,
				onAdded: close
			})
	)
}
export function createTransformerDialog(
	context: ChainUIContext,
	{ replacing, onClose }: { replacing?: Transformer<any>; onClose: () => void }
) {
	return createPickerDialog(
		replacing ? "Swap Transformer" : "Add New Transformer",
		"add-transformer-dialog",
		`Cancel ${replacing ? "swapping" : "adding"} transformer`,
		onClose,
		(_, close) => createTransformerPicker(context, { dialog: true, replacing, onAdded: close }),
		true
	)
}