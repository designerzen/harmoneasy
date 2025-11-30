import { RecorderAudioEvent } from "../audiobus/recorder-audio-event"
import { createAudiotoolClient, secondsToTicks, Ticks } from "@audiotool/nexus"
import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus"
import { STORAGE_KEYS } from '../audiotool/audio-tool-settings.js'
import type AudioCommand from "../audiobus/audio-command.js"
import type AudioEvent from "../audiobus/audio-event.js"
import type Timer from "../audiobus/timing/timer.js"

const HARDCODED_PROJECT_URL =  "d8x95k99"
const PAT_TOKEN = "at_pat_q3xW2Xt7iyeeQuFttBx3DcGuIRZOtsDO0JqJZCkVOq0"

/**
 * 
 * @param recording 
 */
export const createAudioToolProjectFromAudioEventRecording = async (recording:RecorderAudioEvent, timer:Timer ) => {
    
    // Take the timing
    const BPM = timer.BPM
    const data:AudioEvent[] = recording.exportData()

    console.info("Converting data to AudiTool Format", data )

    const client = await createAudiotoolClient({ token: PAT_TOKEN })

    // Create synced document
    const nexus = await client.createSyncedDocument({
        mode: "online",
        project: HARDCODED_PROJECT_URL
    })
    
    // create the neccessary instruments and note regions
    await nexus.modify(t => {

        // simplest instrument
        const tonematrix = t.create("tonematrix", {})
       
        // note track for channel
        const track = t.create("noteTrack", {
            player: tonematrix.location
        })

        const collection = t.create("noteCollection", {})

        const noteRegion = t.create("noteRegion", {
            collection: collection.location,
            track: track.location,
            region: {
                positionTicks: 0,
                durationTicks: Ticks.Beat * 4*10,
                displayName: "my region"
            }
        })

        data.forEach(command => {
            const positionTicks = secondsToTicks(command.startAt/1_000_000, 120)
            t.create("note", {
                collection: collection.location,
                pitch: 1,
                durationTicks: 0,
                positionTicks
            })
        })

        collection
    })

    const transaction = await nexus.createTransaction()
    transaction.send()
}