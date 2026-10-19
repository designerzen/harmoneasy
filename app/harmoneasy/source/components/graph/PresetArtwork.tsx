import React, { useId } from 'react'
import type { TransformerPreset } from 'audiobus/io/preset-library'

// Stylised note diagrams, rather than audio waveforms: each score describes the
// musical gesture of the preset, not a promised recording of its output.
const SCORES: Record<string, { notes: number[][]; colour: string; gesture: string }> = {
    'c-major-sketchbook': { notes: [[0, 3], [2, 5], [4, 7], [6, 5], [8, 3]], colour: '#60c9b2', gesture: 'A melody settling into a major scale' },
    'a-minor-nocturne': { notes: [[0, 7], [2, 5], [4, 4], [6, 2], [8, 4]], colour: '#b3a0f4', gesture: 'A descending minor melody' },
    'd-dorian-session': { notes: [[0, 2], [2, 4], [4, 5], [6, 8], [8, 7]], colour: '#87b9f7', gesture: 'A rising modal melody' },
    'minimal-motion': { notes: [[0, 4], [3, 5], [6, 4], [9, 3]], colour: '#8cd5bd', gesture: 'Short notes with space between them' },
    'classic-chord': { notes: [[1, 2], [1, 4], [1, 6], [6, 3], [6, 5], [6, 7]], colour: '#edbd74', gesture: 'Single notes expanded into three-note chords' },
    'minor-chord-diary': { notes: [[1, 2], [1, 4], [1, 5], [6, 1], [6, 3], [6, 5]], colour: '#ba9bdc', gesture: 'Two groups of minor chord tones' },
    'seventh-heaven': { notes: [[1, 1], [1, 3], [1, 5], [1, 7], [6, 2], [6, 4], [6, 6], [6, 8]], colour: '#e3b78f', gesture: 'Four-note chords stacked in harmony' },
    'offbeat-chord-stabs': { notes: [[1, 2], [1, 4], [1, 6], [5, 2], [5, 4], [5, 6], [9, 2], [9, 4], [9, 6]], colour: '#ef9e7a', gesture: 'Short chord stabs between the beats' },
    'chord-arpeggiator': { notes: [[0, 2], [2, 4], [4, 6], [6, 2], [8, 4], [10, 6]], colour: '#85c6f5', gesture: 'Chord tones climbing in a repeating arpeggio' },
    'falling-minor-arp': { notes: [[0, 8], [2, 6], [4, 4], [6, 7], [8, 5], [10, 3]], colour: '#ada3f3', gesture: 'Falling minor chord tones' },
    'two-octave-pendulum': { notes: [[0, 1], [1, 3], [2, 5], [3, 7], [4, 9], [5, 7], [6, 5], [7, 3], [8, 1]], colour: '#76c8d4', gesture: 'An arpeggio sweeping up and down' },
    'triplet-cascade': { notes: [[0, 2], [1, 4], [2, 6], [4, 3], [5, 5], [6, 7], [8, 4], [9, 6], [10, 8]], colour: '#9bacfa', gesture: 'Climbing notes in groups of three' },
    'staccato-arp': { notes: [[0, 2], [2, 4], [4, 6], [6, 3], [8, 5], [10, 7]], colour: '#68d2ba', gesture: 'Short detached arpeggio notes' },
    'shuffled-chord-tones': { notes: [[0, 4], [1, 8], [2, 2], [4, 6], [5, 4], [7, 2], [8, 8], [10, 6]], colour: '#de9dcd', gesture: 'Chord tones rearranged into a varied pattern' },
    'double-tap': { notes: [[0, 4], [1, 4], [4, 6], [5, 6], [8, 3], [9, 3]], colour: '#f0ae79', gesture: 'Pairs of short repeated notes' },
    'chord-repeater': { notes: [[0, 2], [0, 4], [0, 6], [3, 2], [3, 4], [3, 6], [6, 2], [6, 4], [6, 6], [9, 2], [9, 4], [9, 6]], colour: '#e3ad74', gesture: 'Four evenly repeated chords' },
    'ratchet-fill': { notes: Array.from({ length: 8 }, (_, i) => [i + 1, 5]), colour: '#f4948d', gesture: 'A rapid burst of eight strikes' },
    'late-answer': { notes: [[3, 3], [5, 6], [7, 5], [9, 3]], colour: '#9dbce9', gesture: 'A phrase shifted later in time' },
    'bass-register': { notes: [[0, 1], [3, 2], [6, 3], [9, 1]], colour: '#78b9cb', gesture: 'A melody moved into the bass register' },
    'upper-octave-sparkle': { notes: [[0, 7], [2, 9], [4, 8], [6, 7], [8, 9], [10, 8]], colour: '#e9cb87', gesture: 'Short notes in a high register' },
    'fifth-above': { notes: [[0, 5], [2, 7], [4, 6], [6, 8], [8, 7]], colour: '#a9c9ee', gesture: 'A melodic shape shifted upwards' },
    'low-minor-pulse': { notes: [[0, 1], [2, 1], [4, 3], [6, 2], [8, 1], [10, 2]], colour: '#b5a1df', gesture: 'A low, detached minor pulse' }
}

export function PresetArtwork({ preset, compact = false }: { preset: Pick<TransformerPreset, 'id' | 'name' | 'steps'>; compact?: boolean }) {
    const id = useId()
    const score = SCORES[preset.id] ?? {
        notes: preset.steps.length ? preset.steps.map((_, i) => [i * 10 / Math.max(1, preset.steps.length), 2 + (i * 3) % 7]) : [[1, 4], [4, 4], [7, 4]],
        colour: '#aaa2e8', gesture: 'A custom musical chain'
    }
    const short = /staccato|minimal|tap|ratchet|pulse|stabs|sparkle/.test(preset.id)
    return <svg className={`preset-artwork${compact ? ' preset-artwork-small' : ''}`} viewBox="0 0 320 160"
        role={compact ? undefined : 'img'} aria-hidden={compact || undefined} aria-label={compact ? undefined : `${preset.name}: ${score.gesture}`}>
        <defs><linearGradient id={id} x2="1" y2="1"><stop stopColor="#232637" /><stop offset="1" stopColor="#111320" /></linearGradient></defs>
        <rect width="320" height="160" rx="14" fill={`url(#${id})`} />
        <circle cx="270" cy="16" r="110" fill={score.colour} opacity=".08" />
        {[0, 1, 2, 3, 4].map(i => <path key={i} d={`M24 ${32 + i * 24}H296`} stroke="#ffffff" strokeOpacity=".08" />)}
        {[0, 1, 2, 3].map(i => <path key={i} d={`M${32 + i * 80} 24V140`} stroke="#ffffff" strokeOpacity=".06" />)}
        {score.notes.map(([time, pitch], index) => <rect key={index} x={28 + time * 23} y={132 - pitch * 11}
            width={short ? 11 : 25} height="7" rx="3.5" fill={score.colour} opacity={.65 + (index % 3) * .15} />)}
        <path d="M24 144H296" stroke={score.colour} strokeOpacity=".25" />
    </svg>
}
