/** The directory needs only DOM filtering; it never imports the audio application. */
export function mountPresetDirectory(root) {
	const form = root.querySelector("form")
	const fields = ["q", "category", "input", "output"].map((name) => form.elements.namedItem(name))
	const cards = [...root.querySelectorAll(".preset")]
	const count = root.querySelector("#result-count")
	const empty = root.querySelector("#no-results")
	const reset = root.querySelector("#clear-filters")
	const location = new URL(window.location.href)
	for (const field of fields) {
		const value = location.searchParams.get(field.name) ?? ""
		field.value =
			field.tagName === "SELECT" &&
			![...field.options].some((option) => option.value === value)
				? ""
				: value
	}
	const filter = () => {
		const [query, category, input, output] = fields.map((field) => field.value)
		const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
		let visible = 0
		for (const card of cards) {
			card.hidden = !(
				terms.every((term) => card.dataset.search.includes(term)) &&
				(!category || card.dataset.category === category) &&
				(!input || JSON.parse(card.dataset.inputs).includes(input)) &&
				(!output || JSON.parse(card.dataset.outputs).includes(output))
			)
			if (!card.hidden) {
				visible++
			}
		}
		count.textContent = `${visible} ${visible === 1 ? "preset" : "presets"}${visible === cards.length ? "" : ` of ${cards.length}`}`
		empty.hidden = visible > 0
		reset.disabled = fields.every((field) => !field.value)
		const url = new URL(window.location.href)
		for (const field of fields) {
			if (field.value) {
				url.searchParams.set(field.name, field.value)
			} else {
				url.searchParams.delete(field.name)
			}
		}
		window.history.replaceState(null, "", url)
	}
	form.oninput = filter
	form.onchange = filter
	reset.onclick = () => {
		fields.forEach((field) => {
			field.value = ""
		})
		filter()
		fields[0].focus()
	}
	filter()
}