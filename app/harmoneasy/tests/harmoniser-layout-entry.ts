import { setControlRenderer } from "audiobus/io/component-ui"
import { TransformerHarmoniser } from "audiobus/io/transformers/transformer-harmoniser"
import { createDomGui } from "control-surface/dom"
import "control-surface/style.css"
import "../source/assets/style/index.scss"

setControlRenderer(createDomGui)
const effect = new TransformerHarmoniser({ root: 3, mode: [0, 2, 3, 5, 7, 9, 11] })
const node = document.createElement("article")
node.className = "node-transformer graph-node category-tuning"
node.style.margin = "16px"
const header = node.appendChild(document.createElement("header"))
header.className = "device-node-header"
header.innerHTML = "<h6>Harmoniser</h6>"
const host = node.appendChild(document.createElement("div"))
host.className = "nodrag nowheel"
document.body.append(node)
void effect.createGui().then((gui) => {
	host.append(gui)
	Object.assign(window, { harmoniserLayout: { effect, node } })
})