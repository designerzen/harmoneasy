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
    'some-rule': 'off',
  },
};
```
