# Packages Configuration

The packages information displayed in the app is automatically managed to stay in sync with the actual workspace package versions.

## How It Works

1. **Source of Truth**: Each workspace package has its own `package.json` file with the correct version, description, and metadata.

2. **Auto-Generation**: The script `scripts/update-packages-config.js` reads all package.json files and generates `source/config/packages-config.ts` with current versions.

3. **Integration**: This script runs automatically before:
   - `pnpm run dev` - development server
   - `pnpm run build` - web build
   - `pnpm run build:electron` - Electron build
   - `pnpm run dev:electron` - Electron development

## Manual Update

To manually update the packages config after changing a package version:

```bash
node ../../scripts/update-packages-config.js
```

Or from the app directory:

```bash
cd app/harmoneasy
node ../../scripts/update-packages-config.js
```

## Workflow

1. **Update a package version** in `packages/<name>/package.json`
2. **Run any build or dev command** - the config will auto-update
3. **The packages dialog** will show the new version

## Files

- `scripts/update-packages-config.js` - Script that reads package.json files and updates the config
- `source/config/packages-config.ts` - Auto-generated file with package metadata (do not edit manually)
- `source/services/packages-service.ts` - Service that uses the config to display packages

## No Manual Edits

Do not edit `source/config/packages-config.ts` manually. It is regenerated every time you build or run the dev server. All version information comes from the workspace packages.
