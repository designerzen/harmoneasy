// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { webcrypto } from 'node:crypto'
import { createOfflineDocument } from '../../../packages/audiotool/node_modules/@audiotool/nexus/dist/index.js'
import { createDiskWasmLoader } from '../../../packages/audiotool/node_modules/@audiotool/nexus/dist/node.js'
import { AudioToolConnection } from '../../../packages/audiotool/audio-tool-connect'
import { createAudioToolPanel } from '../../../packages/audiotool/audio-tool-io'
import { captureAudioToolTake } from '../../../packages/audiotool/adapter-audiotool-audio-events-recording'

const projectName = 'projects/49a7d03d-4684-4d50-bf10-8f2e63360ff5'
const url = 'https://beta.audiotool.com/studio?project=49a7d03d-4684-4d50-bf10-8f2e63360ff5'
const take = captureAudioToolTake([
    { type: 'noteOn', number: 60, channel: 1, from: 'Keyboard', velocity: 100, startAt: 1 },
    { type: 'noteOff', number: 60, channel: 1, from: 'Keyboard', velocity: 0, startAt: 1.5 }
], 120, 2)
const element = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!
const click = (selector: string) => element<HTMLButtonElement>(selector).click()
const status = () => element('[data-status]').textContent

beforeEach(() => {
    // Happy DOM does not implement the browser's Option constructor.
    vi.stubGlobal('Option', function (text: string, value: string) {
        const option = document.createElement('option')
        option.textContent = text
        option.value = value
        return option
    })
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value) }
    })
    vi.stubGlobal('crypto', webcrypto)
})
afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
})

async function setup() {
    const doc = await createOfflineDocument({ wasm: createDiskWasmLoader() })
    const stop = vi.fn().mockResolvedValue(undefined)
    const client = {
        projects: {
            listProjects: vi.fn().mockResolvedValue({ projects: [], nextPageToken: '' }),
            createProject: vi.fn().mockResolvedValue({ project: { name: projectName, displayName: 'Session' } })
        },
        open: vi.fn().mockResolvedValue({ ...doc, start: async () => {}, stop, dawUrl: url })
    }
    vi.spyOn(AudioToolConnection.prototype, 'prepare').mockResolvedValue(undefined)
    const connect = vi.spyOn(AudioToolConnection.prototype, 'connect').mockImplementation(async function () {
        Object.assign(this, { client, userName: 'Musician' })
        return 'Musician'
    })
    const markSent = vi.fn()
    const capture = vi.fn(() => ({ take, markSent }))
    const panel = createAudioToolPanel(capture)
    await panel.open()
    return { panel, doc, stop, client, connect, capture, markSent }
}

describe('AudioTool panel workflow', () => {
    it('connects, creates a project and writes a validated take through the real service', async () => {
        const { doc, client, markSent } = await setup()
        expect(element<HTMLButtonElement>('[data-connect]').disabled).toBe(false)
        click('[data-connect]')
        await vi.waitFor(() => expect(status(), element('[data-error]').textContent ?? '').toContain('Create your first project'))
        element<HTMLInputElement>('[data-name]').value = 'Session'
        click('[data-create]')
        await vi.waitFor(() => expect(element<HTMLButtonElement>('[data-send]').disabled).toBe(false))
        expect(client.projects.createProject.mock.calls[0][0]).toEqual({ project: { displayName: 'Session' } })
        click('[data-send]')
        await vi.waitFor(() => expect(status()).toBe('Sent 1 notes to AudioTool.'))
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(1)
        expect(doc.queryEntities.ofTypes('config').get()[0].fields.tempoBpm.value).toBe(120)
        expect(element<HTMLAnchorElement>('[data-link]').href).toBe(url)
        expect(markSent).toHaveBeenCalledOnce()
        expect(element<HTMLButtonElement>('[data-send]').disabled).toBe(true)
    })
    it('shows a synchronous login error in the panel and permits retry', async () => {
        const { connect } = await setup()
        connect.mockImplementationOnce(() => { throw new Error('popup unavailable') })
        click('[data-connect]')
        await vi.waitFor(() => expect(element('[data-error]').textContent).toBe('popup unavailable'))
        expect(element('[data-error]').hidden).toBe(false)
        expect(element<HTMLButtonElement>('[data-connect]').disabled).toBe(false)
        click('[data-connect]')
        await vi.waitFor(() => expect(status(), element('[data-error]').textContent ?? '').toContain('Create your first project'))
    })
    it('can close during sign-in and reopen without replacing the captured take', async () => {
        const { panel, connect, capture } = await setup()
        let finish!: (value: string) => void
        connect.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
        click('[data-connect]')
        const form = element<HTMLFormElement>('dialog form')
        const event = new Event('submit', { bubbles: true, cancelable: true })
        expect(form.dispatchEvent(event)).toBe(true)
        element<HTMLDialogElement>('dialog').close()
        await panel.open()
        expect(capture).toHaveBeenCalledOnce()
        expect(element<HTMLButtonElement>('[data-connect]').disabled).toBe(true)
        finish('Musician')
        await vi.waitFor(() => expect(element<HTMLButtonElement>('[data-connect]').disabled).toBe(false))
    })
    it('keeps the take after a failed flush and retries without duplicating notes', async () => {
        const { doc, client, stop, markSent } = await setup()
        client.projects.listProjects.mockResolvedValue({ projects: [{ name: projectName, displayName: 'Session' }], nextPageToken: '' })
        click('[data-connect]')
        await vi.waitFor(() => expect(status()).toContain('Choose a project'))
        element<HTMLSelectElement>('[data-project]').value = projectName
        element('[data-project]').dispatchEvent(new Event('change'))
        await vi.waitFor(() => expect(element<HTMLButtonElement>('[data-send]').disabled).toBe(false))
        stop.mockRejectedValueOnce(new Error('connection lost'))
        click('[data-send]')
        await vi.waitFor(() => expect(element('[data-error]').textContent).toBe('connection lost'))
        expect(markSent).not.toHaveBeenCalled()
        click('[data-send]')
        await vi.waitFor(() => expect(status()).toBe('This take is already in the project.'))
        expect(doc.queryEntities.ofTypes('note').get()).toHaveLength(1)
        expect(markSent).toHaveBeenCalledOnce()
    })
})

