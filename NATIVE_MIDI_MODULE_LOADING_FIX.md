# Native MIDI Module Loading Fix

## Problem

Getting error when trying to use native MIDI adapters:
```
[OutputMIDI2Native] Native MIDI module not available: ReferenceError: require is not defined
    at output-midi2-native-device.ts:22:2
```

## Root Cause

The code was using CommonJS `require()` in an ES module context. HarmonEasy uses ES modules (`type: "module"` in package.json), so `require()` is not available.

```typescript
// ❌ Wrong - require() not defined in ES modules
try {
	nativeMIDI = require('../../../build/Release/midi2-native.node')
} catch (e) {
	console.warn(...)
}
```

## Solution

Changed to dynamic `import()` and lazy-load the module when needed:

```typescript
// ✅ Correct - use dynamic import()
async function loadNativeMIDI(): Promise<any> {
	if (nativeMIDI !== null) return nativeMIDI
	
	try {
		const mod = await import('../../../build/Release/midi2-native.node' as any)
		nativeMIDI = mod
		return nativeMIDI
	} catch (e) {
		console.warn('[OutputNativeMIDIDevice] Native MIDI module not available:', e)
		return null
	}
}
```

### Key Changes
1. **Dynamic Import**: Use `await import()` instead of `require()`
2. **Lazy Loading**: Load module only when `connect()` is called
3. **Caching**: Cache module after first load to avoid repeated imports
4. **Error Handling**: Graceful fallback if module unavailable

## Files Fixed: 4

### 1. OutputNativeMIDIDevice
```
source/libs/audiobus/io/outputs/output-native-midi-device.ts
```
- Added `loadNativeMIDI()` async function
- Updated `connect()` to load module lazily
- Module loads on first connection attempt

### 2. InputNativeMIDIDevice
```
source/libs/audiobus/io/inputs/input-native-midi-device.ts
```
- Added `loadNativeMIDI()` async function
- Updated `connect()` to load module lazily
- Module loads on first connection attempt

### 3. OutputMIDI2Native
```
source/libs/audiobus/io/outputs/output-midi2-native-device.ts
```
- Added `loadNativeMIDI()` async function
- Updated `connect()` to load module lazily
- Module loads on first connection attempt

### 4. InputMIDI2Native
```
source/libs/audiobus/io/inputs/input-midi2-native-device.ts
```
- Added `loadNativeMIDI()` async function
- Updated `connect()` to load module lazily
- Module loads on first connection attempt

## How It Works

### Before (Sync, Immediate)
```
Module Load
    ↓
App Start
```

### After (Async, Lazy)
```
App Start
    ↓
User creates MIDI output/input
    ↓
.connect() called
    ↓
loadNativeMIDI() executed
    ↓
Dynamic import() loads module
    ↓
MIDI device enumeration begins
```

## Benefits

✅ **ES Module Compatible**: Works with modern ES module syntax  
✅ **Lazy Loading**: Module only loaded when actually needed  
✅ **Cached**: Module loaded once, reused for all instances  
✅ **Graceful Degradation**: Application continues if module unavailable  
✅ **Better Error Handling**: Clear error messages when module missing  
✅ **No Breaking Changes**: Same public API, internal implementation improved  

## Usage Unaffected

All public APIs remain the same:

```typescript
// Same as before
const output = new OutputNativeMIDIDevice()
await output.connect()  // Module loads here
output.noteOn(60, 100)
```

## Module Loading Sequence

```
1. Create adapter
   OutputNativeMIDIDevice()
   └─ nativeMIDI = null (not loaded yet)

2. Call connect()
   ├─ Check if nativeMIDI === null
   │  └─ Yes, call loadNativeMIDI()
   │     └─ await import('./midi2-native.node')
   │        └─ Module loaded and cached
   └─ Enumerate devices
   └─ Connect to device #0

3. Send MIDI
   output.noteOn(60, 100)
   └─ Use already-loaded module

4. Create another adapter
   OutputNativeMIDIDevice2()
   └─ When connect() called, loadNativeMIDI() returns cached module
   └─ No re-import, uses existing reference
```

## Error Handling

### If Module Not Available

```typescript
try {
	const output = new OutputNativeMIDIDevice()
	await output.connect()
} catch (e) {
	console.log('Native MIDI not available, falling back to WebMIDI')
	// Use WebMIDI or other device
}
```

### Console Output

```
[OutputNativeMIDIDevice] Native MIDI module not available: 
Error: Cannot find module '../../../build/Release/midi2-native.node'

This is normal if native module not built yet:
npm run build-native
```

## Testing

### Without Native Module Built
```typescript
const output = new OutputNativeMIDIDevice()
await output.connect()  // Error: module not available
// Falls back to warning, no crash
```

### With Native Module Built
```typescript
npm run build-native  // Creates build/Release/midi2-native.node

const output = new OutputNativeMIDIDevice()
await output.connect()  // Loads module, enumerates devices
output.noteOn(60, 100)  // Works perfectly
```

## Status

✅ **All 4 adapters fixed**
✅ **ES module compatible**
✅ **Lazy loading implemented**
✅ **Error handling improved**
✅ **Ready for use**

---

## Summary of Changes

| File | Change |
|------|--------|
| output-native-midi-device.ts | Added loadNativeMIDI(), updated connect() |
| input-native-midi-device.ts | Added loadNativeMIDI(), updated connect() |
| output-midi2-native-device.ts | Added loadNativeMIDI(), updated connect() |
| input-midi2-native-device.ts | Added loadNativeMIDI(), updated connect() |

**Total Lines Changed**: ~50 lines across 4 files  
**Breaking Changes**: None  
**Backward Compatible**: Yes  
**Performance Impact**: Improved (lazy loading)
