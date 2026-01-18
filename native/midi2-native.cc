/**
 * Node.js Native Module for MIDI 2.0 (UMP) Support
 * Uses libremidi and/or ni-midi2 C++ libraries
 * 
 * Build with: npm run build-native
 */

#include <node_api.h>
#include <iostream>
#include <vector>
#include <map>
#include <cstring>

// Platform-specific MIDI 2.0 headers would go here
// #include <midi/midi.h>  // For ni-midi2
// #include <libremidi/libremidi.hpp>  // For libremidi

// Native Node.js API functions
napi_value GetUmpOutputs(napi_env env, napi_callback_info info) {
	napi_value result;
	napi_create_array(env, &result);
	
	// TODO: Implement actual device enumeration
	// This would use libremidi or platform APIs (CoreMIDI, ALSA, Windows MIDI Services)
	
	return result;
}

napi_value GetUmpInputs(napi_env env, napi_callback_info info) {
	napi_value result;
	napi_create_array(env, &result);
	return result;
}

napi_value OpenUmpOutput(napi_env env, napi_callback_info info) {
	// TODO: Implement device opening
	return nullptr;
}

napi_value CloseUmpOutput(napi_env env, napi_callback_info info) {
	// TODO: Implement device closing
	return nullptr;
}

napi_value SendUmp(napi_env env, napi_callback_info info) {
	// TODO: Implement UMP packet transmission
	return nullptr;
}

napi_value OnUmpInput(napi_env env, napi_callback_info info) {
	// TODO: Implement input listener
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

	napi_value midi_ci_support;
	napi_get_boolean(env, true, &midi_ci_support);
	napi_set_named_property(env, result, "midiCiSupport", midi_ci_support);

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
