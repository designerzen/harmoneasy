import path from 'node:path'
import { createMidiDeviceStore } from '../electron/midi-device-files.js'
import { refreshMidiDeviceProfiles, setMidiDeviceProfileSource } from '../../../packages/audiobus/midi/device-profiles'

export const publicMidiDevices = path.resolve('public/midi-devices')
export function useTestMidiProfileFiles(roots = [publicMidiDevices]) {
    const store = createMidiDeviceStore(() => roots)
    setMidiDeviceProfileSource('http://midi.test/midi-devices/', async input => {
        const relative = new URL(String(input)).pathname.replace(/^\/midi-devices\//, '')
        if (!relative) return new Response(JSON.stringify(await store.list()), { headers: { 'Content-Type': 'application/json' } })
        const file = await store.read(relative.split(path.sep).join('/'))
        return file ? new Response(file.bytes.toString('utf8'), { headers: { 'Content-Type': file.type } }) : new Response(null, { status: 404 })
    })
}
useTestMidiProfileFiles()
await refreshMidiDeviceProfiles(true)
