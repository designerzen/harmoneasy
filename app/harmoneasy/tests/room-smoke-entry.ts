import { RoomConnection } from '../source/services/room-connection'
import { RoomWorkspace } from '../source/services/room-workspace'
import { NOTE_ON, NOTE_OFF } from 'audiobus/commands'

// Real Chromium WebRTC and AudioWorklet clocks, with silent instrument/test workspace adapters.
export async function createMachine(role: 'leader' | 'follower') {
    const context = new AudioContext()
    await context.resume()
    let bypassed = false
    const timer = {
        audioContext: context, BPM: 120, swing: 0, divisions: 24, bars: 4, loaded: Promise.resolve(), isRunning: true,
        callback: () => {}, networkTick: () => {},
        get isUsingExternalTrigger() { return bypassed },
        bypass(value: boolean) { bypassed = value },
        async startTimer() {}, async stopTimer() {}
    }
    const connection = new RoomConnection(timer as any, { role, rtcConfig: { iceServers: [] } })
    const notes: Array<{ type: string; number: number; at: number }> = []
    let encoded = 'workspace:' + JSON.stringify({ name: role, padding: 'x'.repeat(100000) })
    const chain = {
        isActive: true,
        clearNoteCommands() {},
        onInputEvent(event: any) {
            if (manager.sessionInputHandler?.('lead', event.command)) return
            const commands = [{ ...event.command, number: event.command.number + 12 }]
            if (!manager.sessionOutputHandler?.('lead', commands)) void this.outputManager.triggerAudioCommandsOnOutputs(commands)
        },
        outputManager: {
            async triggerAudioCommandsOnOutputs(commands: any[]) {
                commands.forEach(command => notes.push({ type: command.type, number: command.number, at: connection.leaderTimeMs }))
            }
        }
    }
    const manager = Object.assign(new EventTarget(), {
        sessionInputHandler: undefined as any, sessionOutputHandler: undefined as any, transportRunning: true,
        chains: [chain], restoreWarnings: [] as string[],
        exportWorkspace: () => encoded,
        async restoreWorkspace(value: string) { encoded = value },
        getChain: (id: string) => id === 'lead' ? chain : undefined
    })
    let status = ''
    const errors: string[] = []
    let destroyed = false
    const workspace = new RoomWorkspace(connection, manager as any, () => context.currentTime, value => { status = value })
    connection.onError = error => errors.push(String(error))
    return {
        connection, timer, notes,
        getState: () => ({ status, errors, bpm: timer.BPM, swing: timer.swing, workspace: encoded, notes }),
        play(type = NOTE_ON) { chain.onInputEvent({ command: {
            type, number: 60, velocity: type === NOTE_OFF ? 0 : 100, channel: 1, value: 0, pitchBend: 0,
            subtype: '', from: 'test', text: '', raw: new Uint8Array(), startAt: 0, time: 0
        } }) },
        async destroy() {
            if (destroyed) return
            destroyed = true
            await workspace.destroy(); await connection.destroy(); await context.close()
        }
    }
}
