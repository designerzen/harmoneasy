import { EVENT_CLICK } from 'audiobus/event-constants'

export function createOpenDAWExportDialog(root: Document, signal: AbortSignal) {
    const dialog = root.querySelector<HTMLDialogElement>('#opendaw-export-dialog')!
    const code = root.querySelector<HTMLTextAreaElement>('#opendaw-export-code')!
    const copy = root.querySelector<HTMLButtonElement>('#opendaw-copy-code')!
    const status = root.querySelector<HTMLElement>('#opendaw-export-status')!
    let version = 0

    copy.addEventListener(EVENT_CLICK, async () => {
        const current = version
        copy.disabled = true
        try {
            await navigator.clipboard.writeText(code.value)
            if (current !== version) return
            copy.textContent = 'Copied'
            status.textContent = 'Paste into OpenDAW, then run the script.'
        } catch {
            if (current !== version) return
            code.focus()
            code.select()
            status.textContent = 'Code selected. Press Ctrl+C (⌘C on Mac) to copy.'
        } finally {
            if (current === version) copy.disabled = false
        }
    }, { signal })

    return (script: string) => {
        version++
        code.value = script.trim()
        code.scrollTop = 0
        code.scrollLeft = 0
        copy.textContent = 'Copy code'
        copy.disabled = false
        status.textContent = ''
        root.querySelector<HTMLDialogElement>('#export-dialog')?.close()
        dialog.hidden = false
        if (!dialog.open) dialog.showModal()
    }
}
