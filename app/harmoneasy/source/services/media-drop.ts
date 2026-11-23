import { droppedUrl } from "audiobus/importers/dropped-media"
import {
	EVENT_DRAG_OVER,
	EVENT_DRAG_LEAVE,
	EVENT_DRAG_END,
	EVENT_DROP,
	EVENT_ABORT
} from "audiobus/events/event-constants"

/** The nearest panel that takes its own drops of the file types it lists */
const ownDropTarget = (event: DragEvent) =>
	(event.target as Element)?.closest?.<HTMLElement>("[data-file-drop]") ?? undefined

const accepts = (target: HTMLElement, file: File) =>
	target.dataset.fileDrop!.split(",").some((extension) =>
		file.name.toLowerCase().endsWith(extension.trim().toLowerCase())
	)

/**
 * Capture file drops even over graph nodes, while leaving internal drags alone
 * and files dropped on a panel that accepts them, such as a Rompler's soundfonts.
 */
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
			if ((event.target as Element)?.closest?.("[data-import-menu]")) {
				return
			}
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
			// The panel highlights itself instead
			root.body.classList.toggle("drag-over", !ownDropTarget(event))
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
			if ((event.target as Element)?.closest?.("[data-import-menu]")) {
				return
			}
			const transfer = event.dataTransfer
			if (!transfer) {
				return
			}
			const files = Array.from(transfer.files)
			const own = ownDropTarget(event)
			if (own && files.length && files.every((file) => accepts(own, file))) {
				return
			}
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