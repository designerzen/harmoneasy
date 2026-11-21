import { setControlRenderer } from "audiobus/io/component-ui"
import { registerOutput } from "audiobus/io/output-factory"
import { registerInstrument } from "audiobus/instruments/instrument-types"
import { createDomGui } from "control-surface/dom"
import { pinkTromboneOutput } from "audiobus-output-pink-trombone"
import { vaporisateurInstrument } from "audiobus-output-opendaw-vaporisateur"

/** Supply audiobus with what it leaves to the host: a control renderer and optional engines. */
export function configureAudiobus(): void {
	setControlRenderer(createDomGui)
	registerOutput(pinkTromboneOutput)
	registerInstrument(vaporisateurInstrument)
}