# @harmoneasy/shared-config

Shared configuration for linting and tooling across the Harmoneasy monorepo.

## Usage

In any package's `oxlint.config.ts`:

```typescript
import sharedConfig from '@harmoneasy/shared-config';

export default sharedConfig;
```

Or extend/override the shared config:

```typescript
import sharedConfig from '@harmoneasy/shared-config';

export default {
  ...sharedConfig,
  rules: {
    ...sharedConfig.rules,
    'no-debugger': 'error',
  },
};
```

[package.json](package.json) defines the current version and the root/`./oxlint` exports; [oxlint.config.ts](oxlint.config.ts) is the authoritative ruleset. This is a workspace configuration package, not a runtime music component, and has no build or test script.
