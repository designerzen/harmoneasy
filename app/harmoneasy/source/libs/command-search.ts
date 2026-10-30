export function normalizeCommandSearch(text: string): string {
	return text
		.replace(/([a-z])([A-Z])/g, "$1 $2")
		.normalize("NFKD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
}

export function commandSearchField(text: string) {
	const normalized = normalizeCommandSearch(text)
	const words = normalized.split(" ").filter(Boolean)
	return { text: normalized, words, initials: words.map((word) => word[0]).join("") }
}

type SearchField = ReturnType<typeof commandSearchField>

// Adjacent transpositions count as one typo (e.g. "temop" for "tempo").
function editDistance(query: string, word: string): number {
	let previous = Array.from({ length: word.length + 1 }, (_, index) => index)
	let beforePrevious = previous
	for (let row = 1; row <= query.length; row++) {
		const current = [row]
		for (let column = 1; column <= word.length; column++) {
			current[column] = Math.min(
				current[column - 1] + 1,
				previous[column] + 1,
				previous[column - 1] + Number(query[row - 1] !== word[column - 1])
			)
			if (
				row > 1 &&
				column > 1 &&
				query[row - 1] === word[column - 2] &&
				query[row - 2] === word[column - 1]
			) {
				current[column] = Math.min(current[column], beforePrevious[column - 2] + 1)
			}
		}
		beforePrevious = previous
		previous = current
	}
	return previous[word.length]
}

function tokenScore(token: string, field: SearchField): number {
	if (field.text === token) {
		return 0
	}
	if (field.words.includes(token)) {
		return 10
	}
	if (field.words.some((word) => word.startsWith(token))) {
		return 20
	}
	if (field.text.includes(token)) {
		return 35
	}
	if (token.length >= 2 && field.initials.startsWith(token)) {
		return 40
	}

	let score = Infinity
	if (token.length >= 3) {
		// Only accept reasonably compact subsequences, rather than scattered letters
		// across a long description. Short initialisms are handled separately above.
		for (const word of field.words) {
			let position = 0
			for (const letter of word) {
				if (letter === token[position]) {
					position++
				}
			}
			if (position === token.length && word.length <= token.length * 2) {
				score = Math.min(score, 60 + word.length - token.length)
			}
		}
	}
	// Avoid typo correction on very short queries, where it produces mostly noise.
	const tolerance = token.length >= 8 ? 2 : token.length >= 4 ? 1 : 0
	if (tolerance) {
		for (const word of field.words) {
			if (Math.abs(word.length - token.length) > tolerance) {
				continue
			}
			const distance = editDistance(token, word)
			if (distance <= tolerance) {
				score = Math.min(score, 80 + distance * 10)
			}
		}
	}
	return score
}

/** Lower scores are better; every query word must match at least one field. */
export function commandSearchScore(query: string, fields: SearchField[]): number {
	if (!query) {
		return 0
	}
	let score = 0
	for (const token of query.split(" ")) {
		const best = Math.min(
			...fields.map((field, index) => tokenScore(token, field) + index * 20)
		)
		if (!Number.isFinite(best)) {
			return Infinity
		}
		score += best
	}
	// Prefer the command name and the typed word order when several controls match.
	if (fields[0]?.text === query) {
		score -= 30
	} else if (fields[0]?.text.startsWith(query)) {
		score -= 15
	}
	return score
}