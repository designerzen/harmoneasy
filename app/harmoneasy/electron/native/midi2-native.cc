// Native UMP transports: Windows MIDI Services and CoreMIDI MIDI 2.0.
// WinMM and ALSA byte transports remain explicit compatibility fallbacks.
#include <node_api.h>
#include <cstdint>
#include <string>
#include <vector>
#include <map>
#include <memory>
#include <atomic>
#include <thread>
#include <chrono>
#include <cstring>
#include <array>
#include <algorithm>
#include "ump-packet.h"
#ifdef _WIN32
#include <windows.h>
#include <mmsystem.h>
#include "windows-midi-services.h"
static wms::Backend windowsMidi;
#elif __APPLE__
#include <CoreMIDI/CoreMIDI.h>
#include <CoreFoundation/CoreFoundation.h>
#elif __linux__
#include <alsa/asoundlib.h>
#endif

struct Device { uint32_t index; std::string name; std::string address; uintptr_t endpoint = 0; bool midi2 = false; uint32_t purpose = 0; };
struct Input {
    uint32_t index;
    napi_threadsafe_function callback = nullptr;
    uintptr_t handle = 0;
    std::atomic<bool> running{false};
    std::thread reader;
    uint8_t status = 0, data[2] = {}, count = 0;
};
struct Message { uint32_t index; std::array<uint32_t, 4> words{}; size_t count; uint64_t timestamp = 0; };
static std::map<uint32_t, uintptr_t> outputs;
static std::map<uint32_t, std::unique_ptr<Input>> inputs;
#ifdef __APPLE__
static MIDIClientRef client = 0;
static MIDIPortRef outputPort = 0;
static bool initialize() {
    if (client) return true;
    if (MIDIClientCreate(CFSTR("Harmoneasy"), nullptr, nullptr, &client)) return false;
    if (MIDIOutputPortCreate(client, CFSTR("Harmoneasy Output"), &outputPort)) { MIDIClientDispose(client); client = 0; return false; }
    return true;
}
#endif
static napi_value fail(napi_env env, const char* code, const char* message) { napi_throw_error(env, code, message); return nullptr; }
static napi_value undefined(napi_env env) { napi_value result; napi_get_undefined(env, &result); return result; }
static bool uintValue(napi_env env, napi_value value, uint32_t& result) {
    napi_valuetype type; double number;
    if (napi_typeof(env, value, &type) != napi_ok || type != napi_number || napi_get_value_double(env, value, &number) != napi_ok || !(number >= 0 && number <= 4294967295.0)) return false;
    result = static_cast<uint32_t>(number);
    return number == result;
}
static std::vector<Device> enumerate(bool input) {
    std::vector<Device> devices;
#ifdef _WIN32
    if (windowsMidi.initialize()) {
        for (const auto& endpoint : windowsMidi.enumerate())
            devices.push_back({endpoint.index, endpoint.name, wms::utf8(endpoint.id), 0, endpoint.midi2, endpoint.purpose});
        return devices;
    }
    UINT count = input ? midiInGetNumDevs() : midiOutGetNumDevs();
    for (UINT i = 0; i < count; ++i) {
        char name[256] = {};
        if (input) { MIDIINCAPSA caps{}; if (midiInGetDevCapsA(i, &caps, sizeof(caps))) continue; strncpy_s(name, caps.szPname, _TRUNCATE); }
        else { MIDIOUTCAPSA caps{}; if (midiOutGetDevCapsA(i, &caps, sizeof(caps))) continue; strncpy_s(name, caps.szPname, _TRUNCATE); }
        devices.push_back({i, name, "", 0});
    }
#elif __APPLE__
    if (!initialize()) return devices;
    ItemCount count = input ? MIDIGetNumberOfSources() : MIDIGetNumberOfDestinations();
    for (ItemCount i = 0; i < count; ++i) {
        MIDIEndpointRef endpoint = input ? MIDIGetSource(i) : MIDIGetDestination(i);
        CFStringRef name = nullptr; char text[256] = {};
        MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &name);
        if (name) { CFStringGetCString(name, text, sizeof(text), kCFStringEncodingUTF8); CFRelease(name); }
        SInt32 protocol = 0, uniqueId = 0;
        MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyProtocolID, &protocol);
        MIDIObjectGetIntegerProperty(endpoint, kMIDIPropertyUniqueID, &uniqueId);
        devices.push_back({static_cast<uint32_t>(i), text, std::to_string(uniqueId), endpoint, protocol == kMIDIProtocol_2_0, 0});
    }
#elif __linux__
    int card = -1;
    while (snd_card_next(&card) >= 0 && card >= 0) {
        snd_ctl_t* ctl = nullptr;
        std::string hw = "hw:" + std::to_string(card);
        if (snd_ctl_open(&ctl, hw.c_str(), 0) < 0) continue;
        int device = -1;
        while (snd_ctl_rawmidi_next_device(ctl, &device) >= 0 && device >= 0) {
            snd_rawmidi_info_t* info; snd_rawmidi_info_alloca(&info);
            snd_rawmidi_info_set_device(info, device);
            snd_rawmidi_info_set_stream(info, input ? SND_RAWMIDI_STREAM_INPUT : SND_RAWMIDI_STREAM_OUTPUT);
            if (snd_ctl_rawmidi_info(ctl, info) < 0) continue;
            unsigned int count = snd_rawmidi_info_get_subdevices_count(info);
            for (unsigned int sub = 0; sub < count; ++sub) {
                snd_rawmidi_info_set_subdevice(info, sub);
                if (snd_ctl_rawmidi_info(ctl, info) < 0) continue;
                devices.push_back({static_cast<uint32_t>(devices.size()), snd_rawmidi_info_get_name(info), hw + "," + std::to_string(device) + "," + std::to_string(sub), 0});
            }
        }
        snd_ctl_close(ctl);
    }
#endif
    return devices;
}
static void deliver(napi_env env, napi_value callback, void*, void* data) {
    std::unique_ptr<Message> message(static_cast<Message*>(data));
    if (!env || !callback) return;
    napi_value args[3], words, word, receiver;
    napi_create_uint32(env, message->index, &args[0]);
    napi_create_array_with_length(env, message->count, &words);
    for (size_t i = 0; i < message->count; ++i) {
        napi_create_uint32(env, message->words[i], &word); napi_set_element(env, words, static_cast<uint32_t>(i), word);
    }
    args[1] = words;
    napi_create_double(env, static_cast<double>(message->timestamp), &args[2]);
    napi_get_undefined(env, &receiver);
    napi_call_function(env, receiver, callback, 3, args, nullptr);
}
static void emitUmp(Input* input, const uint32_t* words, size_t count, uint64_t timestamp = 0) {
    for (size_t offset = 0; offset < count;) {
        const size_t length = umpWordCount(words[offset]);
        if (offset + length > count) return;
        auto message = new Message{input->index, {}, length, timestamp};
        std::copy_n(words + offset, length, message->words.begin());
        if (napi_call_threadsafe_function(input->callback, message, napi_tsfn_nonblocking) != napi_ok) delete message;
        offset += length;
    }
}
static void emit(Input* input, uint8_t status, uint8_t a = 0, uint8_t b = 0) {
    uint32_t word = ((status >= 0xf0 ? 1u : 2u) << 28) | (uint32_t(status) << 16) | (uint32_t(a) << 8) | b;
    emitUmp(input, &word, 1);
}
// Decode byte streams without dropping running status or interleaved realtime.
static void receive(Input* input, uint8_t byte) {
    if (byte >= 0xf8) { emit(input, byte); return; }
    if (byte & 0x80) {
        input->count = 0; input->status = byte;
        if (byte == 0xf6) { emit(input, byte); input->status = 0; }
        if (byte == 0xf0 || byte == 0xf7 || byte == 0xf4 || byte == 0xf5) input->status = 0;
        return;
    }
    if (!input->status) return;
    input->data[input->count++] = byte;
    int length = (input->status >> 4 == 0xc || input->status >> 4 == 0xd || input->status == 0xf1 || input->status == 0xf3) ? 1 : 2;
    if (input->count == length) {
        emit(input, input->status, input->data[0], length == 2 ? input->data[1] : 0);
        input->count = 0;
        if (input->status >= 0xf0) input->status = 0;
    }
}
#ifdef _WIN32
static void CALLBACK inputCallback(HMIDIIN, UINT message, DWORD_PTR context, DWORD_PTR data, DWORD_PTR) {
    if (message == MIM_DATA || message == MIM_MOREDATA) emit(reinterpret_cast<Input*>(context), data & 255, (data >> 8) & 127, (data >> 16) & 127);
}

#endif
static void closeInput(uint32_t index) {
    auto found = inputs.find(index); if (found == inputs.end()) return;
    Input* input = found->second.get();
#ifdef _WIN32
    if (index >= 0x10000000) windowsMidi.close(index, true);
    else { midiInStop(reinterpret_cast<HMIDIIN>(input->handle)); midiInReset(reinterpret_cast<HMIDIIN>(input->handle)); midiInClose(reinterpret_cast<HMIDIIN>(input->handle)); }
#elif __APPLE__
    MIDIPortDispose(static_cast<MIDIPortRef>(input->handle));
#elif __linux__
    input->running = false; if (input->reader.joinable()) input->reader.join(); snd_rawmidi_close(reinterpret_cast<snd_rawmidi_t*>(input->handle));
#endif
    napi_release_threadsafe_function(input->callback, napi_tsfn_abort);
    inputs.erase(found);
}
static void closeOutput(uint32_t index) {
    auto found = outputs.find(index); if (found == outputs.end()) return;
#ifdef _WIN32
    if (index >= 0x10000000) windowsMidi.close(index, false);
    else { midiOutReset(reinterpret_cast<HMIDIOUT>(found->second)); midiOutClose(reinterpret_cast<HMIDIOUT>(found->second)); }
#elif __linux__
    snd_rawmidi_close(reinterpret_cast<snd_rawmidi_t*>(found->second));
#endif
    outputs.erase(found);
}
static napi_value list(napi_env env, napi_callback_info info, bool input) {
    size_t argc = 1; napi_value argv[1]; bool diagnostics = false;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc) napi_get_value_bool(env, argv[0], &diagnostics);
    napi_value array; napi_create_array(env, &array); uint32_t i = 0;
    for (const auto& device : enumerate(input)) {
        if (!diagnostics && (device.purpose == 500 || device.purpose == 510)) continue;
        napi_value object, index, name; napi_create_object(env, &object);
        napi_create_uint32(env, device.index, &index); napi_set_named_property(env, object, "index", index);
        napi_create_string_utf8(env, device.name.c_str(), NAPI_AUTO_LENGTH, &name); napi_set_named_property(env, object, "name", name);
        napi_value id, protocol, purpose;
        napi_create_string_utf8(env, device.address.c_str(), NAPI_AUTO_LENGTH, &id); napi_set_named_property(env, object, "id", id);
        napi_create_uint32(env, device.midi2 ? 2 : 1, &protocol); napi_set_named_property(env, object, "protocol", protocol);
        napi_create_uint32(env, device.purpose, &purpose); napi_set_named_property(env, object, "purpose", purpose);
        napi_set_element(env, array, i++, object);
    }
    return array;
}
static napi_value GetInputs(napi_env env, napi_callback_info info) { return list(env, info, true); }
static napi_value GetOutputs(napi_env env, napi_callback_info info) { return list(env, info, false); }
static napi_value Open(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2]; void* context;
    napi_get_cb_info(env, info, &argc, argv, nullptr, &context);
    bool input = context != nullptr; uint32_t index;
    if (argc < (input ? 2u : 1u) || !uintValue(env, argv[0], index)) return fail(env, "INVALID_ARGS", "Device index required");
    if (input ? inputs.count(index) != 0 : outputs.count(index) != 0) return undefined(env);
    auto devices = enumerate(input); Device* device = nullptr;
    for (auto& item : devices) if (item.index == index) device = &item;
    if (!device) return fail(env, "INVALID_DEVICE", "MIDI device not found");
    if (!input) {
        uintptr_t handle = 0;
#ifdef _WIN32
        if (index >= 0x10000000) {
            if (FAILED(windowsMidi.open(index, false))) return fail(env, "OPEN_FAILED", "Could not open Windows MIDI Services UMP output");
        } else { HMIDIOUT out; if (midiOutOpen(&out, index, 0, 0, CALLBACK_NULL)) return fail(env, "OPEN_FAILED", "Could not open MIDI output"); handle = reinterpret_cast<uintptr_t>(out); }
#elif __APPLE__
        handle = device->endpoint;
#elif __linux__
        snd_rawmidi_t* out; if (snd_rawmidi_open(nullptr, &out, device->address.c_str(), SND_RAWMIDI_NONBLOCK) < 0) return fail(env, "OPEN_FAILED", "Could not open MIDI output"); handle = reinterpret_cast<uintptr_t>(out);
#endif
        outputs[index] = handle; return undefined(env);
    }
    napi_valuetype type; napi_typeof(env, argv[1], &type);
    if (type != napi_function) return fail(env, "INVALID_ARGS", "Input callback required");
    auto port = std::make_unique<Input>(); port->index = index;
    napi_value name; napi_create_string_utf8(env, "Native MIDI input", NAPI_AUTO_LENGTH, &name);
    if (napi_create_threadsafe_function(env, argv[1], nullptr, name, 0, 1, nullptr, nullptr, nullptr, deliver, &port->callback) != napi_ok) return fail(env, "OPEN_FAILED", "Could not create input callback");
    napi_unref_threadsafe_function(env, port->callback);
    bool ok = false;
#ifdef _WIN32
    if (index >= 0x10000000) {
        Input* ptr = port.get();
        ok = SUCCEEDED(windowsMidi.open(index, true, [ptr](const uint32_t* words, size_t count, uint64_t time) { emitUmp(ptr, words, count, time); }));
    } else {
    HMIDIIN in;
    if (midiInOpen(&in, index, reinterpret_cast<DWORD_PTR>(inputCallback), reinterpret_cast<DWORD_PTR>(port.get()), CALLBACK_FUNCTION) == MMSYSERR_NOERROR) {
        port->handle = reinterpret_cast<uintptr_t>(in);
        ok = midiInStart(in) == MMSYSERR_NOERROR;
        if (!ok) midiInClose(in);
    }
    }
#elif __APPLE__
    MIDIPortRef in;
    Input* ptr = port.get();
    if (MIDIInputPortCreateWithProtocol(client, CFSTR("Harmoneasy UMP Input"), kMIDIProtocol_2_0, &in,
        ^(const MIDIEventList* events, void*) {
            const MIDIEventPacket* packet = &events->packet[0];
            for (UInt32 i = 0; i < events->numPackets; ++i) {
                emitUmp(ptr, packet->words, packet->wordCount, packet->timeStamp);
                packet = MIDIEventPacketNext(packet);
            }
        }) == noErr) {
        port->handle = in; ok = MIDIPortConnectSource(in, device->endpoint, nullptr) == noErr;
        if (!ok) MIDIPortDispose(in);
    }
#elif __linux__
    snd_rawmidi_t* in;
    if (snd_rawmidi_open(&in, nullptr, device->address.c_str(), SND_RAWMIDI_NONBLOCK) >= 0) {
        port->handle = reinterpret_cast<uintptr_t>(in); port->running = true; Input* ptr = port.get();
        port->reader = std::thread([ptr, in]() {
            uint8_t bytes[256];
            while (ptr->running) {
                int size = snd_rawmidi_read(in, bytes, sizeof(bytes));
                if (size > 0) for (int i = 0; i < size; ++i) receive(ptr, bytes[i]);
                else std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
        }); ok = true;
    }
#endif
    if (!ok) { napi_release_threadsafe_function(port->callback, napi_tsfn_abort); return fail(env, "OPEN_FAILED", "Could not open MIDI input"); }
    inputs[index] = std::move(port); return undefined(env);
}
static napi_value Close(napi_env env, napi_callback_info info) {
    size_t argc = 1; napi_value argv[1]; void* context; uint32_t index;
    napi_get_cb_info(env, info, &argc, argv, nullptr, &context);
    if (!argc || !uintValue(env, argv[0], index)) return fail(env, "INVALID_ARGS", "Invalid MIDI device index");
    if (context) closeInput(index); else closeOutput(index);
    return undefined(env);
}
static napi_value Send(napi_env env, napi_callback_info info) {
    size_t argc = 2; napi_value argv[2]; uint32_t index;
    napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr);
    if (argc < 2 || !uintValue(env, argv[0], index)) return fail(env, "INVALID_ARGS", "Device and UMP words required");
    auto found = outputs.find(index); if (found == outputs.end()) return fail(env, "DEVICE_NOT_OPEN", "MIDI output is not open");
    bool array; napi_is_array(env, argv[1], &array); uint32_t length = 0;
    if (!array || napi_get_array_length(env, argv[1], &length) != napi_ok || length < 1 || length > 4) return fail(env, "INVALID_UMP", "Expected one to four UMP words");
    uint32_t words[4] = {};
    for (uint32_t i = 0; i < length; ++i) { napi_value value; napi_get_element(env, argv[1], i, &value); if (!uintValue(env, value, words[i])) return fail(env, "INVALID_UMP", "UMP words must be unsigned 32-bit integers"); }
    if (length != umpWordCount(words[0])) return fail(env, "INVALID_UMP", "UMP message length does not match its type");
#ifdef _WIN32
    if (index >= 0x10000000) {
        HRESULT hr = windowsMidi.send(index, words, length);
        return SUCCEEDED(hr) ? undefined(env) : fail(env, "SEND_FAILED", "Windows MIDI Services rejected the UMP message");
    }
#elif __APPLE__
    MIDIEventList events;
    MIDIEventPacket* packet = MIDIEventListInit(&events, kMIDIProtocol_2_0);
    if (!MIDIEventListAdd(&events, sizeof(events), packet, 0, length, words)) return fail(env, "INVALID_UMP", "Could not create CoreMIDI event packet");
    OSStatus statusCode = MIDISendEventList(outputPort, static_cast<MIDIEndpointRef>(found->second), &events);
    return statusCode == noErr ? undefined(env) : fail(env, "SEND_FAILED", "CoreMIDI rejected the UMP message");
#endif
    uint32_t type = words[0] >> 28, group = (words[0] >> 24) & 15;
    uint8_t status = (words[0] >> 16) & 255, a = (words[0] >> 8) & 127, b = words[0] & 127;
    if (group) return fail(env, "UNSUPPORTED", "MIDI 1.0 transport supports only UMP group zero");
    if (type == 4 && length == 2) {
        switch (status >> 4) {
            case 8: b = words[1] >> 25; break;
            case 9: b = words[1] >> 25; if (!b) b = 1; break;
            case 10: case 11: b = words[1] >> 25; break;
            case 12:
                if (words[0] & 1) return fail(env, "UNSUPPORTED", "Banked UMP program changes require explicit bank select messages");
                a = (words[1] >> 24) & 127; break;
            case 13: a = words[1] >> 25; break;
            case 14: a = (words[1] >> 18) & 127; b = words[1] >> 25; break;
            default: return fail(env, "UNSUPPORTED", "This message requires a native MIDI 2.0 transport");
        }
    } else if (!((type == 1 || type == 2) && length == 1)) return fail(env, "INVALID_UMP", "Unsupported UMP type or length");
    if (status < 0x80 || (type == 1 && status < 0xf0) || (type != 1 && status >= 0xf0) || status == 0xf0 || status == 0xf7 || status == 0xf4 || status == 0xf5) return fail(env, "INVALID_UMP", "Invalid MIDI status");
    int size = status >= 0xf8 || status == 0xf6 ? 1 : (status >> 4 == 0xc || status >> 4 == 0xd || status == 0xf1 || status == 0xf3) ? 2 : 3;
    uint8_t bytes[3] = {status, a, b}; bool ok = false;
#ifdef _WIN32
    ok = midiOutShortMsg(reinterpret_cast<HMIDIOUT>(found->second), status | (uint32_t(a) << 8) | (uint32_t(b) << 16)) == MMSYSERR_NOERROR;
#elif __linux__
    ok = snd_rawmidi_write(reinterpret_cast<snd_rawmidi_t*>(found->second), bytes, size) == size;
#endif
    return ok ? undefined(env) : fail(env, "SEND_FAILED", "Failed to send MIDI message");
}
static napi_value Capabilities(napi_env env, napi_callback_info) {
    bool nativeUmp = false;
    const char* backend = "ALSA MIDI 1.0";
#ifdef _WIN32
    nativeUmp = windowsMidi.initialize(); backend = nativeUmp ? "Windows MIDI Services" : "WinMM MIDI 1.0";
#elif __APPLE__
    nativeUmp = initialize(); backend = "CoreMIDI UMP";
#endif
    napi_value object, yes, no, supported, name; napi_create_object(env, &object);
    napi_get_boolean(env, true, &yes); napi_get_boolean(env, false, &no); napi_get_boolean(env, nativeUmp, &supported);
    for (const char* key : {"midi2Support", "umpSupport", "perNoteCC", "sysexSupport"}) napi_set_named_property(env, object, key, supported);
#ifdef _WIN32
    napi_set_named_property(env, object, "windowsMIDIServices", supported);
#endif
    napi_set_named_property(env, object, "nativeOSSupport", yes);
    napi_set_named_property(env, object, "midi1Fallback", nativeUmp ? no : yes);
    napi_create_string_utf8(env, backend, NAPI_AUTO_LENGTH, &name); napi_set_named_property(env, object, "backend", name);
    return object;
}
static void cleanup(void*) {
    while (!inputs.empty()) closeInput(inputs.begin()->first);
    while (!outputs.empty()) closeOutput(outputs.begin()->first);
#ifdef _WIN32
    windowsMidi.shutdown();
#endif
#ifdef __APPLE__
    if (client) MIDIClientDispose(client); client = 0; outputPort = 0;
#endif
}
static napi_value Init(napi_env env, napi_value exports) {
    napi_property_descriptor properties[] = {
        {"getUmpInputs", nullptr, GetInputs, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getUmpOutputs", nullptr, GetOutputs, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"openUmpInput", nullptr, Open, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(1)},
        {"closeUmpInput", nullptr, Close, nullptr, nullptr, nullptr, napi_default, reinterpret_cast<void*>(1)},
        {"openUmpOutput", nullptr, Open, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"closeUmpOutput", nullptr, Close, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"sendUmp", nullptr, Send, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"getCapabilities", nullptr, Capabilities, nullptr, nullptr, nullptr, napi_default, nullptr}
    };
    napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties);
    napi_add_env_cleanup_hook(env, cleanup, nullptr);
    return exports;
}
NAPI_MODULE(midi2_native, Init)
