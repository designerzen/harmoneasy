import * as Commands from 'audiobus/commands'
import type { IAudioCommand } from 'audiobus/audio-command-interface'
import type IOChainManager from 'audiobus/io/IO-chain-manager'
import { acceptsMidiInput } from 'audiobus/io/inputs/midi-input-controls'

export type ClockSource = 'internal' | 'shared' | 'midi' | 'manual'
export const isClockSource = (value: unknown): value is ClockSource => ['internal', 'shared', 'midi', 'manual'].includes(value as string)
interface ClockTimer {
    now: number
    BPM: number
    isRunning: boolean
    lastRecordedExternalTime: number
    bypass(external: boolean): unknown
    externalTrigger(advance?: boolean): void
    resetTimer(): void
}
interface ClockLink { setSource(source: ClockSource): Promise<void> }
interface MidiPort { id: string; name: string }

export function clockMidiPorts(manager: IOChainManager): MidiPort[] {
    const ports = new Map<string, MidiPort>()
    for (const { device, direction } of manager.devices) {
        if (direction !== 'input' || !device.isConnected || !device.hasMidiInput?.()) continue
        const devices = device.inputDevices ?? (device.device ? [device.device] : [])
        for (const port of devices) {
            const id = String(port.id ?? port.index)
            if (acceptsMidiInput({ ...device.options, selectedChannel: 0 }, id, 0)) ports.set(id, { id, name: port.name ?? id })
        }
    }
    return [...ports.values()]
}

export class ClockSourceController {
    source: ClockSource = 'internal'
    midiDevice = ''
    private queue: Promise<void> = Promise.resolve()
    private lastPulse: number | undefined
    private intervals: number[] = []
    private switching = false
    private initialized = false
    private firstMidiPulse = false
    private midiAvailable = false
    private subscriptions = new Map<EventTarget, AbortController>()
    private abort = new AbortController()
    constructor(private timer: ClockTimer, private manager: IOChainManager, private link: ClockLink,
        private changed: (source: ClockSource, device: string) => void,
        private error: (error: unknown) => void) {
        manager.clockCommandHandler = this.handle
        manager.addEventListener('chainsUpdated', this.refresh, { signal: this.abort.signal })
        this.refresh()
    }
    private enqueue(operation: () => Promise<void> | void): Promise<void> {
        const next = this.queue.then(operation)
        this.queue = next.catch(this.error)
        return next
    }
    settled(): Promise<void> { return this.queue }
    adoptRoomRole(conductor: boolean): void {
        this.source = conductor ? 'internal' : 'shared'
        this.initialized = true
        this.manager.externallyControlledTransport = true
        this.timer.bypass(true)
        this.changed(this.source, this.midiDevice)
    }
    setSource(source: ClockSource, notifyLink = true): Promise<void> {
        if (this.initialized && source === this.source && !this.switching) return Promise.resolve()
        if (source === 'midi' && !clockMidiPorts(this.manager).length) return Promise.reject(new Error('Connect a MIDI input before selecting MIDI clock.'))
        this.switching = true
        return this.enqueue(async () => {
            try {
                await this.manager.transport('stop')
                this.manager.externallyControlledTransport = false
                if (notifyLink) await this.link.setSource(source)
                this.timer.bypass(source !== 'internal')
                this.source = source
                this.midiAvailable = clockMidiPorts(this.manager).some(port => port.id === this.midiDevice)
                this.initialized = true
                this.resetPulseTiming()
                this.firstMidiPulse = false
                this.manager.externallyControlledTransport = source === 'shared'
                if (source === 'internal' || source === 'manual') await this.manager.transport('start')
                this.changed(source, this.midiDevice)
            } finally { this.switching = false }
        })
    }
    setMidiDevice(id: string): Promise<void> {
        return this.enqueue(async () => {
            if (!clockMidiPorts(this.manager).some(port => port.id === id)) throw new Error('MIDI clock device is unavailable.')
            if (this.source === 'midi') await this.manager.transport('stop')
            this.midiDevice = id
            this.midiAvailable = true
            this.resetPulseTiming()
            this.changed(this.source, id)
        })
    }
    private resetPulseTiming(): void {
        this.lastPulse = undefined
        this.intervals = []
        this.timer.lastRecordedExternalTime = 0
    }
    private refresh = (): void => {
        const inputs = this.manager.devices.filter(entry => entry.direction === 'input').map(entry => entry.device as EventTarget)
        for (const [input, subscription] of this.subscriptions) {
            if (!inputs.includes(input)) { subscription.abort(); this.subscriptions.delete(input) }
        }
        for (const input of inputs) {
            if (this.subscriptions.has(input)) continue
            const subscription = new AbortController()
            this.subscriptions.set(input, subscription)
            for (const event of ['deviceListChanged', 'configurationChanged', 'connectionChanged']) {
                input.addEventListener(event, this.refresh, { signal: subscription.signal })
            }
        }
        const ports = clockMidiPorts(this.manager)
        if (!this.midiDevice || (this.source !== 'midi' && !ports.some(port => port.id === this.midiDevice))) {
            this.midiDevice = ports[0]?.id ?? ''
            this.resetPulseTiming()
        }
        const available = ports.some(port => port.id === this.midiDevice)
        if (this.source === 'midi' && this.midiAvailable && !available) {
            this.resetPulseTiming()
            void this.enqueue(() => this.manager.transport('stop'))
        }
        this.midiAvailable = available
        this.changed(this.source, this.midiDevice)
    }
    private pulse(timestamp: number): void {
        if (!this.manager.transportRunning) return
        if (this.lastPulse !== undefined) {
            const interval = timestamp - this.lastPulse
            if (interval > 0 && interval < 2) {
                this.intervals.push(interval)
                if (this.intervals.length > 24) this.intervals.shift()
                const mean = this.intervals.reduce((sum, value) => sum + value, 0) / this.intervals.length
                this.timer.BPM = 60 / (mean * 24)
            } else this.intervals = []
        }
        this.lastPulse = timestamp
        this.timer.externalTrigger(!this.firstMidiPulse)
        this.firstMidiPulse = false
    }
    manualTick(): Promise<void> {
        if (this.source !== 'manual' || this.switching) return Promise.resolve()
        const timestamp = this.timer.now
        return this.enqueue(() => this.pulse(timestamp))
    }
    handle = (command: IAudioCommand): boolean => {
        const realTime = [Commands.MIDI_CLOCK, Commands.MIDI_START, Commands.MIDI_STOP, Commands.MIDI_CONTINUE].includes(command.type)
        const localTransport = [Commands.PLAYBACK_START, Commands.PLAYBACK_STOP, Commands.PLAYBACK_TOGGLE].includes(command.type)
        const tempoControl = [Commands.TEMPO_TAP, Commands.TEMPO_INCREASE, Commands.TEMPO_DECREASE, Commands.DVS_CLOCK].includes(command.type)
        // Preserve musical notes unless the selected MIDI port is acting as a control surface.
        const samePort = this.source === 'midi' && command.from === this.midiDevice
        const selected = samePort && this.midiAvailable
        const mackie = samePort && command.channel === 1 && [91, 93, 94, 95].includes(command.number)
            && [Commands.NOTE_ON, Commands.NOTE_OFF].includes(command.type)
        const raw = command.raw
        const mmc = samePort && raw?.length === 6 && raw[0] === 0xf0 && raw[1] === 0x7f && raw[3] === 6 && raw[5] === 0xf7
        if (tempoControl && this.source !== 'internal') return true
        if (localTransport && (this.source === 'shared' || this.source === 'midi')) return true
        if (!realTime && !mackie && !mmc) return false
        if (this.switching || !selected) return true
        const timestamp = this.timer.now
        void this.enqueue(async () => {
            if (this.source !== 'midi' || command.from !== this.midiDevice || !this.midiAvailable) return
            if (command.type === Commands.MIDI_CLOCK) { this.pulse(timestamp); return }
            if (mackie && (command.type !== Commands.NOTE_ON || command.velocity === 0)) return
            const action = mackie ? ({ 91: 'reset', 93: 'stop', 94: 'start', 95: 'start' } as const)[command.number]
                : mmc ? ({ 1: 'stop', 2: 'start', 3: 'start', 6: 'start' } as const)[raw[4]]
                : command.type === Commands.MIDI_START ? 'restart' : command.type === Commands.MIDI_STOP ? 'stop' : 'start'
            if (!action) return
            this.resetPulseTiming()
            if (action === 'restart') {
                await this.manager.transport('reset')
                this.firstMidiPulse = true
                await this.manager.transport('start')
            }
            else await this.manager.transport(action)
        })
        return true
    }
    destroy(): void {
        this.abort.abort()
        this.subscriptions.forEach(subscription => subscription.abort())
        this.subscriptions.clear()
        if (this.manager.clockCommandHandler === this.handle) this.manager.clockCommandHandler = undefined
    }
}
