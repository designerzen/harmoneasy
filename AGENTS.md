# Amp Agent Configuration for Harmoneasy

## Communication & Output Style

- **Be concise**: Answer in 1-3 sentences or short paragraphs
- **No summaries**: Don't write lengthy recaps of what you did
- **No flattery**: Skip adjectives like "great", "excellent", "perfect"
- **No emojis**: Keep it professional

## No Unnecessary Documentation

**CRITICAL**: Do not write documentation, summary, or .md files to disk unless the user explicitly asks for them.

- Focus on code implementation only
- Provide information verbally in responses
- Answer questions directly in chat
- Save disk space for actual code

## Existing Patterns

- Check how similar features are implemented before coding
- Follow established interfaces and class structures
- Use existing utilities and helpers
- Maintain consistency with codebase patterns
- For any event names used shared exported constants with UPPERCASE_NAMES

## React Boundary

**CRITICAL**: React may ONLY be used for the graph itself. All other application UI must use the established non-React patterns.

- The preset browser, sidebars, dialogs, controls, and surrounding application UI must not use React, even when displayed alongside or launched from the graph.
- Do not expand the React component tree or React state/context into non-graph features. Keep the graph's React mount boundary limited to the graph itself.
- Existing React implementations outside the graph are violations to migrate away from, not patterns to copy or extend.
