const normalize = (value: string) =>
	value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()

// Bounded edit distance, including adjacent transpositions (e.g. "chrod").
function closeWord(query: string, word: string): boolean {
	const limit = query.length >= 8 ? 2 : 1
	if (Math.abs(query.length - word.length) > limit) {
		return false
	}
	const rows = [Array.from({ length: word.length + 1 }, (_, index) => index)]
	for (let i = 1; i <= query.length; i++) {
		const row = [i]
		for (let j = 1; j <= word.length; j++) {
			row[j] = Math.min(
				rows[i - 1][j] + 1,
				row[j - 1] + 1,
				rows[i - 1][j - 1] + Number(query[i - 1] !== word[j - 1])
			)
			if (i > 1 && j > 1 && query[i - 1] === word[j - 2] && query[i - 2] === word[j - 1]) {
				row[j] = Math.min(row[j], rows[i - 2][j - 2] + 1)
			}
		}
		rows.push(row)
	}
	return rows[query.length][word.length] <= limit
}

export function discoveryMatches(query: string, ...fields: (string | undefined)[]): boolean {
	const terms = normalize(query).match(/[\p{L}\p{N}]+/gu) ?? []
	if (!terms.length) {
		return true
	}
	const words = normalize(fields.filter(Boolean).join(" ")).match(/[\p{L}\p{N}]+/gu) ?? []
	return terms.every((term) =>
		words.some((word) => word.includes(term) || (term.length >= 4 && closeWord(term, word)))
	)
}