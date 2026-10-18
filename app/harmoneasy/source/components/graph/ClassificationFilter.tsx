import React, { useId } from 'react'
import { choiceFilterOptions, type ClassifiedChoice } from './device-filters'

export function ClassificationFilter({ choices, value, onChange, label }: {
    choices: ClassifiedChoice[]; value: string; onChange: (value: string) => void; label: string
}) {
    const id = useId()
    return <label className="classification-filter" htmlFor={id}>
        <span>{label}</span>
        <select id={id} value={value} onChange={event => onChange(event.target.value)}>
            <option value="">All types and subtypes</option>
            {choiceFilterOptions(choices).map(group => <optgroup key={group.label} label={group.label}>
                {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>)}
        </select>
    </label>
}
