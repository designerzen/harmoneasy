{
  "patcher": {
    "fileversion": 1,
    "appversion": {
      "major": 8,
      "minor": 6,
      "revision": 0,
      "architecture": "x64"
    },
    "rect": [
      0,
      0,
      660,
      520
    ],
    "boxes": [
      {
        "box": {
          "id": "title",
          "maxclass": "comment",
          "patching_rect": [
            20,
            10,
            600,
            40
          ],
          "text": "Harmoneasy Harmony \u2014 Max MIDI Effect. Start the local harmony bridge, then connect from Harmony \u2192 DAW connection. Save this patch as a Max MIDI Effect (.amxd).",
          "linecount": 2
        }
      },
      {
        "box": {
          "id": "udp",
          "maxclass": "newobj",
          "patching_rect": [
            20,
            70,
            145,
            22
          ],
          "text": "udpreceive 9125 @defer 1"
        }
      },
      {
        "box": {
          "id": "defer",
          "maxclass": "newobj",
          "patching_rect": [
            20,
            310,
            70,
            22
          ],
          "text": "deferlow"
        }
      },
      {
        "box": {
          "id": "js",
          "maxclass": "newobj",
          "patching_rect": [
            20,
            350,
            170,
            22
          ],
          "text": "js harmoneasy-live.js"
        }
      },
      {
        "box": {
          "id": "unpack",
          "maxclass": "newobj",
          "patching_rect": [
            20,
            390,
            100,
            22
          ],
          "text": "unpack i i i"
        }
      },
      {
        "box": {
          "id": "noteout",
          "maxclass": "newobj",
          "patching_rect": [
            20,
            440,
            70,
            22
          ],
          "text": "noteout"
        }
      },
      {
        "box": {
          "id": "print",
          "maxclass": "newobj",
          "patching_rect": [
            240,
            390,
            140,
            22
          ],
          "text": "print Harmoneasy"
        }
      },
      {
        "box": {
          "id": "load",
          "maxclass": "newobj",
          "patching_rect": [
            300,
            70,
            70,
            22
          ],
          "text": "live.thisdevice"
        }
      },
      {
        "box": {
          "id": "initdefer",
          "maxclass": "newobj",
          "patching_rect": [
            300,
            110,
            70,
            22
          ],
          "text": "deferlow"
        }
      },
      {
        "box": {
          "id": "init",
          "maxclass": "message",
          "patching_rect": [
            300,
            150,
            40,
            22
          ],
          "text": "init"
        }
      },
      {
        "box": {
          "id": "panic",
          "maxclass": "message",
          "patching_rect": [
            300,
            230,
            60,
            22
          ],
          "text": "release"
        }
      },
      {
        "box": {
          "id": "note",
          "maxclass": "comment",
          "patching_rect": [
            230,
            270,
            370,
            60
          ],
          "text": "One device per Live set. Named scales update Live Scale Mode and Push. Custom scales disable Scale Mode to avoid displaying an incorrect scale; chord MIDI still follows.",
          "linecount": 3
        }
      }
    ],
    "lines": [
      {
        "patchline": {
          "source": [
            "defer",
            0
          ],
          "destination": [
            "js",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "js",
            0
          ],
          "destination": [
            "unpack",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "load",
            0
          ],
          "destination": [
            "initdefer",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "initdefer",
            0
          ],
          "destination": [
            "init",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "init",
            0
          ],
          "destination": [
            "js",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "panic",
            0
          ],
          "destination": [
            "js",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "js",
            1
          ],
          "destination": [
            "print",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "unpack",
            0
          ],
          "destination": [
            "noteout",
            0
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "unpack",
            1
          ],
          "destination": [
            "noteout",
            1
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "unpack",
            2
          ],
          "destination": [
            "noteout",
            2
          ]
        }
      },
      {
        "patchline": {
          "source": [
            "udp",
            0
          ],
          "destination": [
            "defer",
            0
          ]
        }
      }
    ],
    "dependency_cache": [
      {
        "name": "harmoneasy-live.js",
        "type": "TEXT",
        "implicit": 1
      }
    ]
  }
}