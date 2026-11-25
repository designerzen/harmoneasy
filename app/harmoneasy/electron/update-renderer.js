const title = document.getElementById("title")
const message = document.getElementById("message")
const detail = document.getElementById("detail")
const progress = document.getElementById("progress")
const primary = document.getElementById("primary")
const later = document.getElementById("later")
let phase

primary.addEventListener(window.updates.EVENT_CLICK, () => {
	if (phase === "downloaded") {
		window.updates.install()
	} else {
		window.updates.download()
	}
})
later.addEventListener(window.updates.EVENT_CLICK, () => window.updates.later())

window.updates.onState((state) => {
	phase = state.phase
	const busy = phase === "downloading" || phase === "installing"
	document.body.dataset.busy = String(busy)
	primary.disabled = busy
	later.hidden = busy
	progress.hidden = phase !== "downloading"
	progress.value = state.percent ?? 0
	detail.textContent = ""
	if (phase === "available") {
		title.textContent = "An update is available"
		message.textContent = `Harmoneasy ${state.version} is available. You are using ${state.currentVersion}. Download the update now?`
		detail.textContent = "You can finish your work before restarting to install."
		primary.textContent = "Update now"
	} else if (phase === "downloading") {
		title.textContent = "Downloading update"
		message.textContent =
			"Please keep Harmoneasy open while the update downloads and is verified."
		const mb = (bytes) => ((bytes || 0) / 1024 / 1024).toFixed(1)
		detail.textContent = `${Math.floor(state.percent ?? 0)}% · ${mb(state.transferred)} / ${mb(state.total)} MB · ${mb(state.bytesPerSecond)} MB/s`
		primary.textContent = "Downloading…"
	} else if (phase === "downloaded") {
		title.textContent = "Ready to install"
		message.textContent =
			"Save your work before restarting. Harmoneasy will close, install the update, and reopen."
		primary.textContent = "Restart and install"
		later.textContent = "Later"
	} else if (phase === "installing") {
		title.textContent = "Starting installer"
		message.textContent =
			"Handing over to the installer. Follow any system prompts to complete the update."
		primary.textContent = "Installing…"
	} else if (phase === "error") {
		title.textContent = "Update could not finish"
		message.textContent =
			"Check your internet connection and try again. You can continue using your current version."
		primary.textContent = "Retry download"
		later.textContent = "Close"
	}
})