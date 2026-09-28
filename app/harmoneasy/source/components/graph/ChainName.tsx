import React, { useEffect, useRef, useState } from 'react'
import type IOChain from 'audiobus/io/IO-chain'

export default function ChainName({ chain }: { chain: IOChain }) {
    const [draft, setDraft] = useState('')
    const cancelled = useRef(false)
    const originalDraft = useRef('')
    const name = chain.options.name ?? 'Untitled chain'
    useEffect(() => {
        setDraft(current => current ? name : '')
    }, [chain, name])
    const finish = () => {
        if (cancelled.current) {
            cancelled.current = false
            return
        }
        chain.setName(draft)
        setDraft(draft.trim() ? chain.options.name ?? '' : '')
    }
    return <input className="chain-name nodrag nopan" type="text"
        aria-label="Chain name" title="Rename chain" maxLength={80}
        placeholder={name} value={draft}
        onFocus={() => { cancelled.current = false; originalDraft.current = draft }}
        onChange={event => setDraft(event.target.value)} onBlur={() => finish()}
        onKeyDown={event => {
            if (event.key === 'Enter' || event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                cancelled.current = event.key === 'Escape'
                if (cancelled.current) setDraft(originalDraft.current)
                event.currentTarget.blur()
            }
        }} />
}
