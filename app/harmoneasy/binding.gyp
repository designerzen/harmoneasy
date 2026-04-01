{
  "targets": [
    {
      "target_name": "midi2-native",
      "sources": ["electron/native/midi2-native.cc"],
      "include_dirs": ["<!(node -p 'require(\"path\").dirname(require.resolve(\"node-addon-api\"))')"],
      "conditions": [
        ["OS == 'win'", {
          "libraries": ["winmm.lib", "ole32.lib", "runtimeobject.lib"],
          "msvs_settings": {
            "VCCLCompilerTool": {
              "AdditionalOptions": ["/std:c++17", "/EHsc"],
              "PreprocessorDefinitions": ["_WIN32_WINNT=0x0A00", "NTDDI_WIN10_WIN11"]
            }
          }
        }],
        ["OS == 'mac'", {
          "xcode_settings": {
            "OTHER_LDFLAGS": ["-framework", "CoreMIDI", "-framework", "CoreFoundation"]
          }
        }],
        ["OS == 'linux'", {
          "libraries": ["-lasound"],
          "include_dirs": ["/usr/include", "/usr/include/alsa"],
          "cflags": ["<!@(pkg-config --cflags alsa 2>/dev/null || echo '-I/usr/include')"],
          "ldflags": ["<!@(pkg-config --libs alsa 2>/dev/null || echo '-L/usr/lib -lasound')"]
        }]
      ]
    }
  ]
}
