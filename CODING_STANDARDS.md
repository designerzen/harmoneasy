# Coding Standards

## Events

Use shared exported constants with `UPPERCASE_NAMES` for event names. Reuse constants from `packages/audiobus/event-constants.ts` where applicable. Uppercase applies to constant identifiers, not event string values.

## Application UI

Use the established non-React patterns for application UI. React is limited to the graph itself.

- Build the preset browser, sidebars, dialogs, controls, and surrounding application UI without React, including when displayed alongside or launched from the graph.
- Keep the React mount, component tree, state, and context limited to the graph itself; do not extend them into non-graph features.
- Existing React implementations outside the graph are violations to migrate away from, not patterns to copy or extend.

For non-React UI examples, consult `app/harmoneasy/source/components/graph/PresetBrowser.ts` and `app/harmoneasy/source/libs/dialog-utils.ts`.
