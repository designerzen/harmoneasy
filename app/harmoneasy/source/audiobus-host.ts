import { setControlRenderer } from "audiobus/io/component-ui"
import { registerOutput } from "audiobus/io/output-factory"
import { createDomGui } from "control-surface/dom"
import { pinkTromboneOutput } from "audiobus-output-pink-trombone"

/** Supply audiobus with what it leaves to the host: a control renderer and optional outputs. */
export function configureAudiobus(): void {
	setControlRenderer(createDomGui)
	registerOutput(pinkTromboneOutput)
}
