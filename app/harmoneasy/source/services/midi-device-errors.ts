import type { MidiDeviceLoss } from 'audiobus/midi/hardware/known-midi-inputs'

// Device and chain names are external text; the existing error dialog accepts
// HTML, so escape these names before passing them to it.
const escapeText = (value: string) => value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!))
export function showMidiDeviceDisconnected(ui: { showError: (title: string, solution: string) => void }, loss: MidiDeviceLoss) {
    ui.showError('MIDI input disconnected',
        `The MIDI device “${escapeText(loss.name)}” was disconnected while active in ${loss.chains.map(escapeText).join(', ')}. `
        + 'Held notes have been released and the device is no longer available to those chains. Reconnect it to restore its Inputs and routing.')
}
