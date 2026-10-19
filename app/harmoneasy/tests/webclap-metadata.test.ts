import { expect, it } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { CLAP_PATCHES } from '../../../packages/audiobus/instruments/clap/clap-catalog'
import { DEVICE_SUBTYPES } from '../../../packages/audiobus/io/device-classification'

it('ships complete, consistent metadata and reachable license files for every WebCLAP output', () => {
    const root = new URL('../public/', import.meta.url)
    expect(JSON.parse(readFileSync(new URL('clap-registry.json', root), 'utf8')).patches).toEqual(CLAP_PATCHES)
    for (const patch of CLAP_PATCHES) {
        for (const value of [patch.title, patch.description, patch.category, patch.author]) expect(value?.trim().length, patch.id).toBeGreaterThan(0)
        expect(DEVICE_SUBTYPES[patch.type!], patch.id).toContain(patch.subtype)
        expect(patch.attribution?.author).toBe(patch.author)
        expect(new URL(patch.attribution!.sourceUrl).protocol).toBe('https:')
        expect(patch.attribution!.licenseUrls.length).toBeGreaterThan(0)
        for (const url of patch.attribution!.licenseUrls) expect(existsSync(new URL(url.slice(1), root)), url).toBe(true)
    }
})
