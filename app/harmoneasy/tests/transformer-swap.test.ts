// @vitest-environment happy-dom
import { runUI } from "./native-ui"
import { expect, it, vi } from "vitest"
import { createTransformerPicker } from "../source/components/graph/Transformers"
import TransformerManager from "../../../packages/audiobus/io/transformer-manager-worker"
import { tranformerFactory } from "../../../packages/audiobus/io/transformer-factory"
import { ID_HARMONISER } from "../../../packages/audiobus/io/transformers/transformer-harmoniser"
import { ID_TRANSPOSER } from "../../../packages/audiobus/io/transformers/transformer-transposer"
import { ID_QUANTISE } from "../../../packages/audiobus/io/transformers/transformer-quantise"

it("keeps a transformer until selection and swaps it at the same position", async () => {
	const first = tranformerFactory(ID_HARMONISER),
		original = tranformerFactory(ID_TRANSPOSER),
		last = tranformerFactory(ID_QUANTISE)
	const manager = new TransformerManager([first, original, last] as any)
	const destroy = vi.spyOn(original, "destroy")
	const chain = {
		transformerManager: manager,
		clearNoteCommands: vi.fn(),
		setTransformers: manager.setTransformers.bind(manager)
	}
	const onAdded = vi.fn()
	const host = document.body.appendChild(document.createElement("div"))
	const view = createTransformerPicker({ chain } as any, { replacing: original as any, onAdded })
	try {
		host.append(view.element)
		expect(manager.activeTransformers).toEqual([first, original, last])
		expect(destroy).not.toHaveBeenCalled()
		await runUI(async () => host.querySelector<HTMLButtonElement>(".element-choice")!.click())
		expect(manager.activeTransformers).toHaveLength(3)
		expect(manager.activeTransformers[0]).toBe(first)
		expect(manager.activeTransformers[1]).not.toBe(original)
		expect(manager.activeTransformers[2]).toBe(last)
		expect(destroy).toHaveBeenCalledOnce()
		expect(chain.clearNoteCommands).toHaveBeenCalledOnce()
		expect(onAdded).toHaveBeenCalledOnce()
	} finally {
		view.destroy()
		host.remove()
		manager.destroy()
	}
})