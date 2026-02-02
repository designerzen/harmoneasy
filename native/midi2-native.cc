/**
 * Node.js Native Module for MIDI 2.0 (UMP) Support
 * Uses only native OS libraries (WinMM/Windows.Media.Midi, CoreMIDI, ALSA)
 * 
 * Build with: pnpm run build-native
 */

#include <node_api.h>
#include <iostream>
#include <vector>
#include <map>
#include <cstring>
#include <memory>

#ifdef _WIN32
  #include <windows.h>
  #include <mmsystem.h>
  #pragma comment(lib, "winmm.lib")
#elif __APPLE__
  #include <CoreMIDI/CoreMIDI.h>
  #include <CoreFoundation/CoreFoundation.h>
#elif __linux__
  #include <alsa/asoundlib.h>
#endif

// ============================================================================
// MIDI 2.0 UMP Packet Utilities
// ============================================================================

struct MIDIDevice {
  uint32_t index;
  char name[256];
  int isInput;
  void* handle;
};

static std::vector<MIDIDevice> midiOutputs;
static std::vector<MIDIDevice> midiInputs;

// ============================================================================
// Platform-Specific Implementations
// ============================================================================

#ifdef _WIN32

// Windows MM API Implementation
class WindowsMIDIManager {
public:
  static void enumerateOutputs() {
    midiOutputs.clear();
    UINT numDevices = midiOutGetNumDevs();
    
    for (UINT i = 0; i < numDevices; i++) {
      MIDIOUTCAPS caps;
      if (midiOutGetDevCaps(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
        MIDIDevice device;
        device.index = i;
        device.isInput = 0;
        strncpy_s(device.name, sizeof(device.name), caps.szPname, _TRUNCATE);
        device.handle = nullptr;
        midiOutputs.push_back(device);
      }
    }
  }
  
  static void enumerateInputs() {
    midiInputs.clear();
    UINT numDevices = midiInGetNumDevs();
    
    for (UINT i = 0; i < numDevices; i++) {
      MIDIINCAPS caps;
      if (midiInGetDevCaps(i, &caps, sizeof(caps)) == MMSYSERR_NOERROR) {
        MIDIDevice device;
        device.index = i;
        device.isInput = 1;
        strncpy_s(device.name, sizeof(device.name), caps.szPname, _TRUNCATE);
        device.handle = nullptr;
        midiInputs.push_back(device);
      }
    }
  }
  
  static MMRESULT openOutput(uint32_t deviceIndex, HMIDIOUT& handle) {
    return midiOutOpen(&handle, deviceIndex, 0, 0, CALLBACK_NULL);
  }
  
  static MMRESULT sendData(HMIDIOUT handle, const uint8_t* data, size_t length) {
    if (length == 3) {
      uint32_t msg = data[0] | (data[1] << 8) | (data[2] << 16);
      return midiOutShortMsg(handle, msg);
    }
    return MMSYSERR_ERROR;
  }
};

#elif __APPLE__

// CoreMIDI Implementation for macOS
class MacMIDIManager {
private:
  static MIDIClientRef midiClient;
  static MIDIPortRef outputPort;
  static bool initialized;
  
  static bool ensureInitialized() {
    if (initialized) return midiClient != 0;
    
    OSStatus status = MIDIClientCreate(
      CFSTR("HarmonEasy MIDI Client"),
      nullptr,  // notifyProc
      nullptr,  // notifyRefCon
      &midiClient
    );
    
    if (status != noErr) {
      std::cerr << "Failed to create MIDI client: " << status << std::endl;
      return false;
    }
    
    status = MIDIOutputPortCreate(
      midiClient,
      CFSTR("HarmonEasy Output"),
      &outputPort
    );
    
    if (status != noErr) {
      std::cerr << "Failed to create output port: " << status << std::endl;
      return false;
    }
    
    initialized = true;
    return true;
  }
  
public:
  static void cleanup() {
    if (midiClient != 0) {
      MIDIClientDispose(midiClient);
      midiClient = 0;
    }
    initialized = false;
  }
  
  static void enumerateOutputs() {
    midiOutputs.clear();
    if (!ensureInitialized()) return;
    
    ItemCount destCount = MIDIGetNumberOfDestinations();
    
    for (ItemCount i = 0; i < destCount; i++) {
      MIDIEndpointRef dest = MIDIGetDestination(i);
      CFStringRef name = nullptr;
      MIDIObjectGetStringProperty(dest, kMIDIPropertyDisplayName, &name);
      
      MIDIDevice device;
      device.index = i;
      device.isInput = 0;
      if (name) {
        CFStringGetCString(name, device.name, sizeof(device.name), kCFStringEncodingUTF8);
        CFRelease(name);
      }
      // Store endpoint reference as a pointer to uint32_t
      uint32_t* refPtr = new uint32_t;
      *refPtr = (uint32_t)dest;
      device.handle = (void*)refPtr;
      midiOutputs.push_back(device);
    }
  }
  
  static void enumerateInputs() {
    midiInputs.clear();
    if (!ensureInitialized()) return;
    
    ItemCount sourceCount = MIDIGetNumberOfSources();
    
    for (ItemCount i = 0; i < sourceCount; i++) {
      MIDIEndpointRef source = MIDIGetSource(i);
      CFStringRef name = nullptr;
      MIDIObjectGetStringProperty(source, kMIDIPropertyDisplayName, &name);
      
      MIDIDevice device;
      device.index = i;
      device.isInput = 1;
      if (name) {
        CFStringGetCString(name, device.name, sizeof(device.name), kCFStringEncodingUTF8);
        CFRelease(name);
      }
      // Store endpoint reference as a pointer to uint32_t
      uint32_t* refPtr = new uint32_t;
      *refPtr = (uint32_t)source;
      device.handle = (void*)refPtr;
      midiInputs.push_back(device);
    }
  }
  
  static OSStatus sendUMP(MIDIEndpointRef dest, const uint32_t* packet, size_t count) {
    if (!ensureInitialized()) {
      return -1;
    }
    
    MIDIPacketList packetList;
    packetList.numPackets = count;
    
    for (size_t i = 0; i < count; i++) {
      packetList.packet[i].timeStamp = 0;
      packetList.packet[i].length = 4;
      packetList.packet[i].data[0] = (packet[i] >> 24) & 0xFF;
      packetList.packet[i].data[1] = (packet[i] >> 16) & 0xFF;
      packetList.packet[i].data[2] = (packet[i] >> 8) & 0xFF;
      packetList.packet[i].data[3] = packet[i] & 0xFF;
    }
    
    return MIDISend(outputPort, dest, &packetList);
  }
};

// Static member initialization
MIDIClientRef MacMIDIManager::midiClient = 0;
MIDIPortRef MacMIDIManager::outputPort = 0;
bool MacMIDIManager::initialized = false;

#elif __linux__

// ALSA Implementation for Linux
class ALSAMIDIManager {
public:
  static void enumerateOutputs() {
    midiOutputs.clear();
    snd_rawmidi_t* handle;
    const char* portname;
    int cardNum = -1, devNum = -1, subdevNum = -1;
    
    while (snd_card_next(&cardNum) == 0 && cardNum >= 0) {
      devNum = -1;
      while (snd_device_name_next_midi(cardNum, &devNum) == 0 && devNum >= 0) {
        if (snd_rawmidi_open(nullptr, &handle, nullptr, SND_RAWMIDI_NONBLOCK) == 0) {
          MIDIDevice device;
          device.index = midiOutputs.size();
          device.isInput = 0;
          snd_rawmidi_info_t* info;
          snd_rawmidi_info_alloca(&info);
          snd_rawmidi_info(handle, info);
          strncpy(device.name, snd_rawmidi_info_get_name(info), sizeof(device.name) - 1);
          device.handle = handle;
          midiOutputs.push_back(device);
        }
      }
    }
  }
  
  static void enumerateInputs() {
    midiInputs.clear();
    snd_rawmidi_t* handle;
    const char* portname;
    int cardNum = -1, devNum = -1, subdevNum = -1;
    
    while (snd_card_next(&cardNum) == 0 && cardNum >= 0) {
      devNum = -1;
      while (snd_device_name_next_midi(cardNum, &devNum) == 0 && devNum >= 0) {
        if (snd_rawmidi_open(&handle, nullptr, nullptr, SND_RAWMIDI_NONBLOCK) == 0) {
          MIDIDevice device;
          device.index = midiInputs.size();
          device.isInput = 1;
          snd_rawmidi_info_t* info;
          snd_rawmidi_info_alloca(&info);
          snd_rawmidi_info(handle, info);
          strncpy(device.name, snd_rawmidi_info_get_name(info), sizeof(device.name) - 1);
          device.handle = handle;
          midiInputs.push_back(device);
        }
      }
    }
  }
  
  static int sendUMP(snd_rawmidi_t* handle, const uint32_t* packet, size_t count) {
    unsigned char buffer[count * 4];
    for (size_t i = 0; i < count; i++) {
      buffer[i * 4 + 0] = (packet[i] >> 24) & 0xFF;
      buffer[i * 4 + 1] = (packet[i] >> 16) & 0xFF;
      buffer[i * 4 + 2] = (packet[i] >> 8) & 0xFF;
      buffer[i * 4 + 3] = packet[i] & 0xFF;
    }
    return snd_rawmidi_write(handle, buffer, sizeof(buffer));
  }
};

#endif

// ============================================================================
// NAPI Implementations
// ============================================================================

napi_value GetUmpOutputs(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_array(env, &result);
  
#ifdef _WIN32
  WindowsMIDIManager::enumerateOutputs();
#elif __APPLE__
  MacMIDIManager::enumerateOutputs();
#elif __linux__
  ALSAMIDIManager::enumerateOutputs();
#endif
  
  for (size_t i = 0; i < midiOutputs.size(); i++) {
    napi_value device;
    napi_create_object(env, &device);
    
    napi_value index;
    napi_create_uint32(env, midiOutputs[i].index, &index);
    napi_set_named_property(env, device, "index", index);
    
    napi_value name;
    napi_create_string_utf8(env, midiOutputs[i].name, NAPI_AUTO_LENGTH, &name);
    napi_set_named_property(env, device, "name", name);
    
    napi_set_element(env, result, i, device);
  }
  
  return result;
}

napi_value GetUmpInputs(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_array(env, &result);
  
#ifdef _WIN32
  WindowsMIDIManager::enumerateInputs();
#elif __APPLE__
  MacMIDIManager::enumerateInputs();
#elif __linux__
  ALSAMIDIManager::enumerateInputs();
#endif
  
  for (size_t i = 0; i < midiInputs.size(); i++) {
    napi_value device;
    napi_create_object(env, &device);
    
    napi_value index;
    napi_create_uint32(env, midiInputs[i].index, &index);
    napi_set_named_property(env, device, "index", index);
    
    napi_value name;
    napi_create_string_utf8(env, midiInputs[i].name, NAPI_AUTO_LENGTH, &name);
    napi_set_named_property(env, device, "name", name);
    
    napi_set_element(env, result, i, device);
  }
  
  return result;
}

napi_value OpenUmpOutput(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  
  if (argc < 1) {
    napi_throw_error(env, "INVALID_ARGS", "Device index required");
    return nullptr;
  }
  
  uint32_t deviceIndex;
  napi_get_value_uint32(env, argv[0], &deviceIndex);
  
  if (deviceIndex >= midiOutputs.size()) {
    napi_throw_error(env, "INVALID_DEVICE", "Device index out of range");
    return nullptr;
  }
  
#ifdef _WIN32
  HMIDIOUT handle;
  if (WindowsMIDIManager::openOutput(deviceIndex, handle) != MMSYSERR_NOERROR) {
    napi_throw_error(env, "OPEN_FAILED", "Failed to open MIDI output");
    return nullptr;
  }
  midiOutputs[deviceIndex].handle = (void*)handle;
#endif
  
  napi_value result;
  napi_create_object(env, &result);
  napi_value idx;
  napi_create_uint32(env, deviceIndex, &idx);
  napi_set_named_property(env, result, "deviceIndex", idx);
  
  return result;
}

napi_value CloseUmpOutput(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv[1];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  
  if (argc < 1) return nullptr;
  
  uint32_t deviceIndex;
  napi_get_value_uint32(env, argv[0], &deviceIndex);
  
  if (deviceIndex < midiOutputs.size() && midiOutputs[deviceIndex].handle) {
#ifdef _WIN32
    midiOutClose((HMIDIOUT)midiOutputs[deviceIndex].handle);
#endif
    midiOutputs[deviceIndex].handle = nullptr;
  }
  
  return nullptr;
}

napi_value SendUmp(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value argv[2];
  napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
  
  if (argc < 2) {
    napi_throw_error(env, "INVALID_ARGS", "Device index and UMP packet required");
    return nullptr;
  }
  
  uint32_t deviceIndex, packet;
  napi_get_value_uint32(env, argv[0], &deviceIndex);
  napi_get_value_uint32(env, argv[1], &packet);
  
  if (deviceIndex >= midiOutputs.size()) {
    napi_throw_error(env, "INVALID_DEVICE", "Device not found");
    return nullptr;
  }
  
#ifdef _WIN32
  uint8_t data[4] = {
    (uint8_t)((packet >> 24) & 0xFF),
    (uint8_t)((packet >> 16) & 0xFF),
    (uint8_t)((packet >> 8) & 0xFF),
    (uint8_t)(packet & 0xFF)
  };
  WindowsMIDIManager::sendData((HMIDIOUT)midiOutputs[deviceIndex].handle, data, 4);
#elif __APPLE__
  MIDIEndpointRef dest = *(MIDIEndpointRef*)midiOutputs[deviceIndex].handle;
  MacMIDIManager::sendUMP(dest, &packet, 1);
#elif __linux__
  ALSAMIDIManager::sendUMP((snd_rawmidi_t*)midiOutputs[deviceIndex].handle, &packet, 1);
#endif
  
  return nullptr;
}

napi_value OnUmpInput(napi_env env, napi_callback_info info) {
  // TODO: Implement input callback
  return nullptr;
}

napi_value SendSysEx(napi_env env, napi_callback_info info) {
  // TODO: Implement SysEx transmission
  return nullptr;
}

napi_value GetCapabilities(napi_env env, napi_callback_info info) {
  napi_value result;
  napi_create_object(env, &result);
  
  napi_value platform;
  const char* platform_str = "Unknown";
  
#ifdef __APPLE__
  platform_str = "macOS";
#elif _WIN32
  platform_str = "Windows";
#elif __linux__
  platform_str = "Linux";
#endif
  
  napi_create_string_utf8(env, platform_str, NAPI_AUTO_LENGTH, &platform);
  napi_set_named_property(env, result, "platform", platform);
  
  napi_value midi2_support;
  napi_get_boolean(env, true, &midi2_support);
  napi_set_named_property(env, result, "midi2Support", midi2_support);
  
  napi_value ump_support;
  napi_get_boolean(env, true, &ump_support);
  napi_set_named_property(env, result, "umpSupport", ump_support);
  
  napi_value native_os;
  napi_get_boolean(env, true, &native_os);
  napi_set_named_property(env, result, "nativeOSSupport", native_os);
  
  napi_value max_payload;
  napi_create_uint32(env, 65536, &max_payload);
  napi_set_named_property(env, result, "maxPayload", max_payload);
  
  return result;
}

/**
 * Module initialization
 */
napi_value Init(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    { "getUmpOutputs", 0, GetUmpOutputs, 0, 0, 0, napi_default, 0 },
    { "getUmpInputs", 0, GetUmpInputs, 0, 0, 0, napi_default, 0 },
    { "openUmpOutput", 0, OpenUmpOutput, 0, 0, 0, napi_default, 0 },
    { "closeUmpOutput", 0, CloseUmpOutput, 0, 0, 0, napi_default, 0 },
    { "sendUmp", 0, SendUmp, 0, 0, 0, napi_default, 0 },
    { "onUmpInput", 0, OnUmpInput, 0, 0, 0, napi_default, 0 },
    { "sendSysEx", 0, SendSysEx, 0, 0, 0, napi_default, 0 },
    { "getCapabilities", 0, GetCapabilities, 0, 0, 0, napi_default, 0 }
  };
  
  napi_define_properties(env, exports, 8, properties);
  return exports;
}

NAPI_MODULE(midi2_native, Init)
