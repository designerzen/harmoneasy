# Auto-Updates Implementation

HarmonEasy uses the official Electron update mechanism via `update-electron-app` following the [Electron documentation](https://www.electronjs.org/docs/latest/tutorial/updates).

## How It Works

1. **App Startup**: Auto-updater checks for new releases on GitHub
2. **Background Download**: Updates are downloaded silently every 10 minutes
3. **User Notification**: When ready, a native dialog appears asking to restart
4. **Auto-Install**: Update installs when user restarts the app

## Setup

### 1. electron-builder Configuration (package.json)

Already configured in `package.json`:

```json
"build": {
  "publish": {
    "provider": "github",
    "owner": "designerzen",
    "repo": "harmoneasy"
  }
}
```

### 2. Auto-Updater Entry Point (electron-main.js)

Simple and clean implementation:

```javascript
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const updateElectronApp = require('update-electron-app')

function setupAutoUpdater() {
  if (!app.isPackaged) return // Skip in dev

  updateElectronApp({
    repo: 'designerzen/harmoneasy'
  })
}

app.on('ready', async () => {
  setupAutoUpdater()
  // ... rest of app setup
})
```

## Publishing Updates

### 1. Commit Changes
```bash
git add .
git commit -m "your changes"
```

### 2. Update Version
Edit `package.json` version number:
```json
"version": "0.0.9"
```

### 3. Create Git Tag
```bash
git tag v0.0.9
git push origin v0.0.9
```

### 4. GitHub Actions Builds
- Workflow (`.github/workflows/electron-build.yml`) automatically:
  - Builds for Windows, macOS, Linux
  - Creates GitHub release with tag `v0.0.9`
  - Uploads installers (.exe, .dmg, .AppImage, .deb, etc.)

### 5. Users Get Update
Running users:
- See "Update available" notification
- Download happens in background
- Dialog prompts to restart
- Update installs on restart

## Version Matching

**Important**: Git tag must match `package.json` version with `v` prefix:
- `package.json`: `"version": "0.0.9"`
- Git tag: `v0.0.9`

## For Unsigned Apps

Since Harmoneasy is unsigned, `update-electron-app` works as follows:

1. Checks GitHub Releases API for new versions
2. Compares with current app version
3. If newer version exists, downloads installer
4. Shows native dialog to restart and install

No code signing required for unsigned builds.

## Disabling Auto-Updates

To disable (for testing), comment out in `electron-main.js`:

```javascript
function setupAutoUpdater() {
  // if (!app.isPackaged) return // Disabled for testing
  
  // updateElectronApp({
  //   repo: 'designerzen/harmoneasy'
  // })
}
```

## Troubleshooting

### Updates not checking
- Verify app is packaged (not dev mode)
- Check GitHub release exists with correct tag
- Confirm version in `package.json` matches tag

### Release not showing in app
- GitHub release must not be in "draft" mode
- Check release tag format: `v0.0.X`
- Wait a few minutes for GitHub API cache

### Manual Update Check
Users can check Help menu (when implemented) or wait for automatic checks every 10 minutes.

## References
- [Electron Update Guide](https://www.electronjs.org/docs/latest/tutorial/updates)
- [update-electron-app](https://github.com/electron/update-electron-app)
- [GitHub Releases API](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository)
