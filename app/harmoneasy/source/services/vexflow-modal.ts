import { EVENT_CLICK, EVENT_CLOSE } from "audiobus/events/event-constants"

/** Render a VexFlow score into the shared info dialog with an HTML download action. */
export async function renderVexFlowModal(
	root: Document,
	showInfoDialog: (title: string, message: string) => void,
	renderer: (container: HTMLElement, recorder: any, timer: any) => void,
	recorder: any,
	timer: any,
	htmlCreator: (recorder: any, timer: any) => Promise<Blob>,
	htmlSaver: (blob: Blob, filename: string) => void
): Promise<void> {
	const modalContainer = root.createElement("div")
	modalContainer.style.cssText = "width: 100%; height: 100%; overflow-y: auto; padding: 20px;"

	try {
		renderer(modalContainer, recorder, timer)

		const downloadBtn = root.createElement("button")
		downloadBtn.type = "button"
		downloadBtn.textContent = "Download as HTML"
		downloadBtn.className = "primary"
		downloadBtn.addEventListener(EVENT_CLICK, async () => {
			const blob = await htmlCreator(recorder, timer)
			htmlSaver(blob, recorder.name)
		})

		modalContainer.appendChild(downloadBtn)

		// Show in info dialog — pass the DOM node directly to preserve event listeners,
		// and disable status live-region / select-all semantics while hosting interactive notation.
		const infoMessage = root.querySelector("#info-message")
		if (infoMessage) {
			infoMessage.removeAttribute("role")
			infoMessage.removeAttribute("aria-live")
			infoMessage.classList.remove("selectable")
			infoMessage.innerHTML = ""
			infoMessage.appendChild(modalContainer)
			const title = root.querySelector("#info-dialog-title, #info-dialog h2, #info-dialog h5")
			if (title) {
				title.textContent = "Musical Score"
			}
			const dialog = root.querySelector<HTMLDialogElement>("#info-dialog")
			if (dialog) {
				const previousFocus =
					root.activeElement instanceof HTMLElement && root.activeElement !== root.body
						? root.activeElement
						: null
				dialog.hidden = false
				if (!dialog.open) {
					dialog.showModal()
				}
				dialog.addEventListener(
					EVENT_CLOSE,
					() => {
						if (previousFocus?.isConnected) {
							previousFocus.focus()
						}
					},
					{ once: true }
				)
			}
		} else {
			showInfoDialog("Musical Score", modalContainer.innerHTML)
		}
		console.info("Exporting Data to VexFlow", { recorder })
	} catch (error) {
		console.error("Error rendering VexFlow score", error)
		showInfoDialog("Error", "Failed to render VexFlow score. Check console for details.")
	}
}
