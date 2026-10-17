import React from 'react'

export function ElementIcon({ src, className = '' }: { src: string; className?: string }) {
    return <span className={`element-icon ${className}`.trim()} aria-hidden="true"
        style={{ maskImage: `url("${src}")` }} />
}
