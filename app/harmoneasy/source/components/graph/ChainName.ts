import type IOChain from 'audiobus/io/IO-chain'
import { element } from './dom'

export function createChainName(chain: IOChain) {
	const input = element('input', 'chain-name nodrag nopan')
	input.type = 'text'
	input.maxLength = 80
	input.title = 'Rename chain'
	input.setAttribute('aria-label', 'Chain name')
	let original = '',
		cancelled = false
	input.onfocus = () => {
		original = input.value
		cancelled = false
	}
	input.onblur = () => {
		if (cancelled) {
			cancelled = false
			return
		}
		chain.setName(input.value)
		input.value = input.value.trim() ? (chain.options.name ?? '') : ''
	}
	input.onkeydown = (event) => {
		if (event.key !== 'Enter' && event.key !== 'Escape') return
		event.preventDefault()
		event.stopPropagation()
		cancelled = event.key === 'Escape'
		if (cancelled) input.value = original
		input.blur()
	}
	return {
		element: input,
		update() {
			input.placeholder = chain.options.name ?? 'Untitled chain'
			if (document.activeElement !== input && input.value) input.value = chain.options.name ?? ''
		},
	}
}