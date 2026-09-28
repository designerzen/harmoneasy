import { createWebRTCSyncController } from 'netronome'
import QRCode from 'qrcode'
import LZString from 'lz-string'

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

export function createNetronomeLink(timer: any, isPlaying: () => boolean) {
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

    const showError = (error: unknown) => {
        status.textContent = error instanceof Error ? error.message : String(error)
    }
    const render = async (bundle: unknown) => {
        const url = createSyncUrl(bundle, window.location.href)
        local.value = url
        const image = await QRCode.toDataURL(url, { width: 512, margin: 4, errorCorrectionLevel: 'L' })
        qr.src = preview.src = image
        qr.hidden = preview.hidden = false
    }
    const run = async (operation: () => Promise<void>) => {
        if (busy) return
        busy = true
        apply.disabled = regenerate.disabled = true
        try { await operation() } catch (error) { showError(error) }
        finally { busy = false; apply.disabled = regenerate.disabled = false }
    }
    const setFollowerControls = (disabled: boolean) => {
        for (const id of ['tempo', 'btn-tempo-up', 'btn-tempo-down', 'btn-transport-start', 'btn-transport-stop', 'btn-transport-reset']) {
            const control = document.getElementById(id) as HTMLButtonElement | HTMLInputElement | null
            if (control) control.disabled = disabled
        }
    }
    const create = async (role: 'leader' | 'follower') => {
        if (controller) {
            await controller.destroy()
            if (isPlaying()) await timer.start()
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
                if (!follower && isPlaying()) void current.startSynchronized().catch(showError)
            }
        }
        return current
    }
    const host = async () => {
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
    button.disabled = false
    button.addEventListener('click', () => dialog.showModal())
    document.getElementById('netronome-close')!.addEventListener('click', () => dialog.close())
    apply.addEventListener('click', () => void run(() => accept(remote.value)))
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
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get('sync-bundle')
    if (incoming) dialog.showModal()
    void run(() => incoming ? accept(incoming) : host())
    window.addEventListener('pagehide', () => { void controller?.destroy() }, { once: true })
    return {
        tempoChanged() { if (linked && !follower) controller?.broadcastTempoUpdate() },
        transportChanged() {
            if (!linked || follower || !controller) return
            void (isPlaying() ? controller.startSynchronized() : controller.stopSynchronized()).catch(showError)
        },
        get isFollower() { return follower }
    }
}
