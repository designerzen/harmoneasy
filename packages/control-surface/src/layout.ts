export interface LayoutWidget {
	span?: number
	height?: number
	column?: number
	sourceId?: string
	group?: string
	widget?: string
}
const GAP = 8
type Interval = { start: number; end: number }

/** Find the first common free vertical interval; smaller gadgets can fill earlier holes. */
function fit(columns: Interval[][], column: number, span: number, height: number): number {
	const cursors = Array(span).fill(0)
	let y = 0
	for (;;) {
		let next = y
		for (let offset = 0; offset < span; offset++) {
			const occupied = columns[column + offset]
			while (cursors[offset] < occupied.length && occupied[cursors[offset]].end <= y) {
				cursors[offset]++
			}
			const interval = occupied[cursors[offset]]
			if (interval && interval.start < y + height) {
				next = Math.max(next, interval.end)
			}
		}
		if (next === y) {
			return y
		}
		y = next
	}
}

/** Deterministic column packing. Every footprint is reserved before the next gadget is placed. */
export function layoutWidgets(widgets: LayoutWidget[], availableWidth: number) {
	const width = Number.isFinite(availableWidth) ? Math.max(1, availableWidth) : 640
	const count = Math.min(32, Math.max(1, Math.floor(width / 200))),
		cell = width / count
	const columns: Interval[][] = Array.from({ length: count }, () => [])
	const items = widgets.map((widget) => {
		const span = Math.max(1, Math.min(count, Math.round(widget.span ?? 1)))
		const height = Math.max(132, Math.min(720, widget.height ?? 172))
		let column = 0,
			y = Infinity
		const preferred =
			widget.column === undefined
				? undefined
				: Math.max(0, Math.min(count - span, Math.round(widget.column)))
		for (let candidate = 0; candidate <= count - span; candidate++) {
			if (preferred !== undefined && candidate !== preferred) {
				continue
			}
			const top = fit(columns, candidate, span, height + GAP)
			if (top < y) {
				y = top
				column = candidate
			}
		}
		for (let offset = 0; offset < span; offset++) {
			const occupied = columns[column + offset],
				interval = { start: y, end: y + height + GAP }
			if (!occupied.length || occupied[occupied.length - 1].start < y) {
				occupied.push(interval)
			} else {
				const before = occupied.findIndex((item) => item.start > y)
				occupied.splice(before < 0 ? occupied.length : before, 0, interval)
			}
		}
		return {
			x: column * cell,
			y,
			width: Math.max(1, cell * span - Math.min(GAP, width / 2)),
			height
		}
	})
	return {
		items,
		height: widgets.length ? Math.max(...columns.map((column) => column.at(-1)?.end ?? 0)) : 120
	}
}

/** Compare compactness, distance between related controls, and reach to musical playing zones. */
export function ergonomicOrder(widgets: LayoutWidget[], width: number): number[] {
	const indices = widgets.map((_, index) => index)
	const groups = new Map<string, number>()
	const group = (index: number) =>
		`${widgets[index].sourceId ?? ""}\u0000${widgets[index].group ?? ""}`
	indices.forEach((index) => {
		const id = group(index)
		if (!groups.has(id)) {
			groups.set(id, groups.size)
		}
	})
	const area = (index: number) => (widgets[index].span ?? 1) * (widgets[index].height ?? 172)
	const candidates = [
		indices,
		[...indices].sort((a, b) => groups.get(group(a))! - groups.get(group(b))! || a - b),
		[...indices].sort(
			(a, b) => groups.get(group(a))! - groups.get(group(b))! || area(b) - area(a) || a - b
		),
		[...indices].sort((a, b) => area(b) - area(a) || a - b),
		[...indices].sort(
			(a, b) =>
				(widgets[b].span ?? 1) - (widgets[a].span ?? 1) ||
				(widgets[b].height ?? 172) - (widgets[a].height ?? 172) ||
				a - b
		)
	]
	const score = (order: number[]) => {
		const layout = layoutWidgets(
			order.map((index) => ({ ...widgets[index], column: undefined })),
			width
		)
		const bounds = new Map<
			string,
			{ left: number; top: number; right: number; bottom: number }
		>()
		let reach = 0,
			playable = 0
		order.forEach((index, i) => {
			const rect = layout.items[i],
				id = group(index),
				previous = bounds.get(id)
			bounds.set(id, {
				left: Math.min(previous?.left ?? Infinity, rect.x),
				top: Math.min(previous?.top ?? Infinity, rect.y),
				right: Math.max(previous?.right ?? 0, rect.x + rect.width),
				bottom: Math.max(previous?.bottom ?? 0, rect.y + rect.height)
			})
			if (
				["piano-roll", "guitar-tab", "relative-keys", "strum", "pad", "xy"].includes(
					widgets[index].widget ?? ""
				)
			) {
				reach +=
					Math.abs(rect.x + rect.width / 2 - width / 2) +
					layout.height -
					rect.y -
					rect.height / 2
				playable++
			}
		})
		const spread =
			Array.from(bounds.values()).reduce(
				(sum, box) => sum + box.right - box.left + box.bottom - box.top,
				0
			) / Math.max(1, bounds.size)
		return {
			height: layout.height,
			travel: spread * 0.15 + (reach / Math.max(1, playable)) * 0.08
		}
	}
	let best = indices,
		bestScore = score(indices)
	for (const candidate of candidates.slice(1)) {
		const next = score(candidate)
		if (
			next.height < bestScore.height ||
			(next.height === bestScore.height && next.travel < bestScore.travel)
		) {
			best = candidate
			bestScore = next
		}
	}
	return best
}