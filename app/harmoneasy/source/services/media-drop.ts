import { droppedUrl } from "audiobus/importers/dropped-media"
import {
	EVENT_DRAG_OVER,
	EVENT_DRAG_LEAVE,
	EVENT_DRAG_END,
	EVENT_DROP,
	EVENT_ABORT
} from "audiobus/event-constants"

/** Capture file drops even over graph nodes, while leaving internal drags alone. */
export function installMediaDrop(
	root: Document,
	receive: (media: File | string) => void,
	signal: AbortSignal
): void {
	const hasMedia = (event: DragEvent) =>
		Array.from(event.dataTransfer?.types ?? []).some(
			(type) => type === "Files" || type === "text/uri-list"
		)
	const clear = () => root.body.classList.remove("drag-over")
	root.addEventListener(
		EVENT_DRAG_OVER,
		(event) => {
			const media = hasMedia(event)
			if (!media && !Array.from(event.dataTransfer?.types ?? []).includes("text/plain")) {
				return
			}
			event.preventDefault()
			if (!media) {
				return
			} // Plain text may be a URL, but internal graph drags should not highlight the page.
			if (event.dataTransfer) {
				event.dataTransfer.dropEffect = "copy"
			}
			root.body.classList.add("drag-over")
		},
		{ capture: true, signal }
	)
	root.addEventListener(
		EVENT_DRAG_LEAVE,
		(event) => {
			if (!event.relatedTarget || !root.body.contains(event.relatedTarget as Node)) {
				clear()
			}
		},
		{ signal }
	)
	root.addEventListener(EVENT_DRAG_END, clear, { signal })
	root.addEventListener(
		EVENT_DROP,
		(event) => {
			clear()
			const transfer = event.dataTransfer
			if (!transfer) {
				return
			}
			const files = Array.from(transfer.files)
			const url = files.length
				? undefined
				: droppedUrl(transfer.getData("text/uri-list"), transfer.getData("text/plain"))
			if (!files.length && !url) {
				return
			}
			event.preventDefault()
			event.stopPropagation()
			if (files.length) {
				files.forEach((file) => receive(file))
			} else {
				receive(url!)
			}
		},
		{ capture: true, signal }
	)
	signal.addEventListener(EVENT_ABORT, clear, { once: true })
}