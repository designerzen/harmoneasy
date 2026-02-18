// import { createAudiotoolClient, secondsToTicks, Ticks } from "@audiotool/nexus"

import RecorderAudioEvent from "audiobus/audio-event-recorder.ts"
import { AUDIOTOOL_STORAGE_KEYS } from './audio-tool-settings.ts'
import type Timer from "audiobus/timing/timer.ts"
import type { IAudioCommand } from "audiobus/audio-command-interface.ts"

// lazily imported AudioToolSDK
let createAudiotoolClient:Function
let secondsToTicks:Function
let getLoginStatus:Function

/**
 * imports the SDK for AuioTool and caches it in memory
 * @returns {Boolean} has the SDK loaded from the cache?
 */
export const lazyLoadAutioToolSDK = async () => {
    if (createAudiotoolClient && secondsToTicks)
    {
        return false
    }
    const nexus = await import("@audiotool/nexus")
    createAudiotoolClient = nexus.createAudiotoolClient
    secondsToTicks = nexus.secondsToTicks
    getLoginStatus = nexus.getLoginStatus
    return true
}


export const checkAudioToolUserStatus = async () => {
	return await getLoginStatus({
		clientId:AUDIOTOOL_STORAGE_KEYS.CLIENT_ID,
		redirectUrl:AUDIOTOOL_STORAGE_KEYS.REDIRECT,
		scope: "project:write"
	})
}

/**
 * Log a User in and connect them to the AudioTooll SKD
 */
export const connectAndAuthoriseAudioTool = async () => {
    // Load the SDK
    await lazyLoadAutioToolSDK()
	// see if the user is already logged in
	const userStatus = await checkAudioToolUserStatus()
	// get current login status
	// Check if user if logged in, create login/logout buttons
	if (userStatus.loggedIn) 
	{
		console.debug("Logged in as", userStatus.userName)
		// userStatus.logOut()
		return createAudiotoolClient({authorization: userStatus.authorization})
	}else{
		// wait here until user has logged in...
		userStatus.login()
	}
    return false
}


/**
 *
 * @param recording
 */
export const createAudioToolProjectFromAudioEventRecording = async (recording:RecorderAudioEvent, timer:Timer ) => {

    const HARDCODED_PROJECT_URL = AUDIOTOOL_STORAGE_KEYS.PROJECT_URL

    try {
        const client = await connectAndAuthoriseAudioTool()

        // Take the timing
        const BPM = timer.BPM
        const data:IAudioCommand[] = recording.exportData()
        		
		// Now connect to the Audio Tool SDK
		// const client = await createAudiotoolClient({ 
        //     token: AUDIOTOOL_STORAGE_KEYS.PAT_TOKEN // authManager.mustGetToken,
        // })

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

            const duration = secondsToTicks(recording.duration, BPM)
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

           
            const noteRegion = t.create("noteRegion", {
                collection: collection.location,
                track: track.location,
                region: {
                    positionTicks: 0,
                    durationTicks: duration,
                    displayName: "harmoneasy",
                    loopDurationTicks: duration
                }
            })

            data.forEach(command => {
                switch( command.type )
                {
                    case 'noteOn':
                        const positionTicks = secondsToTicks(command.startAt, BPM)
                        const durationTicks = secondsToTicks(command.duration, BPM)

                        t.create("note", {
                            collection: collection.location,
                            pitch: command.number,
                            durationTicks,
                            positionTicks
                        })

                        console.log("Adding event to AudiotTool", {positionTicks, durationTicks})
                        break
                }

            })
        })

        const transaction = await nexus.createTransaction()
        transaction.send()

		return true
    } catch (error) {
        console.error("Error creating Audiotool project", error)
		return false
    }
}
