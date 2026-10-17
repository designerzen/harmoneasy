import { afterEach, describe, expect, it, vi } from 'vitest'
import { KokoroSpeech } from '../../../packages/audiobus/io/outputs/kokoro-speech'
import { SPEECH_AUDIO, SPEECH_GENERATE, SPEECH_PRELOAD } from '../../../packages/audiobus/io/outputs/speech-messages'
import { pronounceSpeech, SPEECH_CHORD_QUALITIES, SPEECH_ROOT_NAMES, SPEECH_VOCABULARY } from '../../../packages/audiobus/io/outputs/speech-vocabulary'
import { noteNumberToName } from '../../../packages/audiobus/conversion/note-to-name'

afterEach(() => vi.unstubAllGlobals())

describe('speech cache', () => {
    it('covers every MIDI note and chord quality in every root', () => {
        for (let note = 0; note < 128; note++) expect(SPEECH_VOCABULARY).toContain(noteNumberToName(note))
        for (const root of SPEECH_ROOT_NAMES) {
            for (const quality of SPEECH_CHORD_QUALITIES) expect(SPEECH_VOCABULARY).toContain(`${root} ${quality}`)
        }
        expect(SPEECH_CHORD_QUALITIES).toContain('major')
        expect(SPEECH_CHORD_QUALITIES).toContain('minor seventh')
        expect(SPEECH_CHORD_QUALITIES).toContain('dominant flat 9 flat 5')
        expect(new Set(SPEECH_VOCABULARY).size).toBe(SPEECH_VOCABULARY.length)
    })

    it.each([['C#4', 'C sharp 4'], ['C-1', 'C minus 1'], ['Bb minor seventh', 'B flat minor seventh']])('pronounces %s as %s', (text, spoken) => {
        expect(pronounceSpeech(text)).toBe(spoken)
    })

    it('starts preload once and serves all prepared clips without another worker request', async () => {
        let worker: any
        vi.stubGlobal('Worker', class {
            postMessage = vi.fn()
            terminate = vi.fn()
            onmessage: any
            constructor() { worker = this }
        })
        const speech = new KokoroSpeech()
        speech.preload()
        speech.preload()
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: SPEECH_PRELOAD })
        const audio = { audio: new Float32Array([0, 0.5]), sampling_rate: 24000 }
        for (const text of SPEECH_VOCABULARY) worker.onmessage({ data: { kind: SPEECH_AUDIO, text, ...audio } })
        for (const text of SPEECH_VOCABULARY) expect(await speech.generate(text)).toEqual(audio)
        expect(worker.postMessage).toHaveBeenCalledTimes(1)
        speech.dispose()
        expect(worker.terminate).toHaveBeenCalledOnce()
    })

    it('deduplicates live requests and rejects pending work on disposal', async () => {
        let worker: any
        vi.stubGlobal('Worker', class {
            postMessage = vi.fn()
            terminate = vi.fn()
            constructor() { worker = this }
        })
        const speech = new KokoroSpeech()
        const first = speech.generate('C4')
        expect(speech.generate('C4')).toBe(first)
        expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({ kind: SPEECH_GENERATE, id: 1, text: 'C4' })
        const rejected = expect(first).rejects.toThrow('Voice worker stopped')
        speech.dispose()
        await rejected
    })
})
