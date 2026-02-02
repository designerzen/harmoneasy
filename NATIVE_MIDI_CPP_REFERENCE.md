# Native MIDI C++ Implementation Reference

## Architecture

### File Structure
```
native/
├── midi2-native.cc          # Main implementation (cross-platform)
└── midi2-native.cc (conditionally compiled sections)
    ├── Windows (MM API)
    ├── macOS (CoreMIDI)
    └── Linux (ALSA)
```

### Design Pattern
Single source file with platform-specific blocks using preprocessor directives:
```cpp
#ifdef _WIN32
  // Windows MM API implementation
#elif __APPLE__
  // macOS CoreMIDI implementation
#elif __linux__
  // Linux ALSA implementation
#endif
```

## Platform-Specific APIs

### Windows (MM API)

**Header**: `#include <mmsystem.h>`  
**Library**: `winmm.lib` (declared in binding.gyp)

**Key Functions**:
```cpp
// Enumeration
UINT midiOutGetNumDevs()              // Get output device count
UINT midiInGetNumDevs()               // Get input device count
MMRESULT midiOutGetDevCaps(...)       // Get device capabilities
MMRESULT midiInGetDevCaps(...)        // Get input capabilities

// Device Management
MMRESULT midiOutOpen(HMIDIOUT*, ...)  // Open output device
MMRESULT midiInOpen(HMIDIIN*, ...)    // Open input device
MMRESULT midiOutClose(HMIDIOUT)       // Close output device
MMRESULT midiInClose(HMIDIIN)         // Close input device

// I/O
MMRESULT midiOutShortMsg(...)         // Send 3-byte MIDI message
MMRESULT midiInAddBuffer(...)         // Add input buffer
MMRESULT midiInStart(...)             // Start recording
MMRESULT midiInStop(...)              // Stop recording
```

**Data Structures**:
```cpp
typedef struct midioutcaps_tag {
  WORD wMid;                   // Manufacturer ID
  WORD wPid;                   // Product ID
  MMVERSION vDriverVersion;    // Driver version
  char szPname[MAXPNAMELEN];   // Device name
  WORD wTechnology;            // Device technology
  WORD wVoices;                // # of voices
  WORD wNotes;                 // # of notes
  WORD wChannelMask;           // Channels supported
  DWORD dwSupport;             // Support flags
} MIDIOUTCAPS;
```

**Message Format** (32-bit):
```cpp
// Note On (0x90 = Status, 0x3C = Note, 0x40 = Velocity)
uint32_t msg = 0x90 | (0x3C << 8) | (0x40 << 16);
midiOutShortMsg(handle, msg);

// Status byte in low byte
// Data 1 in byte 1
// Data 2 in byte 2
// Byte 3 unused for short messages
```

### macOS (CoreMIDI)

**Header**: `#include <CoreMIDI/CoreMIDI.h>`  
**Framework**: CoreMIDI + CoreFoundation (declared in binding.gyp)

**Key Functions**:
```cpp
// Enumeration
ItemCount MIDIGetNumberOfDestinations()     // Get MIDI output count
ItemCount MIDIGetNumberOfSources()          // Get MIDI input count
MIDIEndpointRef MIDIGetDestination(index)   // Get output endpoint
MIDIEndpointRef MIDIGetSource(index)        // Get input endpoint

// Properties
OSStatus MIDIObjectGetStringProperty(...)   // Get device name
OSStatus MIDIObjectSetIntegerProperty(...)  // Set properties
OSStatus MIDIObjectGetIntegerProperty(...)  // Get properties

// I/O
OSStatus MIDISend(...)                      // Send UMP packets
OSStatus MIDIInputPortCreate(...)           // Create input port
OSStatus MIDIOutputPortCreate(...)          // Create output port
OSStatus MIDIPortConnectSource(...)         // Connect input source

// Callbacks
typedef void (*MIDIReadProc)(...)           // Input callback type
```

**Data Structures**:
```cpp
struct MIDIPacket {
  MIDITimeStamp timeStamp;    // Timestamp in MIDI clock ticks
  UInt16 length;              // Packet data length
  Byte data[256];             // Variable length packet data
};

struct MIDIPacketList {
  UInt32 numPackets;          // Number of packets
  MIDIPacket packet[...];     // Array of packets
};
```

**UMP Format** (CoreMIDI native):
```cpp
// CoreMIDI handles UMP automatically
// Data bytes are directly the UMP words
uint32_t umpWord = 0x90603C00;  // MIDI 1 Note On, note 60, velocity 60
```

### Linux (ALSA)

**Header**: `#include <alsa/asoundlib.h>`  
**Library**: `-lasound` (libasound2, declared in binding.gyp)

**Key Functions**:
```cpp
// Initialization
int snd_card_next(int *cardnum)             // Enumerate ALSA cards
int snd_device_name_next_midi(...)          // Enumerate MIDI devices

// Device Management
int snd_rawmidi_open(...)                   // Open raw MIDI device
int snd_rawmidi_close(...)                  // Close device
int snd_rawmidi_nonblock(...)               // Set non-blocking mode

// I/O
ssize_t snd_rawmidi_write(...)              // Write MIDI data
ssize_t snd_rawmidi_read(...)               // Read MIDI data

// Information
int snd_rawmidi_info_set_device(...)
int snd_rawmidi_info_get_name(...)
int snd_rawmidi_info_get_subdevices(...)
```

**Device Query**:
```cpp
snd_rawmidi_info_t *info;
snd_rawmidi_info_alloca(&info);
snd_rawmidi_info(handle, info);
const char *name = snd_rawmidi_info_get_name(info);
```

**MIDI Message Format** (Byte array):
```cpp
// Raw MIDI bytes (same as MIDI 1.0)
unsigned char msg[3] = {0x90, 0x3C, 0x40};  // Note on, note 60, velocity 64
snd_rawmidi_write(handle, msg, 3);
```

## NAPI Implementation Details

### Module Initialization
```cpp
napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "methodName", 0, NAPIMethod, 0, 0, 0, napi_default, 0 },
    // ... more properties
  };
  napi_define_properties(env, exports, count, properties);
  return exports;
}

NAPI_MODULE(moduleName, Init)  // Register with Node.js
```

### Creating Values
```cpp
// Create objects
napi_value obj;
napi_create_object(env, &obj);

// Create arrays
napi_value arr;
napi_create_array(env, &arr);

// Create strings
napi_value str;
napi_create_string_utf8(env, "text", NAPI_AUTO_LENGTH, &str);

// Create numbers
napi_value num;
napi_create_uint32(env, 42, &num);

// Create booleans
napi_value bool_val;
napi_get_boolean(env, true, &bool_val);
```

### Setting Properties
```cpp
// Set object property
napi_set_named_property(env, obj, "propName", value);

// Set array element
napi_set_element(env, arr, index, value);
```

### Getting Arguments
```cpp
napi_value GetMethod(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  
  // Extract arguments
  uint32_t deviceIndex;
  napi_get_value_uint32(env, argv[0], &deviceIndex);
  
  uint32_t packet;
  napi_get_value_uint32(env, argv[1], &packet);
}
```

### Error Handling
```cpp
// Throw error
napi_throw_error(env, "ERROR_CODE", "Error message");
return nullptr;

// String representation
napi_throw_type_error(env, "TYPE_ERROR", "Expected number");

// From OS error
MMRESULT result = midiOutOpen(...);
if (result != MMSYSERR_NOERROR) {
  napi_throw_error(env, "MIDI_ERROR", "Failed to open device");
  return nullptr;
}
```

## Data Flow

### Sending MIDI (Output)
```
TypeScript Code
    ↓
output.noteOn(60, 100)
    ↓
OutputNativeMIDIDevice.noteOn()
    ↓
#sendUMP(packet: number)
    ↓
nativeMIDI.sendUmp(deviceIndex, packet)
    ↓
SendUmp(NAPI) → Extract device + packet
    ↓
Platform-specific:
  Windows: midiOutShortMsg(handle, msg)
  macOS:   MIDISend(..., &packet)
  Linux:   snd_rawmidi_write(handle, bytes)
    ↓
OS MIDI subsystem → Hardware/Software Synthesizer
```

### Receiving MIDI (Input)
```
Hardware/Software Synthesizer → OS MIDI subsystem
    ↓
Platform-specific:
  Windows: midiInCallback(...)
  macOS:   MIDIReadProc(...)
  Linux:   snd_rawmidi_read(...)
    ↓
OnUmpInput(NAPI) → Parse UMP packet
    ↓
InputNativeMIDIDevice.#handleUmpPacket()
    ↓
Emit 'noteon' / 'noteoff' / 'controlchange' etc.
    ↓
TypeScript Event Listeners
    ↓
Application Code
```

## Memory Management

### Device Storage
```cpp
static std::vector<MIDIDevice> midiOutputs;  // Persist across calls
static std::vector<MIDIDevice> midiInputs;

struct MIDIDevice {
  uint32_t index;         // Device index
  char name[256];         // UTF-8 device name
  int isInput;            // 0=output, 1=input
  void* handle;           // Platform-specific handle
};
```

### Handle Management
```cpp
// Windows
HMIDIOUT handle;          // MIDI output handle (auto-closed on close)
HMIDIIN handle;           // MIDI input handle

// macOS
MIDIEndpointRef handle;   // Reference to endpoint (not owned)

// Linux
snd_rawmidi_t* handle;    // Pointer to raw MIDI (must free)
```

### Cleanup
```cpp
// Windows
midiOutClose(handle);
midiInClose(handle);

// macOS
// Endpoints are system-managed, no cleanup needed

// Linux
snd_rawmidi_close(handle);
```

## Building

### Windows
```batch
node-gyp configure --msvs_version=2022
node-gyp build
```

### macOS
```bash
node-gyp configure
node-gyp build
```

### Linux
```bash
node-gyp configure
node-gyp build
```

## Testing C++ Code

### Direct Compilation Test
```cpp
// In native/test.cc
#include "midi2-native.cc"

int main() {
  #ifdef _WIN32
    WindowsMIDIManager::enumerateOutputs();
  #endif
  return 0;
}
```

### Runtime Test
```javascript
const midi = require('./build/Release/midi2-native.node')
const outputs = midi.getUmpOutputs()
console.log(outputs)
```

## Extending for MIDI 2.0

### Current: 32-bit UMP
```cpp
uint32_t packet;  // Status | Data1 | Data2 | Unused
```

### Future: 64-bit UMP (2 days)
```cpp
// Extend packet structure
struct MIDIPacket64 {
  uint32_t header;  // Format + Message type
  uint32_t data;    // Extended data
};

// Update send function
napi_value SendUmp64(napi_env env, napi_callback_info info) {
  // Handle 64-bit packets
}
```

## Performance Optimization Tips

1. **Batch Operations**: Send multiple messages in one call
2. **Avoid Allocations**: Pre-allocate device lists
3. **Non-blocking I/O**: Use async callbacks (macOS, Linux)
4. **Event-Driven**: Don't poll for input
5. **Platform Awareness**: Use platform-native batching when available

## Common Issues & Solutions

### Undefined Reference (Windows)
```
error LNK2001: unresolved external symbol midiOutGetNumDevs
```
**Solution**: Check `binding.gyp` has `"winmm.lib"` in libraries

### CoreMIDI Linking (macOS)
```
ld: framework not found CoreMIDI
```
**Solution**: Check binding.gyp has CoreMIDI in xcode_settings

### ALSA Linking (Linux)
```
/usr/bin/ld: cannot find -lasound
```
**Solution**: Install `libasound2-dev`

## References

- [Node.js N-API Documentation](https://nodejs.org/api/n_api.html)
- [Windows MM API Reference](https://docs.microsoft.com/en-us/windows/win32/multimedia/midi)
- [macOS CoreMIDI Reference](https://developer.apple.com/documentation/coremidi)
- [Linux ALSA Reference](https://www.alsa-project.org/alsa-doc/alsa-lib/modules.html)
- [node-addon-api](https://github.com/nodejs/node-addon-api)

---

**For MIDI 2.0 updates**: See this file's MIDI 2.0 section when spec is available.
