import { RecorderAudioEvent } from "../audiobus/recorder-audio-event"
import { createAudiotoolClient, secondsToTicks, Ticks } from "@audiotool/nexus"
import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus"
import { STORAGE_KEYS } from '../audiotool/audio-tool-settings.js'
import type AudioCommand from "../audiobus/audio-command.js"
import type AudioEvent from "../audiobus/audio-event.js"
import type Timer from "../audiobus/timing/timer.js"
import { NOTE_ON } from "../../commands.js"
import { noteNumberToFrequency } from "../audiobus/note-model.js"

const HARDCODED_PROJECT_URL =  "https://beta.audiotool.com/studio?project=fe824261-7d93-4a75-95ec-3603d5891546"
const PAT_TOKEN = "at_pat_sFoMCeBSURZQA8YuWHWKYtpYviWgd4fCVCwPKqxnjmA"

/**
 * 
 * @param recording 
 */
export const createAudioToolProjectFromAudioEventRecording = async (recording:RecorderAudioEvent, timer:Timer ) => {
    
    // Take the timing
    const BPM = timer.BPM
    const data:AudioEvent[] = recording.exportData()

    const client = await createAudiotoolClient({ token: PAT_TOKEN })

    // Create synced document
    const nexus = await client.createSyncedDocument({
        mode: "online",
        project: HARDCODED_PROJECT_URL
    })

    await nexus.start()
    
    // create the neccessary instruments and note regions
    await nexus.modify(t => {
        t.entities.ofTypes("noteTrack", "mixerChannel").get().forEach(track => {
            t.removeWithDependencies(track.id)
        })

        const channel = t.create("mixerChannel", {})

        // simplest instrument
        const tonematrix = t.create("tonematrix", {})

        t.create("desktopAudioCable", {
            fromSocket: tonematrix.fields.audioOutput.location,
            toSocket: channel.fields.audioInput.location
        })
       
        // note track for channel
        const track = t.create("noteTrack", {
            player: tonematrix.location
        })

        const collection = t.create("noteCollection", {})

        const duration = secondsToTicks(recording.duration, 120)

        console.log('DURATION', duration)

        const noteRegion = t.create("noteRegion", {
            collection: collection.location,
            track: track.location,
            region: {
                positionTicks: 0,
                durationTicks: Ticks.Beat * 4 * 10,
                displayName: "harmoneasy",
                loopDurationTicks: Ticks.Beat * 4 * 10
            }
        })

        data.forEach(command => {
            switch( command.type )
            {
                case NOTE_ON :
                    const positionTicks = secondsToTicks(command.startAt, 120)
                    const durationTicks =  secondsToTicks(command.duration, 120)
                  
                    t.create("note", {
                        collection: collection.location,
                        pitch: command.noteNumber,
                        durationTicks,
                        positionTicks
                    })

                    console.log("Adding event to AudiotTool", {positionTicks, durationTicks})
                    break
            }
         
        })

        collection
    })

    const transaction = await nexus.createTransaction()
    transaction.send()
}