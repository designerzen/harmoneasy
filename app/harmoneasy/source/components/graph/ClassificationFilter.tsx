import React, { useId } from 'react'
import { choiceFilterOptions, type ClassifiedChoice } from './device-filters'

export function ClassificationFilter({ choices, value, onChange, label, compact = false }: {
    choices: ClassifiedChoice[]; value: string; onChange: (value: string) => void; label: string; compact?: boolean
}) {
    const id = useId()
    const groups = choiceFilterOptions(choices)
    const selectedLabel = groups.flatMap(group => group.options).find(option => option.value === value)?.label ?? 'All types and subtypes'
    return <label className={`classification-filter${compact ? ' classification-filter-compact' : ''}`} htmlFor={id}
        title={compact ? `${label}: ${selectedLabel}` : undefined} data-active={Boolean(value)}>
        {!compact && <span>{label}</span>}
        {compact && <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" /></svg>}
        <select id={id} aria-label={label} value={value} onChange={event => onChange(event.target.value)}>
            <option value="">All types and subtypes</option>
            {groups.map(group => <optgroup key={group.label} label={group.label}>
                {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>)}
        </select>
    </label>
}
