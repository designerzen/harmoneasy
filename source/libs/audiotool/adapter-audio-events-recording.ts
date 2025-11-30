import { RecorderAudioEvent } from "../audiobus/recorder-audio-event"
import { createAudiotoolClient, secondsToTicks, Ticks } from "@audiotool/nexus"
import type { AudiotoolClient, SyncedDocument } from "@audiotool/nexus"
import { STORAGE_KEYS } from '../audiotool/audio-tool-settings.js'
import type AudioCommand from "../audiobus/audio-command.js"
import type AudioEvent from "../audiobus/audio-event.js"
import type Timer from "../audiobus/timing/timer.js"

const HARDCODED_PROJECT_URL =  ""
const PAT_TOKEN = "at_pat_q3xW2Xt7iyeeQuFttBx3DcGuIRZOtsDO0JqJZCkVOq0"

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
    
    // 
    await nexus.modify(t => {
        const tonematrix = t.create("tonematrix", {})
        const track = t.create("noteTrack", {
            player: tonematrix.location
        })

        const collection = t.create("noteCollection", {})

        const region = t.create("noteRegion", {
            collection: collection.location,
            track: track.location,
            region: {
                positionTicks: 0,
                durationTicks: Ticks.Beat * 4*10,
                displayName: "my region"
            }
        })

        const commands: AudioCommand[] = []

        commands.forEach(command => {
            t.create("note", {
                collection: collection.location,
                pitch: 1,
                durationTicks: 0,
                positionTicks: 0
            })
        })
    })

    const devices = nexus.queryEntities.ofTypes("tonematrix").get()

    if (devices.length === 0) {
      throw Error('No devices found. Create a tonematrix first!')
    }

    
    const result = await nexus.modify((t) => {
      // Create a note track
      const noteTrack = t.create("noteTrack", {
        orderAmongTracks: 0,
        player: device.location,
      })

      // Add a note region
      const noteRegion = t.create("noteRegion", {
        track: noteTrack.location,
        region: {
          positionTicks: 15360, // One 1/4 note in a 4/4 bar
          durationTicks: 15360 * 4,
        }
      })

      const commands:  AudioCommand[] = []
      const t = await nexus.createTransaction()
      t.send()
      await nexus.modify(t => {

          const b = commands.forEach((command:AudioCommand) => {
            const positionTicks = secondsToTicks(command.startAt/1_000_000, 120)
                // create notes
                t.create("note", {
                    noteCollection: noteRegion.location,
                    pitch: 60 + Math.floor(Math.random() * 24), // C4 to B5
                    positionTicks, // Random position in 4 bars
                    durationTicks: Ticks.Beat, // Quarter note
                    velocity: 0.7,
                    slide: false
                })
          })
      })

}