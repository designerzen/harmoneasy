import { createWebRTCSyncController } from 'netronome'
import QRCode from 'qrcode'
import LZString from 'lz-string'
import type { ClockSource } from './clock-source'

export function readSyncBundle(value: string) {
    const text = value.trim()
    const payload = /^https?:\/\//i.test(text)
        ? new URLSearchParams(new URL(text).hash.slice(1)).get('sync-bundle')
        : text
    if (!payload || payload.length > 16000) throw new Error('Paste a Netronome connection link.')
    const decoded = LZString.decompressFromEncodedURIComponent(payload)
    const bundle = decoded && JSON.parse(decoded)
    if (!bundle?.description || !['offer', 'answer'].includes(bundle.description.type)
        || typeof bundle.description.sdp !== 'string' || bundle.description.sdp.length > 32000) {
        throw new Error('This is not a valid Netronome connection link.')
    }
    return bundle
}

export function createSyncUrl(bundle: unknown, location: string) {
    const url = new URL(location)
    url.search = ''
    url.hash = `sync-bundle=${LZString.compressToEncodedURIComponent(JSON.stringify(bundle))}`
    return url.href
}

export function createNetronomeLink(timer: any, isPlaying: () => boolean, options: {
    source?: ClockSource; autoStart?: boolean; onSharedRequested?: () => Promise<void>
} = {}) {
    const button = document.getElementById('netronome-link') as HTMLButtonElement
    const preview = document.getElementById('netronome-qr-preview') as HTMLImageElement
    const dialog = document.getElementById('netronome-dialog') as HTMLDialogElement
    const qr = document.getElementById('netronome-qr') as HTMLImageElement
    const local = document.getElementById('netronome-local-link') as HTMLTextAreaElement
    const remote = document.getElementById('netronome-remote-link') as HTMLTextAreaElement
    const status = document.getElementById('netronome-status')!
    const instructions = document.getElementById('netronome-instructions')!
    const apply = document.getElementById('netronome-apply') as HTMLButtonElement
    const regenerate = document.getElementById('netronome-regenerate') as HTMLButtonElement
    let controller: ReturnType<typeof createWebRTCSyncController> | undefined
    let linked = false
    let busy = false
    let follower = false
    let source: ClockSource = options.source ?? 'internal'
    let queue: Promise<void> = Promise.resolve()
    let pending = 0

    const hideQR = () => { qr.hidden = preview.hidden = true }
    const updateSourceUI = () => {
        if (source !== 'internal') hideQR()
        button.hidden = source === 'midi' || source === 'manual'
        regenerate.disabled = busy || source !== 'internal'
    }

    const showError = (error: unknown) => {
        status.textContent = error instanceof Error ? error.message : String(error)
    }
    const render = async (bundle: unknown, current = controller) => {
        const url = createSyncUrl(bundle, window.location.href)
        local.value = url
        if (source !== 'internal') { hideQR(); return }
        const image = await QRCode.toDataURL(url, { width: 512, margin: 4, errorCorrectionLevel: 'L' })
        if (source !== 'internal' || controller !== current) return
        qr.src = preview.src = image
        qr.hidden = preview.hidden = false
    }
    const run = (operation: () => Promise<void>): Promise<void> => {
        pending++
        busy = true
        apply.disabled = regenerate.disabled = true
        const next = queue.then(async () => {
            try { await operation() } catch (error) { showError(error) }
            finally { busy = --pending > 0; apply.disabled = busy; updateSourceUI() }
        })
        queue = next
        return next
    }
    const setFollowerControls = (disabled: boolean) => {
        for (const id of ['tempo', 'swing', 'btn-tempo-up', 'btn-tempo-down', 'btn-transport-start', 'btn-transport-stop', 'btn-transport-reset']) {
            const control = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null
            if (control) control.disabled = disabled
        }
    }
    const create = async (role: 'leader' | 'follower') => {
        if (controller) {
            await controller.destroy()
            if (source === 'internal' && isPlaying()) await timer.start()
        }
        linked = false
        follower = role === 'follower'
        setFollowerControls(follower)
        controller = createWebRTCSyncController(timer, { role })
        const current = controller
        current.onStateChange = (state: { connected: boolean; locked: boolean }) => {
            if (controller !== current) return
            status.textContent = state.connected
                ? (state.locked || !follower ? 'Connected to browser' : 'Connected — synchronizing clock…')
                : 'Waiting for the other browser'
            if (state.connected && !linked) {
                linked = true
                if (source === 'internal' && !follower && isPlaying()) void current.startSynchronized().catch(showError)
            }
        }
        return current
    }
    const host = async () => {
        if (source !== 'internal') return
        qr.hidden = preview.hidden = true
        local.value = ''
        instructions.textContent = 'Scan this QR on another device. On that device, copy the reply link and paste it below to finish connecting. Keep both browsers open.'
        status.textContent = 'Preparing connection QR…'
        const current = await create('leader')
        await render(await current.createOfferBundle())
        status.textContent = 'Ready to connect'
    }
    const accept = async (value: string) => {
        const bundle = readSyncBundle(value)
        if (bundle.description.type === 'offer') {
            source = 'shared'
            updateSourceUI()
            status.textContent = 'Preparing reply…'
            const current = await create('follower')
            await current.applyOfferBundle(bundle)
            await render(await current.createAnswerBundle())
            instructions.textContent = 'Copy this reply link and paste it into the original browser’s connection dialog to finish pairing.'
            status.textContent = 'Reply ready — return it to the original browser'
        } else {
            if (!controller || follower) throw new Error('Open the original browser and paste the reply there.')
            await controller.applyAnswerBundle(bundle)
            status.textContent = 'Connecting…'
        }
    }
    const connect = async (value: string) => {
        apply.disabled = true
        try {
            const bundle = readSyncBundle(value)
            if (bundle.description.type === 'offer') await options.onSharedRequested?.()
            await run(() => accept(value))
        } catch (error) { apply.disabled = busy; showError(error) }
    }
    button.disabled = false
    button.addEventListener('click', () => dialog.showModal())
    document.getElementById('netronome-close')!.addEventListener('click', () => dialog.close())
    apply.addEventListener('click', () => void connect(remote.value))
    regenerate.addEventListener('click', () => void run(host))
    document.getElementById('netronome-copy')!.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(local.value)
            status.textContent = 'Connection link copied'
        } catch {
            local.select()
            status.textContent = 'Select and copy the connection link above.'
        }
    })
    // Capture the scanned invitation before persisting clock settings changes the URL.
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get('sync-bundle')
    const initialize = async () => {
        if (incoming) { dialog.showModal(); await connect(incoming) }
        else if (!controller && source === 'internal') await run(host)
    }
    updateSourceUI()
    if (options.autoStart !== false) void initialize()
    window.addEventListener('pagehide', () => { void controller?.destroy() }, { once: true })
    return {
        initialize,
        async setSource(nextSource: ClockSource) {
            source = nextSource
            hideQR()
            updateSourceUI()
            await run(async () => {
                const old = controller
                controller = undefined
                linked = follower = false
                await old?.destroy()
                local.value = ''
                setFollowerControls(source !== 'internal')
                if (source === 'internal') await host()
                else {
                    status.textContent = 'Paste a connection link from the room leader.'
                    instructions.textContent = 'Shared clock follows another browser. Copy the reply link back to its room leader to connect.'
                    if (source === 'midi' || source === 'manual') dialog.close()
                }
            })
        },
        tempoChanged() { if (source === 'internal' && linked && !follower) controller?.broadcastTempoUpdate() },
        transportChanged() {
            if (source !== 'internal' || !linked || follower || !controller) return
            void (isPlaying() ? controller.startSynchronized() : controller.stopSynchronized()).catch(showError)
        },
        get isFollower() { return follower }
    }
}
