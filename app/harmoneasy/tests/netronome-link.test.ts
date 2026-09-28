// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createNetronomeLink, createSyncUrl, readSyncBundle } from '../source/services/netronome-link'

const offer = { description: { type: 'offer', sdp: 'v=0\r\na=offer' } }
const answer = { description: { type: 'answer', sdp: 'v=0\r\na=answer' } }
const mocks = vi.hoisted(() => ({ controllers: [] as any[], qr: vi.fn(async () => 'data:image/png;base64,qr') }))
vi.mock('qrcode', () => ({ default: { toDataURL: mocks.qr } }))
vi.mock('netronome', () => ({
    createWebRTCSyncController: vi.fn((_timer, options) => {
        const controller = {
            options, destroy: vi.fn(async () => {}), createOfferBundle: vi.fn(async () => offer),
            applyOfferBundle: vi.fn(async () => {}), createAnswerBundle: vi.fn(async () => answer),
            applyAnswerBundle: vi.fn(async () => {}), startSynchronized: vi.fn(async () => {}),
            stopSynchronized: vi.fn(async () => {}), broadcastTempoUpdate: vi.fn(), onStateChange: undefined
        }
        mocks.controllers.push(controller)
        return controller
    })
}))
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const idle = () => vi.waitFor(() => expect(element<HTMLButtonElement>('netronome-apply').disabled).toBe(false))

beforeEach(() => {
    document.body.innerHTML = readFileSync('index.html', 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    window.history.replaceState(null, '', 'http://localhost:3000/')
    mocks.controllers.length = 0
    vi.clearAllMocks()
})

describe('Netronome connection links', () => {
    it('round-trips the session bundle without including workspace state', () => {
        const url = createSyncUrl(offer, 'https://example.com/harmoneasy/?io=private&tempo=90#old')
        expect(new URL(url).search).toBe('')
        expect(new URL(url).pathname).toBe('/harmoneasy/')
        expect(readSyncBundle(url)).toEqual(offer)
        expect(readSyncBundle(new URL(url).hash.slice('#sync-bundle='.length))).toEqual(offer)
        expect(() => readSyncBundle('invalid')).toThrow()
        expect(() => readSyncBundle(createSyncUrl({ description: { type: 'answer' } }, url))).toThrow()
    })

    it('shows a live offer QR and completes the host side with a reply', async () => {
        let playing = true
        const link = createNetronomeLink({}, () => playing)
        await idle()
        expect(mocks.controllers[0].options.role).toBe('leader')
        expect(element<HTMLImageElement>('netronome-qr-preview').hidden).toBe(false)
        expect(readSyncBundle(element<HTMLTextAreaElement>('netronome-local-link').value)).toEqual(offer)
        element<HTMLTextAreaElement>('netronome-remote-link').value = createSyncUrl(answer, window.location.href)
        element<HTMLButtonElement>('netronome-apply').click()
        await idle()
        const controller = mocks.controllers[0]
        expect(controller.applyAnswerBundle).toHaveBeenCalledWith(answer)
        controller.onStateChange({ connected: true, locked: true })
        expect(controller.startSynchronized).toHaveBeenCalledOnce()
        link.tempoChanged()
        expect(controller.broadcastTempoUpdate).toHaveBeenCalledOnce()
        playing = false
        link.transportChanged()
        expect(controller.stopSynchronized).toHaveBeenCalledOnce()
    })

    it('accepts a scanned offer URL and returns a reply for the original browser', async () => {
        window.history.replaceState(null, '', createSyncUrl(offer, window.location.href))
        const link = createNetronomeLink({}, () => true)
        await idle()
        expect(link.isFollower).toBe(true)
        expect(element<HTMLDialogElement>('netronome-dialog').open).toBe(true)
        expect(mocks.controllers[0].applyOfferBundle).toHaveBeenCalledWith(offer)
        expect(readSyncBundle(element<HTMLTextAreaElement>('netronome-local-link').value)).toEqual(answer)
        expect(element<HTMLInputElement>('tempo').disabled).toBe(true)
        link.tempoChanged()
        expect(mocks.controllers[0].broadcastTempoUpdate).not.toHaveBeenCalled()
    })

    it('keeps the live offer when a malformed reply is pasted', async () => {
        createNetronomeLink({}, () => true)
        await idle()
        element<HTMLTextAreaElement>('netronome-remote-link').value = 'invalid'
        element<HTMLButtonElement>('netronome-apply').click()
        await idle()
        expect(mocks.controllers[0].applyAnswerBundle).not.toHaveBeenCalled()
        expect(mocks.controllers[0].destroy).not.toHaveBeenCalled()
        expect(element('netronome-status').textContent).not.toBe('Connecting…')
    })
})
