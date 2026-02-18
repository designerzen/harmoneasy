{
  "targets": [
    {
      "target_name": "midi2-native",
      "sources": ["native/midi2-native.cc"],
      "include_dirs": ["<!(node -p 'require(\"path\").dirname(require.resolve(\"node-addon-api\"))')"],
      "conditions": [
        ["OS == 'win'", {
          "libraries": ["winmm.lib"]
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
