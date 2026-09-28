import { AudioToolConnection } from './audio-tool-connect'
import type { AudioToolTake } from './adapter-audiotool-audio-events-recording'

export interface CapturedTake { take: AudioToolTake; markSent: () => void }

/** A reusable dialog; opening it has no effect on the performance or recording. */
export function createAudioToolPanel(capture: () => CapturedTake) {
    let storage: Storage | undefined
    try { storage = window.localStorage } catch { /* Private browsing may disable storage. */ }
    const connection = new AudioToolConnection(storage)
    const dialog = document.createElement('dialog')
    dialog.setAttribute('aria-labelledby', 'audiotool-title')
    dialog.className = 'audiotool-dialog'
    dialog.innerHTML = `
        <header>
            <h5 id="audiotool-title">AudioTool</h5>
            <form method="dialog" class="audiotool-dialog-close">
                <button type="submit" title="Close dialog" aria-label="Close dialog">
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 6 12 12M18 6 6 18" /></svg>
                </button>
            </form>
        </header>
        <div class="audiotool-dialog-content" tabindex="0" role="region" aria-label="AudioTool connection and take settings">
        <p>Send a take while composing. Your recording stays in Harmoneasy.</p>
        <p data-status role="status" aria-live="polite">Loading AudioTool…</p>
        <p data-error role="alert" hidden></p>
        <button type="button" data-connect disabled>Connect to AudioTool</button>
        <button type="button" data-disconnect hidden>Disconnect</button>
        <details data-token-section>
            <summary>Connect with a personal access token</summary>
            <p>For desktop or environments where popup login is unavailable. The token is used only for this session.</p>
            <p><a href="https://developer.audiotool.com/personal-access-tokens" target="_blank" rel="noopener noreferrer">Manage AudioTool personal access tokens</a></p>
            <label>AudioTool token <input data-token type="password" autocomplete="off" spellcheck="false"></label>
            <button type="button" data-token-connect disabled>Connect with token</button>
        </details>
        <fieldset data-projects disabled>
            <legend>Destination</legend>
            <label>Project <select data-project><option value="">Choose a project</option></select></label>
            <button type="button" data-refresh>Refresh projects</button>
            <label>New project name <input data-name value="Harmoneasy" maxlength="120"></label>
            <button type="button" data-create>Create project</button>
            <label>Or project URL <input data-url type="url" placeholder="https://beta.audiotool.com/studio?project=…"></label>
            <button type="button" data-open>Use project URL</button>
        </fieldset>
        <fieldset data-destination disabled>
            <legend>Take</legend>
            <label>Track <select data-track><option value="">New tracks for each chain/input/channel</option></select></label>
            <label>Placement <select data-placement><option value="end">After existing music</option><option value="start">At the beginning</option></select></label>
            <p data-tempo></p>
            <p data-take></p>
            <button type="button" data-capture>Capture latest notes</button>
            <button type="button" data-send disabled>Send current take</button>
        </fieldset>
        <p><a data-link target="_blank" rel="noopener noreferrer" hidden>Open project in AudioTool</a></p>
        </div>`
    document.body.append(dialog)
    const get = <T extends HTMLElement>(selector: string) => dialog.querySelector<T>(selector)!
    const status = get<HTMLParagraphElement>('[data-status]')
    const error = get<HTMLParagraphElement>('[data-error]')
    const connect = get<HTMLButtonElement>('[data-connect]')
    const tokenConnect = get<HTMLButtonElement>('[data-token-connect]')
    const tokenInput = get<HTMLInputElement>('[data-token]')
    const disconnect = get<HTMLButtonElement>('[data-disconnect]')
    const projects = get<HTMLFieldSetElement>('[data-projects]')
    const destination = get<HTMLFieldSetElement>('[data-destination]')
    const projectSelect = get<HTMLSelectElement>('[data-project]')
    const trackSelect = get<HTMLSelectElement>('[data-track]')
    const placement = get<HTMLSelectElement>('[data-placement]')
    const send = get<HTMLButtonElement>('[data-send]')
    const link = get<HTMLAnchorElement>('[data-link]')
    const takeText = get<HTMLParagraphElement>('[data-take]')
    const tempo = get<HTMLParagraphElement>('[data-tempo]')
    const newProjects = new Set<string>()
    let selectedProject = ''
    let current: CapturedTake | undefined
    let busy = false
    let prepared = false

    function updateControls() {
        connect.disabled = busy || !prepared || window.location.origin === 'null'
        connect.hidden = connection.isConnected
        get('[data-token-section]').hidden = connection.isConnected
        tokenConnect.disabled = busy || !prepared
        tokenInput.disabled = busy
        disconnect.hidden = !connection.isConnected
        disconnect.disabled = busy
        projects.disabled = busy || !connection.isConnected
        destination.disabled = busy || !selectedProject || !connection.isConnected
        send.disabled = busy || !current || !selectedProject
    }
    function showError(reason: unknown) {
        error.textContent = reason instanceof Error ? reason.message : String(reason)
        error.hidden = false
    }
    async function run(action: () => Promise<void>) {
        if (busy) return
        busy = true
        error.hidden = true
        updateControls()
        try { await action() } catch (reason) {
            showError(reason)
            status.textContent = 'The operation did not complete. Your captured take is still available.'
        }
        finally { busy = false; updateControls() }
    }
    function showLink(url: string) {
        const parsed = new URL(url)
        if (parsed.protocol !== 'https:' || !(parsed.hostname === 'audiotool.com' || parsed.hostname.endsWith('.audiotool.com'))) throw new Error('AudioTool returned an invalid project link.')
        link.href = parsed.href
        link.hidden = false
    }
    function captureLatest() {
        try {
            current = capture()
            takeText.textContent = `${current.take.notes.length} notes captured at ${current.take.bpm} BPM. Capture again to include newer notes.`
            error.hidden = true
        } catch (reason) {
            current = undefined
            takeText.textContent = 'No unsent notes. Play some notes, then capture a take.'
            showError(reason)
        }
        updateControls()
    }
    async function selectProject(project: string) {
        selectedProject = ''
        link.hidden = true
        trackSelect.replaceChildren(new Option('New tracks for each chain/input/channel', ''))
        if (!project) return
        status.textContent = 'Opening project…'
        const details = await connection.inspectProject(project)
        selectedProject = project
        connection.rememberProject(project)
        for (const track of details.tracks) trackSelect.add(new Option(track.label, track.id))
        showLink(details.url)
        tempo.textContent = newProjects.has(project) ? 'The new project will use this take’s tempo.' : `Project tempo: ${details.bpm} BPM. The take follows the project’s tempo; existing music is preserved.`
        status.textContent = `Connected as ${connection.userName}`
    }
    async function refreshProjects() {
        status.textContent = 'Loading projects…'
        const list = await connection.listProjects()
        projectSelect.replaceChildren(new Option('Choose a project', ''))
        for (const project of list) projectSelect.add(new Option(project.displayName, project.name))
        const remembered = selectedProject || connection.selectedProject
        if (list.some(project => project.name === remembered)) {
            projectSelect.value = remembered
            await selectProject(remembered)
        } else {
            await selectProject('')
            status.textContent = list.length ? 'Choose a project or create one.' : 'Create your first project or paste a project URL.'
        }
    }
    connect.addEventListener('click', () => {
        void run(async () => {
            status.textContent = 'Complete sign-in in the AudioTool window…'
            // run invokes this callback synchronously, preserving popup user activation.
            // Calling inside its try/catch also catches synchronous SDK failures.
            await connection.connect()
            await refreshProjects()
        })
    })
    tokenConnect.addEventListener('click', () => void run(async () => {
        status.textContent = 'Connecting to AudioTool…'
        try { await connection.connectWithToken(tokenInput.value) }
        finally { tokenInput.value = '' }
        await refreshProjects()
    }))
    disconnect.addEventListener('click', () => {
        connection.disconnect()
        selectedProject = ''
        link.hidden = true
        status.textContent = 'Disconnected. Your captured take is still available.'
        updateControls()
    })
    projectSelect.addEventListener('change', () => void run(() => selectProject(projectSelect.value)))
    get('[data-refresh]').addEventListener('click', () => void run(refreshProjects))
    get('[data-create]').addEventListener('click', () => void run(async () => {
        status.textContent = 'Creating project…'
        const project = await connection.createProject(get<HTMLInputElement>('[data-name]').value)
        newProjects.add(project.name)
        projectSelect.add(new Option(project.displayName, project.name))
        projectSelect.value = project.name
        await selectProject(project.name)
    }))
    get('[data-open]').addEventListener('click', () => void run(async () => {
        const url = new URL(get<HTMLInputElement>('[data-url]').value.trim())
        if (url.protocol !== 'https:' || !(url.hostname === 'audiotool.com' || url.hostname.endsWith('.audiotool.com')) || !url.searchParams.get('project')) throw new Error('Paste an AudioTool Studio project URL.')
        const project = `projects/${url.searchParams.get('project')}`
        await selectProject(project)
        if (!Array.from(projectSelect.options).some(option => option.value === project)) projectSelect.add(new Option(project, project))
        projectSelect.value = project
    }))
    get('[data-capture]').addEventListener('click', captureLatest)
    send.addEventListener('click', () => void run(async () => {
        if (!current) return
        status.textContent = 'Sending take… Keep this page open until it finishes.'
        const result = await connection.sendTake(selectedProject, current.take, {
            trackId: trackSelect.value || undefined,
            placement: placement.value === 'start' ? 'start' : 'end',
            setTempo: newProjects.has(selectedProject)
        })
        current.markSent()
        current = undefined
        newProjects.delete(selectedProject)
        showLink(result.url)
        status.textContent = result.alreadySent ? 'This take is already in the project.' : `Sent ${result.noteCount} notes to AudioTool.`
        takeText.textContent = 'Play more notes, then capture your next take.'
        tempo.textContent = 'Further takes follow the project’s tempo.'
    }))
    // Closing only hides the panel. Pending operations and the take survive;
    // reopening while busy cannot start another operation or replace the take.
    return {
        async open() {
            if (!dialog.open) dialog.showModal()
            if (busy) return
            if (!current) captureLatest()
            await run(async () => {
                await connection.prepare()
                prepared = true
                if (!connection.isConnected) {
                    status.textContent = window.location.origin === 'null'
                        ? 'Use a personal access token to connect from the desktop app.'
                        : 'Connect to choose where to send your take.'
                    if (window.location.origin === 'null') get<HTMLDetailsElement>('[data-token-section]').open = true
                }
            })
        },
        destroy() { dialog.remove() }
    }
}
