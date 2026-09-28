import type { AudiotoolClient, SyncedDocument } from '@audiotool/nexus'
import { AUDIOTOOL_CLIENT_ID, AUDIOTOOL_STORAGE_KEYS } from './audio-tool-settings'
import { appendAudioToolTake, validateAudioToolTake, validateAudioToolDestination, type AudioToolTake, type TakeDestination } from './adapter-audiotool-audio-events-recording'

type SDK = typeof import('@audiotool/nexus')
interface Receipt { key: string; regions: string[] }
export interface AudioToolProject { name: string; displayName: string }
export interface AudioToolProjectDetails { url: string; bpm: number; tracks: { id: string; label: string }[] }

export class AudioToolConnection {
    private sdk?: SDK
    private client?: AudiotoolClient
    private login?: Promise<string>
    private sending = false
    private receipts: Receipt[] = []
    userName = ''

    constructor(private storage?: Pick<Storage, 'getItem' | 'setItem'>) {
        try {
            const parsed: unknown = JSON.parse(storage?.getItem(AUDIOTOOL_STORAGE_KEYS.RECEIPTS) ?? '[]')
            if (Array.isArray(parsed)) this.receipts = parsed.filter(item => typeof item?.key === 'string' && Array.isArray(item.regions) && item.regions.every((id: unknown) => typeof id === 'string')).slice(-50)
        } catch { /* Storage may be unavailable or contain an old format. */ }
    }

    get isConnected() { return !!this.client }
    get selectedProject() {
        try { return this.storage?.getItem(AUDIOTOOL_STORAGE_KEYS.PROJECT) ?? '' } catch { return '' }
    }
    rememberProject(name: string) {
        try { this.storage?.setItem(AUDIOTOOL_STORAGE_KEYS.PROJECT, name) } catch { /* Connection still works without persistence. */ }
    }
    async prepare() {
        this.sdk ??= await import('@audiotool/nexus')
        if (typeof this.sdk.audiotoolPopup !== 'function' || typeof this.sdk.createAudiotoolClient !== 'function') {
            this.sdk = undefined
            throw new Error('An outdated AudioTool module is cached. Restart the dev server and reload Harmoneasy to load the upgraded SDK.')
        }
    }

    // prepare() is called before displaying Connect. No await before the popup opens.
    async connect(): Promise<string> {
        if (this.client) return Promise.resolve(this.userName)
        if (this.login) return this.login
        if (!this.sdk) return Promise.reject(new Error('AudioTool is still loading. Please try again.'))
        if (typeof this.sdk.audiotoolPopup !== 'function') throw new Error('An outdated AudioTool module is cached. Restart the dev server and reload Harmoneasy.')
        if (window.location.origin === 'null') return Promise.reject(new Error('AudioTool popup sign-in needs an HTTP or HTTPS origin. Open Harmoneasy in your browser to connect.'))
        this.login = this.sdk.audiotoolPopup({ clientId: AUDIOTOOL_CLIENT_ID, scope: 'project:write' }).then(result => {
            if (result.status !== 'authenticated') throw result.error
            this.client = result
            this.userName = result.userName
            return result.userName
        }).finally(() => { this.login = undefined })
        return this.login
    }

    disconnect() {
        if (this.sending || this.login) throw new Error('Wait for the current AudioTool operation to finish.')
        this.client = undefined
        this.userName = ''
    }
    async connectWithToken(token: string): Promise<void> {
        if (!this.sdk) throw new Error('AudioTool is still loading. Please try again.')
        if (!token.trim()) throw new Error('Enter an AudioTool personal access token.')
        const client = await this.sdk.createAudiotoolClient({ auth: token.trim() })
        const response = await client.projects.listProjects({ pageSize: 1 }, { timeoutMs: 20000 })
        if (response instanceof Error) throw response
        // The SDK retains this token in memory only; never persist it ourselves.
        this.client = client
        this.userName = 'personal token'
    }
    private requireClient() {
        if (!this.client) throw new Error('Connect to AudioTool first.')
        return this.client
    }
    async listProjects(): Promise<AudioToolProject[]> {
        const client = this.requireClient()
        const projects: AudioToolProject[] = []
        let pageToken = ''
        do {
            const response = await client.projects.listProjects({ pageSize: 100, pageToken }, { timeoutMs: 20000 })
            if (response instanceof Error) throw response
            projects.push(...response.projects.map(project => ({ name: project.name, displayName: project.displayName || project.name })))
            pageToken = response.nextPageToken
        } while (pageToken)
        return projects
    }
    async createProject(name: string): Promise<AudioToolProject> {
        const result = await this.requireClient().projects.createProject({ project: { displayName: name.trim() || 'Harmoneasy' } }, { timeoutMs: 20000 })
        if (result instanceof Error) throw result
        if (!result.project) throw new Error('AudioTool did not return the new project.')
        const project = { name: result.project.name, displayName: result.project.displayName }
        this.rememberProject(project.name)
        return project
    }
    async inspectProject(project: string): Promise<AudioToolProjectDetails> {
        return this.withDocument(project, async doc => ({
            url: doc.dawUrl,
            bpm: doc.queryEntities.ofTypes('config').get()[0]?.fields.tempoBpm.value ?? 125,
            tracks: doc.queryEntities.ofTypes('noteTrack').get()
                .sort((a, b) => a.fields.orderAmongTracks.value - b.fields.orderAmongTracks.value)
                .map((track, index) => {
                    const player = doc.queryEntities.getEntity(track.fields.player.value.entityId)
                    const displayName = player && 'displayName' in player.fields ? player.fields.displayName.value : ''
                    return { id: track.id, label: `${index + 1}. ${displayName || 'Instrument'}` }
                })
        }))
    }
    private async withDocument<T>(project: string, action: (doc: SyncedDocument) => Promise<T>): Promise<T> {
        const doc = await this.requireClient().open(project)
        try {
            await doc.start()
            if (!doc.connected.getValue()) throw new Error('AudioTool is offline. Reconnect before sending a take.')
            return await action(doc)
        } finally {
            // stop() flushes writes before success is reported and releases the sync loop.
            await doc.stop()
        }
    }
    async sendTake(project: string, take: AudioToolTake, destination: TakeDestination) {
        validateAudioToolTake(take)
        if (this.sending) throw new Error('A take is already being sent.')
        this.sending = true
        try {
            const bytes = new TextEncoder().encode(JSON.stringify([take, destination.trackId ?? '', destination.placement]))
            const digest = await crypto.subtle.digest('SHA-256', bytes)
            const fingerprint = Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('')
            const result = await this.withDocument(project, async doc => {
                const key = `${doc.dawUrl}:${fingerprint}`
                const receipt = this.receipts.find(item => item.key === key)
                const alreadySent = await doc.modify(t => {
                    // Return preflight errors so Nexus can finish the empty transaction
                    // and release its lock before stop() flushes the document.
                    if (!doc.connected.getValue()) return new Error('AudioTool disconnected before the take could be sent. Please retry.')
                    if (receipt) {
                        const existing = t.entities.ofTypes('noteRegion').get().filter(region => receipt.regions.includes(region.id))
                        if (existing.length === receipt.regions.length && existing.length > 0) return true
                        if (existing.length) return new Error('Part of this take already exists in AudioTool. Check the project before sending it again.')
                    }
                    try { validateAudioToolDestination(t, take, destination) }
                    catch (error) { return error instanceof Error ? error : new Error(String(error)) }
                    const regions = appendAudioToolTake(t, take, destination)
                    // Retain IDs even if flushing fails, so retries can check the remote project.
                    this.receipts = [...this.receipts.filter(item => item.key !== key), { key, regions }].slice(-50)
                    try { this.storage?.setItem(AUDIOTOOL_STORAGE_KEYS.RECEIPTS, JSON.stringify(this.receipts)) } catch { /* In-memory retry protection remains available. */ }
                    return false
                })
                if (alreadySent instanceof Error) throw alreadySent
                return { url: doc.dawUrl, alreadySent, noteCount: take.notes.length }
            })
            this.rememberProject(project)
            return result
        } finally { this.sending = false }
    }
}
