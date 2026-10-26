/* ================= DAWN — демо-трек =================
 * Открывается при запуске DAWN (кнопка ✚ — пустой трек). «test23» — DnB на 174.
 * Прошлые демо «Riddim 8/8» и «Bayati in 7/8» лежат в /home/nikita/Projects (seed/ → fs/ при deploy).
 */
export const DEMO = {
 "format": "dawn/2",
 "_about": "DAWN project (nikita.os). Times in beats (quarter notes); pitches are note names. Spec: docs/dawn-format.md",
 "name": "test23",
 "bpm": 174,
 "swing": 0,
 "mode": "song",
 "current": "break2",
 "channels": [
  {
   "id": "kick",
   "type": "sampler",
   "name": "Kick",
   "color": "#ff9ecf",
   "vol": 0.8,
   "pan": 0,
   "mixer": 1,
   "sample": "builtin:kick",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "snare",
   "type": "sampler",
   "name": "Snare",
   "color": "#c3a6ff",
   "vol": 0.8,
   "pan": 0,
   "mixer": 2,
   "sample": "builtin:snare",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "hat",
   "type": "sampler",
   "name": "Hat",
   "color": "#8fe8cf",
   "vol": 1.25,
   "pan": 0,
   "mixer": 3,
   "sample": "builtin:hat",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "grapefruit",
   "type": "grapefruit",
   "name": "Synth",
   "color": "#9fd3ff",
   "vol": 0.45,
   "pan": 0,
   "mixer": 5,
   "poly": 1,
   "params": {
    "preset": "Glass Pad",
    "ops": [
     {
      "wave": "sine",
      "ratio": 1,
      "fine": 0,
      "level": 1,
      "out": 1,
      "att": 0.1044,
      "dec": 1,
      "sus": 0.8,
      "rel": 1.6,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0,
      "env": {
       "vol": {
        "on": false,
        "sus": 2,
        "pts": [
         [
          0,
          0
         ],
         [
          0.01,
          1
         ],
         [
          0.3,
          0.6
         ],
         [
          0.6,
          0
         ]
        ]
       }
      }
     },
     {
      "wave": "sine",
      "ratio": 2,
      "fine": 0,
      "level": 0.6,
      "out": 0,
      "att": 1.2,
      "dec": 1,
      "sus": 0.7,
      "rel": 1.6,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 1.003,
      "fine": 0,
      "level": 1,
      "out": 1,
      "att": 0.9,
      "dec": 0.4,
      "sus": 0.8,
      "rel": 1.8,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 4,
      "fine": 0,
      "level": 0.4,
      "out": 0,
      "att": 1.5,
      "dec": 0.4,
      "sus": 0.6,
      "rel": 1.6,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     }
    ],
    "mod": {
     "m21": 0.25,
     "m31": 0,
     "m41": 0,
     "m32": 0,
     "m42": 0,
     "m43": 0.2,
     "m12": 0,
     "m13": 0,
     "m14": 0,
     "m23": 0,
     "m24": 0,
     "m34": 0
    },
    "cut": 7000,
    "res": 0.8,
    "fit": true
   }
  },
  {
   "id": "grapefruit2",
   "type": "grapefruit",
   "name": "Bass",
   "color": "#fff09e",
   "vol": 1.25,
   "pan": 0,
   "mixer": 6,
   "params": {
    "preset": "E-Piano",
    "ops": [
     {
      "wave": "square",
      "ratio": 1,
      "fine": 0,
      "level": 1,
      "out": 1,
      "att": 0.0155,
      "dec": 3,
      "sus": 0.8,
      "rel": 0.5,
      "pan": 0,
      "wsk": 0.1768,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0,
      "env": {
       "vol": {
        "on": false,
        "sus": 2,
        "pts": [
         [
          0,
          0
         ],
         [
          0.01,
          1
         ],
         [
          0.3,
          0.6
         ],
         [
          0.6,
          0
         ]
        ]
       }
      },
      "oct": -2
     },
     {
      "wave": "sine",
      "ratio": 0.5,
      "fine": 0,
      "level": 0.9,
      "out": 0,
      "att": 1.0936,
      "dec": 3,
      "sus": 0.844,
      "rel": 0.3,
      "pan": 0,
      "wsk": 0.0104,
      "wfold": 0,
      "wcrush": 0,
      "ac": -0.364,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 14,
      "fine": 0,
      "level": 0.6,
      "out": 0,
      "att": 0.003,
      "dec": 0.08,
      "sus": 0,
      "rel": 0.3,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 1,
      "fine": 0,
      "level": 1,
      "out": 0,
      "att": 0.003,
      "dec": 1.2,
      "sus": 0.2,
      "rel": 0.4,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     }
    ],
    "mod": {
     "m21": 0.4225,
     "m31": 0,
     "m41": 0,
     "m32": 0,
     "m42": 0,
     "m43": 0,
     "m12": 0,
     "m13": 0,
     "m14": 0,
     "m23": 0,
     "m24": 0,
     "m34": 0
    },
    "cut": 9000,
    "res": 0.7,
    "fit": true
   }
  },
  {
   "id": "open-hat",
   "type": "sampler",
   "name": "Open hat",
   "color": "#ffb3b3",
   "vol": 1.25,
   "pan": 0,
   "mixer": 7,
   "sample": "builtin:openhat",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "neuro-stab",
   "type": "grapefruit",
   "name": "Neuro stab",
   "color": "#ffb3b3",
   "vol": 0.904,
   "pan": 0,
   "mixer": 4,
   "poly": 1,
   "params": {
    "preset": "Bell",
    "ops": [
     {
      "wave": "sine",
      "ratio": 1,
      "fine": 0,
      "level": 1,
      "out": 1,
      "att": 0.003,
      "dec": 3,
      "sus": 0,
      "rel": 2,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0,
      "env": {
       "vol": {
        "on": false,
        "sus": 2,
        "pts": [
         [
          0,
          0
         ],
         [
          0.01,
          1
         ],
         [
          0.3,
          0.6
         ],
         [
          0.6,
          0
         ]
        ]
       }
      }
     },
     {
      "wave": "sine",
      "ratio": 3.5,
      "fine": 0,
      "level": 0.8,
      "out": 0,
      "att": 0.003,
      "dec": 2.2,
      "sus": 0,
      "rel": 0.3,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 1.0015,
      "fine": 0,
      "level": 1,
      "out": 0.5,
      "att": 0.003,
      "dec": 2.5,
      "sus": 0,
      "rel": 2,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 5.19,
      "fine": 0,
      "level": 0.6,
      "out": 0,
      "att": 0.003,
      "dec": 1,
      "sus": 0,
      "rel": 0.3,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     }
    ],
    "mod": {
     "m21": 0.5,
     "m31": 0,
     "m41": 0,
     "m32": 0,
     "m42": 0,
     "m43": 0.35,
     "m12": 0,
     "m13": 0,
     "m14": 0,
     "m23": 0,
     "m24": 0,
     "m34": 0
    },
    "cut": 14000,
    "res": 0.6
   }
  },
  {
   "id": "neuro",
   "type": "grapefruit",
   "name": "Neuro",
   "color": "#b8f59e",
   "vol": 0.3645,
   "pan": 0,
   "mixer": 8,
   "poly": 1,
   "params": {
    "preset": "Neuro Bass",
    "ops": [
     {
      "wave": "sine",
      "ratio": 1,
      "fine": 0,
      "level": 1,
      "out": 0,
      "att": 0.003,
      "dec": 0.4,
      "sus": 0.9,
      "rel": 0.1,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0,
      "env": {
       "vol": {
        "on": false,
        "sus": 2,
        "pts": [
         [
          0,
          0
         ],
         [
          0.01,
          1
         ],
         [
          0.3,
          0.6
         ],
         [
          0.6,
          0
         ]
        ]
       }
      }
     },
     {
      "wave": "sine",
      "ratio": 1,
      "fine": 0,
      "level": 1,
      "out": 0,
      "att": 0.003,
      "dec": 0.3,
      "sus": 0.8,
      "rel": 0.3,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 2,
      "fine": 0,
      "level": 0.7,
      "out": 0,
      "att": 0.01,
      "dec": 0.5,
      "sus": 0.6,
      "rel": 0.3,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     },
     {
      "wave": "sine",
      "ratio": 0.5,
      "fine": 0,
      "level": 1,
      "out": 1,
      "att": 0.003,
      "dec": 0.3,
      "sus": 1,
      "rel": 0.08,
      "pan": 0,
      "wsk": 0,
      "wfold": 0,
      "wcrush": 0,
      "ac": 0,
      "dc": 0,
      "rc": 0
     }
    ],
    "mod": {
     "m21": 0,
     "m31": 0,
     "m41": 0,
     "m32": 0,
     "m42": 0,
     "m43": 0,
     "m12": 0,
     "m13": 0,
     "m14": 0.2981,
     "m23": 0,
     "m24": 0,
     "m34": 0
    },
    "cut": 3200,
    "res": 3
   }
  },
  {
   "id": "acid",
   "type": "osc3",
   "name": "Acid",
   "color": "#ff9ecf",
   "vol": 1.25,
   "pan": 0,
   "mixer": 9,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -6,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 6,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0.6,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.005,
    "dec": 0.2,
    "sus": 0.9,
    "rel": 0.08,
    "cut": 400,
    "res": 12,
    "uni": 1,
    "udet": 20,
    "uspr": 0.6
   }
  },
  {
   "id": "acid-26",
   "type": "osc3",
   "name": "Wub D2.3 ✨",
   "color": "#9fd3ff",
   "vol": 1.25,
   "pan": 0,
   "mixer": 16,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0,
      "o_crs": 0,
      "o_fin": -6,
      "o_pan": -0.2
     },
     {
      "wave": "sine",
      "o_vol": 0.8944,
      "o_crs": -12,
      "o_fin": 6,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.0884,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.2926,
    "dec": 0.22,
    "sus": 1,
    "rel": 0.01,
    "cut": 1249,
    "res": 1.2,
    "uni": 1,
    "udet": 20,
    "uspr": 0.93,
    "fit": true
   }
  },
  {
   "id": "acid-25",
   "type": "osc3",
   "name": "Wub D2.2 ✨",
   "color": "#ffc59e",
   "vol": 1.25,
   "pan": 0,
   "mixer": 15,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "square",
      "o_vol": 0.16,
      "o_crs": 19,
      "o_fin": 12,
      "o_pan": -0.2
     },
     {
      "wave": "sine",
      "o_vol": 0.85,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.14,
      "o_crs": 12,
      "o_fin": -14,
      "o_pan": 0.2
     }
    ],
    "att": 0.03,
    "dec": 0.2,
    "sus": 1,
    "rel": 0.02,
    "cut": 5000,
    "res": 5,
    "uni": 1,
    "udet": 20,
    "uspr": 0.6,
    "fit": true
   }
  },
  {
   "id": "acid-24",
   "type": "osc3",
   "name": "Wub D2 ✨",
   "color": "#c3a6ff",
   "vol": 1.25,
   "pan": 0,
   "mixer": 14,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": -0.2
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.4,
      "o_crs": -12,
      "o_fin": 7,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.2,
      "o_crs": 12,
      "o_fin": -7,
      "o_pan": 0
     }
    ],
    "att": 0.03,
    "dec": 0.4,
    "sus": 0.8,
    "rel": 0.25,
    "cut": 3200,
    "res": 2,
    "uni": 7,
    "udet": 60,
    "uspr": 1,
    "fit": true
   }
  },
  {
   "id": "acid-23",
   "type": "osc3",
   "name": "Wub D1.3 ✨",
   "color": "#ff9ecf",
   "vol": 1.25,
   "pan": 0,
   "mixer": 13,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -14,
      "o_pan": -0.4
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": 14,
      "o_pan": 0.4
     },
     {
      "wave": "sine",
      "o_vol": 0.75,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.4009,
    "dec": 0.02,
    "sus": 1,
    "rel": 0.01,
    "cut": 900,
    "res": 4,
    "uni": 2,
    "udet": 18,
    "uspr": 0.8,
    "fit": true
   }
  },
  {
   "id": "acid-22",
   "type": "osc3",
   "name": "Wub D1.2 ✨",
   "color": "#b8f59e",
   "vol": 1.25,
   "pan": 0,
   "mixer": 12,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": -0.2
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.4,
      "o_crs": -12,
      "o_fin": 7,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.2,
      "o_crs": 12,
      "o_fin": -7,
      "o_pan": 0
     }
    ],
    "att": 0.03,
    "dec": 0.4,
    "sus": 0.8,
    "rel": 0.25,
    "cut": 3200,
    "res": 2,
    "uni": 7,
    "udet": 60,
    "uspr": 1,
    "fit": true
   }
  },
  {
   "id": "acid-2",
   "type": "osc3",
   "name": "Swap ✨",
   "color": "#ffb3b3",
   "vol": 1.25,
   "pan": 0,
   "mixer": 11,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": -0.2
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.4,
      "o_crs": -12,
      "o_fin": 7,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.2,
      "o_crs": 12,
      "o_fin": -7,
      "o_pan": 0
     }
    ],
    "att": 0.03,
    "dec": 0.4,
    "sus": 0.8,
    "rel": 0.25,
    "cut": 3200,
    "res": 2,
    "uni": 7,
    "udet": 60,
    "uspr": 1,
    "fit": true
   }
  },
  {
   "id": "lead",
   "type": "osc3",
   "name": "Lead ✨",
   "color": "#c3a6ff",
   "vol": 0.8835,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "square",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.25,
      "o_crs": 12,
      "o_fin": 3,
      "o_pan": 0
     },
     {
      "wave": "triangle",
      "o_vol": 0.3,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.002,
    "dec": 0.1,
    "sus": 0.6,
    "rel": 0.08,
    "cut": 9000,
    "res": 0.7,
    "uni": 1,
    "udet": 20,
    "uspr": 0.6,
    "fit": true
   }
  },
  {
   "id": "lead-metal-crush",
   "type": "osc3",
   "name": "Lead ✨ ⇄ Metal Crush",
   "color": "#8fe8cf",
   "vol": 0.2105,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0,
      "o_crs": 0,
      "o_fin": -6,
      "o_pan": -0.2
     },
     {
      "wave": "sine",
      "o_vol": 0.8944,
      "o_crs": -12,
      "o_fin": 6,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.0884,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.2926,
    "dec": 0.22,
    "sus": 1,
    "rel": 0.01,
    "cut": 1249,
    "res": 1.2,
    "uni": 1,
    "udet": 20,
    "uspr": 0.93,
    "fit": true
   }
  },
  {
   "id": "sub-acid",
   "type": "osc3",
   "name": "Sub · Acid",
   "color": "#ffc59e",
   "vol": 1.229,
   "pan": 0,
   "mixer": 10,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "square",
      "o_vol": 1,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.7884,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.004,
    "dec": 0.2,
    "sus": 1,
    "rel": 0.07,
    "cut": 380,
    "res": 0.7,
    "uni": 1,
    "udet": 0,
    "uspr": 0.6
   }
  },
  {
   "id": "acid-metal-screa",
   "type": "grapefruit",
   "name": "Acid ⇄ Metal Scream FM",
   "color": "#ff9ecf",
   "vol": 1.25,
   "pan": 0,
   "mixer": 0,
   "poly": 1,
   "params": {
    "preset": "Metal Scream FM",
    "ops": [
     {
      "wave": "square",
      "ratio": 0.5,
      "fine": 0,
      "level": 1,
      "out": 0.75,
      "att": 0.02,
      "dec": 0.4,
      "sus": 1,
      "rel": 0.02,
      "env": {
       "fold": {
        "on": true,
        "sus": 2,
        "pts": [
         [
          0,
          0.05
         ],
         [
          0.4,
          0.35
         ],
         [
          0.55,
          0.6
         ],
         [
          0.65,
          0
         ]
        ]
       }
      }
     },
     {
      "wave": "sine",
      "ratio": 0.5,
      "fine": 0,
      "level": 1,
      "out": 0.5,
      "att": 0.003,
      "dec": 0.4,
      "sus": 1,
      "rel": 0.02
     },
     {
      "wave": "sine",
      "ratio": 3,
      "fine": 0,
      "level": 0.8,
      "out": 0,
      "att": 0.003,
      "dec": 0.4,
      "sus": 0.6,
      "rel": 0.3,
      "env": {
       "vol": {
        "on": true,
        "sus": 2,
        "pts": [
         [
          0,
          0.05
         ],
         [
          0.45,
          1
         ],
         [
          0.6,
          0
         ]
        ]
       }
      }
     },
     {
      "wave": "sine",
      "ratio": 1,
      "fine": 0,
      "level": 0,
      "out": 0,
      "att": 0.003,
      "dec": 0.4,
      "sus": 0.6,
      "rel": 0.3
     }
    ],
    "mod": {
     "m21": 0,
     "m31": 0.5,
     "m41": 0,
     "m32": 0,
     "m42": 0,
     "m43": 0
    },
    "cut": 3800,
    "res": 2,
    "fit": true
   }
  },
  {
   "id": "arp",
   "type": "osc3",
   "name": "Arp ✨",
   "color": "#fff09e",
   "vol": 0.5,
   "pan": 0,
   "mixer": 17,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": -8,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.4,
      "o_crs": 0,
      "o_fin": 8,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0.4,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.002,
    "dec": 0.22,
    "sus": 0,
    "rel": 0.25,
    "cut": 4500,
    "res": 3,
    "uni": 3,
    "udet": 15,
    "uspr": 0.7
   }
  },
  {
   "id": "riser",
   "type": "osc3",
   "name": "Riser ✨",
   "color": "#ffb3b3",
   "vol": 0.45,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "noise",
      "o_vol": 0.7,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.15,
      "o_crs": 12,
      "o_fin": 7,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 4,
    "dec": 0.5,
    "sus": 1,
    "rel": 0.4,
    "cut": 600,
    "res": 6,
    "uni": 1,
    "udet": 20,
    "uspr": 0.6
   }
  },
  {
   "id": "tom",
   "type": "sampler",
   "name": "Tom",
   "color": "#b8f59e",
   "vol": 0.8,
   "pan": 0,
   "mixer": 0,
   "sample": "builtin:tom",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "shaker",
   "type": "sampler",
   "name": "Shaker",
   "color": "#9fd3ff",
   "vol": 0.8,
   "pan": 0,
   "mixer": 0,
   "sample": "builtin:shaker",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "ride",
   "type": "sampler",
   "name": "Ride",
   "color": "#b8f59e",
   "vol": 0.8,
   "pan": 0,
   "mixer": 0,
   "sample": "builtin:ride",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "lead2",
   "type": "osc3",
   "name": "Lead ✨",
   "color": "#ff9ecf",
   "vol": 0.5,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": -8,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.4,
      "o_crs": 0,
      "o_fin": 8,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0.4,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.002,
    "dec": 0.22,
    "sus": 0,
    "rel": 0.25,
    "cut": 4500,
    "res": 3,
    "uni": 3,
    "udet": 15,
    "uspr": 0.7,
    "fit": true
   }
  },
  {
   "id": "lead-26",
   "type": "osc3",
   "name": "Wub D2.3 ✨",
   "color": "#fff09e",
   "vol": 0.7145,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.754,
      "o_crs": 12,
      "o_fin": -6,
      "o_pan": -0.2
     },
     {
      "wave": "sine",
      "o_vol": 0.8944,
      "o_crs": -12,
      "o_fin": 6,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.8424,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.2926,
    "dec": 0.22,
    "sus": 1,
    "rel": 0.419,
    "cut": 1249,
    "res": 1.2,
    "uni": 3,
    "udet": 27.28,
    "uspr": 0.93,
    "fit": true
   }
  },
  {
   "id": "lead-25",
   "type": "osc3",
   "name": "Wub D2.2 ✨",
   "color": "#9fd3ff",
   "vol": 0.6755,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "square",
      "o_vol": 0.16,
      "o_crs": 19,
      "o_fin": 12,
      "o_pan": -0.2
     },
     {
      "wave": "sine",
      "o_vol": 0.85,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.14,
      "o_crs": 12,
      "o_fin": -14,
      "o_pan": 0.2
     }
    ],
    "att": 0.03,
    "dec": 0.2,
    "sus": 1,
    "rel": 0.02,
    "cut": 5000,
    "res": 5,
    "uni": 1,
    "udet": 15,
    "uspr": 0.7,
    "fit": true
   }
  },
  {
   "id": "lead-24",
   "type": "osc3",
   "name": "Wub D2 ✨",
   "color": "#ffc59e",
   "vol": 0.7925,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "square",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -14,
      "o_pan": -0.4
     },
     {
      "wave": "square",
      "o_vol": 0.8548,
      "o_crs": 12,
      "o_fin": 14,
      "o_pan": 0.4
     },
     {
      "wave": "sine",
      "o_vol": 0.75,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.01,
    "dec": 0.3,
    "sus": 0.9,
    "rel": 0.12,
    "cut": 900,
    "res": 4,
    "uni": 2,
    "udet": 18,
    "uspr": 0.8,
    "fit": true
   }
  },
  {
   "id": "lead-23",
   "type": "osc3",
   "name": "Wub D1.3 ✨",
   "color": "#8fe8cf",
   "vol": 0.5,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -6,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 6,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0.6,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.005,
    "dec": 0.2,
    "sus": 0.9,
    "rel": 0.08,
    "cut": 400,
    "res": 12,
    "uni": 1,
    "udet": 15,
    "uspr": 0.7,
    "fit": true
   }
  },
  {
   "id": "lead-22",
   "type": "osc3",
   "name": "Wub D1.2 ✨",
   "color": "#c3a6ff",
   "vol": 0.5,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -14,
      "o_pan": -0.4
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": 14,
      "o_pan": 0.4
     },
     {
      "wave": "sine",
      "o_vol": 0.75,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.01,
    "dec": 0.3,
    "sus": 0.9,
    "rel": 0.12,
    "cut": 900,
    "res": 4,
    "uni": 2,
    "udet": 18,
    "uspr": 0.8,
    "fit": true
   }
  },
  {
   "id": "lead-2",
   "type": "osc3",
   "name": "Swap ✨",
   "color": "#ff9ecf",
   "vol": 1.1045,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.55,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.766,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.2,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.01,
    "dec": 0.3,
    "sus": 0.75,
    "rel": 0.3,
    "cut": 7500,
    "res": 1,
    "uni": 7,
    "udet": 35,
    "uspr": 0.9,
    "fit": true
   }
  },
  {
   "id": "lead-grind-fifth",
   "type": "osc3",
   "name": "Lead ✨ ⇄ Grind Fifth",
   "color": "#c3a6ff",
   "vol": 0.425,
   "pan": 0,
   "mixer": 0,
   "params": {
    "oscs": [
     {
      "wave": "square",
      "o_vol": 0.16,
      "o_crs": 19,
      "o_fin": 12,
      "o_pan": -0.2
     },
     {
      "wave": "sine",
      "o_vol": 0.85,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.14,
      "o_crs": 12,
      "o_fin": -14,
      "o_pan": 0.2
     }
    ],
    "att": 0.03,
    "dec": 0.2,
    "sus": 1,
    "rel": 0.02,
    "cut": 5000,
    "res": 5,
    "uni": 1,
    "udet": 20,
    "uspr": 0.6,
    "fit": true
   }
  },
  {
   "id": "ride2",
   "type": "sampler",
   "name": "Ride",
   "color": "#ff9ecf",
   "vol": 0.2085,
   "pan": 0,
   "mixer": 0,
   "sample": "builtin:ride",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "crash",
   "type": "sampler",
   "name": "Crash",
   "color": "#c3a6ff",
   "vol": 0.6765,
   "pan": 0,
   "mixer": 0,
   "sample": "builtin:crash",
   "params": {
    "root": 60,
    "tune": 0,
    "start": 0,
    "att": 0.001,
    "rel": 0.08,
    "oneshot": true,
    "rev": false
   }
  },
  {
   "id": "juicy",
   "type": "osc3",
   "name": "Juicy Lead",
   "color": "#ffc6e0",
   "vol": 0.42,
   "pan": 0,
   "mixer": 17,
   "poly": 4,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": -11,
      "o_pan": -0.3
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": 11,
      "o_pan": 0.3
     },
     {
      "wave": "square",
      "o_vol": 0.22,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.008,
    "dec": 0.35,
    "sus": 0.65,
    "rel": 0.35,
    "cut": 6500,
    "res": 2.2,
    "uni": 5,
    "udet": 24,
    "uspr": 0.9
   }
  }
 ],
 "patterns": [
  {
   "id": "impact2",
   "name": "✨ Impact",
   "color": "#fff09e",
   "sig": "4/4",
   "length": 1,
   "notes": {
    "kick": [
     [
      0,
      0.5,
      "C4",
      1
     ]
    ],
    "open-hat": [
     [
      0,
      1,
      "C4",
      0.9
     ]
    ],
    "snare": [
     [
      0,
      0.5,
      "C4",
      1
     ]
    ]
   }
  },
  {
   "id": "break2",
   "name": "✨ Break",
   "color": "#ffd59e",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.22
     ],
     [
      0.25,
      0.25,
      "C4",
      0.22
     ],
     [
      0.5,
      0.25,
      "C4",
      0.45
     ],
     [
      0.75,
      0.25,
      "C4",
      0.22
     ],
     [
      1,
      0.25,
      "C4",
      0.22
     ],
     [
      1.25,
      0.25,
      "C4",
      0.22
     ],
     [
      1.5,
      0.25,
      "C4",
      0.45
     ],
     [
      1.75,
      0.25,
      "C4",
      0.22
     ],
     [
      2,
      0.25,
      "C4",
      0.22
     ],
     [
      2.25,
      0.25,
      "C4",
      0.22
     ],
     [
      2.5,
      0.25,
      "C4",
      0.45
     ],
     [
      2.75,
      0.25,
      "C4",
      0.22
     ],
     [
      3,
      0.25,
      "C4",
      0.22
     ],
     [
      3.25,
      0.25,
      "C4",
      0.22
     ],
     [
      3.5,
      0.25,
      "C4",
      0.45
     ],
     [
      3.75,
      0.25,
      "C4",
      0.22
     ],
     [
      4,
      0.25,
      "C4",
      0.22
     ],
     [
      4.25,
      0.25,
      "C4",
      0.22
     ],
     [
      4.5,
      0.25,
      "C4",
      0.45
     ],
     [
      4.75,
      0.25,
      "C4",
      0.22
     ],
     [
      5,
      0.25,
      "C4",
      0.22
     ],
     [
      5.25,
      0.25,
      "C4",
      0.22
     ],
     [
      5.5,
      0.25,
      "C4",
      0.45
     ],
     [
      5.75,
      0.25,
      "C4",
      0.22
     ],
     [
      6,
      0.25,
      "C4",
      0.22
     ],
     [
      6.25,
      0.25,
      "C4",
      0.22
     ],
     [
      6.5,
      0.25,
      "C4",
      0.45
     ],
     [
      6.75,
      0.25,
      "C4",
      0.22
     ],
     [
      7,
      0.25,
      "C4",
      0.22
     ],
     [
      7.25,
      0.25,
      "C4",
      0.22
     ],
     [
      7.5,
      0.25,
      "C4",
      0.45
     ],
     [
      7.75,
      0.25,
      "C4",
      0.22
     ],
     [
      8,
      0.25,
      "C4",
      0.22
     ],
     [
      8.25,
      0.25,
      "C4",
      0.22
     ],
     [
      8.5,
      0.25,
      "C4",
      0.45
     ],
     [
      8.75,
      0.25,
      "C4",
      0.22
     ],
     [
      9,
      0.25,
      "C4",
      0.22
     ],
     [
      9.25,
      0.25,
      "C4",
      0.22
     ],
     [
      9.5,
      0.25,
      "C4",
      0.45
     ],
     [
      9.75,
      0.25,
      "C4",
      0.22
     ],
     [
      10,
      0.25,
      "C4",
      0.22
     ],
     [
      10.25,
      0.25,
      "C4",
      0.22
     ],
     [
      10.5,
      0.25,
      "C4",
      0.45
     ],
     [
      10.75,
      0.25,
      "C4",
      0.22
     ],
     [
      11,
      0.25,
      "C4",
      0.22
     ],
     [
      11.25,
      0.25,
      "C4",
      0.22
     ],
     [
      11.5,
      0.25,
      "C4",
      0.45
     ],
     [
      11.75,
      0.25,
      "C4",
      0.22
     ],
     [
      12,
      0.25,
      "C4",
      0.22
     ],
     [
      12.25,
      0.25,
      "C4",
      0.22
     ],
     [
      12.5,
      0.25,
      "C4",
      0.45
     ],
     [
      12.75,
      0.25,
      "C4",
      0.22
     ],
     [
      13,
      0.25,
      "C4",
      0.22
     ],
     [
      13.25,
      0.25,
      "C4",
      0.22
     ],
     [
      13.5,
      0.25,
      "C4",
      0.45
     ],
     [
      13.75,
      0.25,
      "C4",
      0.22
     ],
     [
      14,
      0.25,
      "C4",
      0.22
     ],
     [
      14.25,
      0.25,
      "C4",
      0.22
     ],
     [
      14.5,
      0.25,
      "C4",
      0.45
     ],
     [
      14.75,
      0.25,
      "C4",
      0.22
     ],
     [
      15,
      0.25,
      "C4",
      0.22
     ],
     [
      15.25,
      0.25,
      "C4",
      0.22
     ],
     [
      15.5,
      0.25,
      "C4",
      0.45
     ],
     [
      15.75,
      0.25,
      "C4",
      0.22
     ]
    ],
    "sub-acid": [
     [
      0,
      3,
      "C2",
      0.9
     ],
     [
      4.5,
      3,
      "D#2",
      0.9
     ],
     [
      8,
      3,
      "G#1",
      0.9
     ],
     [
      12.5,
      3.25,
      "B1",
      0.9
     ]
    ]
   }
  },
  {
   "id": "build-22",
   "name": "✨ Build 2",
   "color": "#ffb3b3",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "snare": [
     [
      2,
      0.2,
      "C4",
      0.487
     ],
     [
      6,
      0.2,
      "C4",
      0.563
     ],
     [
      9,
      0.2,
      "C4",
      0.694
     ],
     [
      9.25,
      0.2,
      "C4",
      0.705
     ],
     [
      9.5,
      0.2,
      "C4",
      0.716
     ],
     [
      9.75,
      0.2,
      "C4",
      0.727
     ],
     [
      10,
      0.2,
      "C4",
      0.738
     ],
     [
      10.25,
      0.2,
      "C4",
      0.748
     ],
     [
      10.5,
      0.2,
      "C4",
      0.759
     ],
     [
      10.75,
      0.2,
      "C4",
      0.77
     ],
     [
      11,
      0.2,
      "C4",
      0.781
     ],
     [
      11.25,
      0.2,
      "C4",
      0.792
     ],
     [
      11.5,
      0.2,
      "C4",
      0.803
     ],
     [
      11.75,
      0.2,
      "C4",
      0.814
     ],
     [
      12,
      0.1,
      "C4",
      0.825
     ],
     [
      12.125,
      0.1,
      "C4",
      0.83
     ],
     [
      12.25,
      0.1,
      "C4",
      0.836
     ],
     [
      12.375,
      0.1,
      "C4",
      0.841
     ],
     [
      12.5,
      0.1,
      "C4",
      0.847
     ],
     [
      12.625,
      0.1,
      "C4",
      0.852
     ],
     [
      12.75,
      0.1,
      "C4",
      0.858
     ],
     [
      12.875,
      0.1,
      "C4",
      0.863
     ],
     [
      13,
      0.1,
      "C4",
      0.869
     ],
     [
      13.125,
      0.1,
      "C4",
      0.874
     ],
     [
      13.25,
      0.1,
      "C4",
      0.88
     ],
     [
      13.375,
      0.1,
      "C4",
      0.885
     ],
     [
      13.5,
      0.1,
      "C4",
      0.891
     ],
     [
      13.625,
      0.1,
      "C4",
      0.896
     ],
     [
      13.75,
      0.1,
      "C4",
      0.902
     ],
     [
      13.875,
      0.1,
      "C4",
      0.907
     ],
     [
      14,
      0.1,
      "C4",
      0.912
     ],
     [
      14.125,
      0.1,
      "C4",
      0.918
     ],
     [
      14.25,
      0.1,
      "C4",
      0.923
     ],
     [
      14.375,
      0.1,
      "C4",
      0.929
     ],
     [
      14.5,
      0.1,
      "C4",
      0.934
     ],
     [
      14.625,
      0.1,
      "C4",
      0.94
     ],
     [
      14.75,
      0.1,
      "C4",
      0.945
     ],
     [
      14.875,
      0.1,
      "C4",
      0.951
     ],
     [
      15,
      0.1,
      "C4",
      0.956
     ],
     [
      15.125,
      0.1,
      "C4",
      0.962
     ],
     [
      15.25,
      0.1,
      "C4",
      0.967
     ],
     [
      15.375,
      0.1,
      "C4",
      0.973
     ]
    ],
    "kick": [
     [
      0,
      0.25,
      "C4",
      0.7
     ],
     [
      1,
      0.25,
      "C4",
      0.719
     ],
     [
      2,
      0.25,
      "C4",
      0.737
     ],
     [
      3,
      0.25,
      "C4",
      0.756
     ],
     [
      4,
      0.25,
      "C4",
      0.775
     ],
     [
      5,
      0.25,
      "C4",
      0.794
     ],
     [
      6,
      0.25,
      "C4",
      0.813
     ],
     [
      7,
      0.25,
      "C4",
      0.831
     ],
     [
      8,
      0.25,
      "C4",
      0.85
     ],
     [
      9,
      0.25,
      "C4",
      0.869
     ],
     [
      10,
      0.25,
      "C4",
      0.887
     ],
     [
      11,
      0.25,
      "C4",
      0.906
     ],
     [
      12,
      0.25,
      "C4",
      0.925
     ],
     [
      13,
      0.25,
      "C4",
      0.944
     ],
     [
      14,
      0.25,
      "C4",
      0.962
     ],
     [
      15,
      0.25,
      "C4",
      0.981
     ]
    ],
    "hat": [
     [
      0,
      0.2,
      "C4",
      0.35
     ],
     [
      0.5,
      0.2,
      "C4",
      0.359
     ],
     [
      1,
      0.2,
      "C4",
      0.369
     ],
     [
      1.5,
      0.2,
      "C4",
      0.378
     ],
     [
      2,
      0.2,
      "C4",
      0.387
     ],
     [
      2.5,
      0.2,
      "C4",
      0.397
     ],
     [
      3,
      0.2,
      "C4",
      0.406
     ],
     [
      3.5,
      0.2,
      "C4",
      0.416
     ],
     [
      4,
      0.2,
      "C4",
      0.425
     ],
     [
      4.5,
      0.2,
      "C4",
      0.434
     ],
     [
      5,
      0.2,
      "C4",
      0.444
     ],
     [
      5.5,
      0.2,
      "C4",
      0.453
     ],
     [
      6,
      0.2,
      "C4",
      0.462
     ],
     [
      6.5,
      0.2,
      "C4",
      0.472
     ],
     [
      7,
      0.2,
      "C4",
      0.481
     ],
     [
      7.5,
      0.2,
      "C4",
      0.491
     ],
     [
      8,
      0.2,
      "C4",
      0.5
     ],
     [
      8.5,
      0.2,
      "C4",
      0.509
     ],
     [
      9,
      0.2,
      "C4",
      0.519
     ],
     [
      9.5,
      0.2,
      "C4",
      0.528
     ],
     [
      10,
      0.2,
      "C4",
      0.537
     ],
     [
      10.5,
      0.2,
      "C4",
      0.547
     ],
     [
      11,
      0.2,
      "C4",
      0.556
     ],
     [
      11.5,
      0.2,
      "C4",
      0.566
     ],
     [
      12,
      0.2,
      "C4",
      0.575
     ],
     [
      12.5,
      0.2,
      "C4",
      0.584
     ],
     [
      13,
      0.2,
      "C4",
      0.594
     ],
     [
      13.5,
      0.2,
      "C4",
      0.603
     ],
     [
      14,
      0.2,
      "C4",
      0.613
     ],
     [
      14.5,
      0.2,
      "C4",
      0.622
     ],
     [
      15,
      0.2,
      "C4",
      0.631
     ]
    ],
    "riser": [
     [
      0,
      15.5,
      "C4",
      0.8
     ]
    ]
   }
  },
  {
   "id": "drop-d2-var2",
   "name": "✨ Drop D2 var",
   "color": "#8fe8cf",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.22
     ],
     [
      0.25,
      0.25,
      "C4",
      0.22
     ],
     [
      0.5,
      0.25,
      "C4",
      0.45
     ],
     [
      0.75,
      0.25,
      "C4",
      0.22
     ],
     [
      1,
      0.25,
      "C4",
      0.22
     ],
     [
      1.25,
      0.25,
      "C4",
      0.22
     ],
     [
      1.5,
      0.25,
      "C4",
      0.45
     ],
     [
      1.75,
      0.25,
      "C4",
      0.22
     ],
     [
      2,
      0.25,
      "C4",
      0.22
     ],
     [
      2.25,
      0.25,
      "C4",
      0.22
     ],
     [
      2.5,
      0.25,
      "C4",
      0.45
     ],
     [
      2.75,
      0.25,
      "C4",
      0.22
     ],
     [
      3,
      0.25,
      "C4",
      0.22
     ],
     [
      3.25,
      0.25,
      "C4",
      0.22
     ],
     [
      3.5,
      0.25,
      "C4",
      0.45
     ],
     [
      3.75,
      0.25,
      "C4",
      0.22
     ],
     [
      4,
      0.25,
      "C4",
      0.22
     ],
     [
      4.25,
      0.25,
      "C4",
      0.22
     ],
     [
      4.5,
      0.25,
      "C4",
      0.45
     ],
     [
      4.75,
      0.25,
      "C4",
      0.22
     ],
     [
      5,
      0.25,
      "C4",
      0.22
     ],
     [
      5.25,
      0.25,
      "C4",
      0.22
     ],
     [
      5.5,
      0.25,
      "C4",
      0.45
     ],
     [
      5.75,
      0.25,
      "C4",
      0.22
     ],
     [
      6,
      0.25,
      "C4",
      0.22
     ],
     [
      6.25,
      0.25,
      "C4",
      0.22
     ],
     [
      6.5,
      0.25,
      "C4",
      0.45
     ],
     [
      6.75,
      0.25,
      "C4",
      0.22
     ],
     [
      7,
      0.25,
      "C4",
      0.22
     ],
     [
      7.25,
      0.25,
      "C4",
      0.22
     ],
     [
      7.5,
      0.25,
      "C4",
      0.45
     ],
     [
      7.75,
      0.25,
      "C4",
      0.22
     ],
     [
      8,
      0.25,
      "C4",
      0.22
     ],
     [
      8.25,
      0.25,
      "C4",
      0.22
     ],
     [
      8.5,
      0.25,
      "C4",
      0.45
     ],
     [
      8.75,
      0.25,
      "C4",
      0.22
     ],
     [
      9,
      0.25,
      "C4",
      0.22
     ],
     [
      9.25,
      0.25,
      "C4",
      0.22
     ],
     [
      9.5,
      0.25,
      "C4",
      0.45
     ],
     [
      9.75,
      0.25,
      "C4",
      0.22
     ],
     [
      10,
      0.25,
      "C4",
      0.22
     ],
     [
      10.25,
      0.25,
      "C4",
      0.22
     ],
     [
      10.5,
      0.25,
      "C4",
      0.45
     ],
     [
      10.75,
      0.25,
      "C4",
      0.22
     ],
     [
      11,
      0.25,
      "C4",
      0.22
     ],
     [
      11.25,
      0.25,
      "C4",
      0.22
     ],
     [
      11.5,
      0.25,
      "C4",
      0.45
     ],
     [
      11.75,
      0.25,
      "C4",
      0.22
     ],
     [
      12,
      0.25,
      "C4",
      0.22
     ],
     [
      12.25,
      0.25,
      "C4",
      0.22
     ],
     [
      12.5,
      0.25,
      "C4",
      0.45
     ],
     [
      12.75,
      0.25,
      "C4",
      0.22
     ],
     [
      13,
      0.25,
      "C4",
      0.22
     ],
     [
      13.25,
      0.25,
      "C4",
      0.22
     ],
     [
      13.5,
      0.25,
      "C4",
      0.45
     ],
     [
      13.75,
      0.25,
      "C4",
      0.22
     ],
     [
      14,
      0.25,
      "C4",
      0.22
     ],
     [
      14.25,
      0.25,
      "C4",
      0.22
     ],
     [
      14.5,
      0.25,
      "C4",
      0.45
     ],
     [
      14.75,
      0.25,
      "C4",
      0.22
     ],
     [
      15,
      0.25,
      "C4",
      0.22
     ],
     [
      15.25,
      0.25,
      "C4",
      0.22
     ],
     [
      15.5,
      0.25,
      "C4",
      0.45
     ],
     [
      15.75,
      0.25,
      "C4",
      0.22
     ]
    ],
    "sub-acid": [
     [
      0,
      3.8,
      "C1",
      0.9
     ],
     [
      4,
      3.8,
      "D#2",
      0.9
     ],
     [
      8,
      3.8,
      "G#1",
      0.9
     ],
     [
      12,
      3.8,
      "B1",
      0.9
     ]
    ],
    "snare": [
     [
      4,
      0.25,
      "C4",
      0.85
     ],
     [
      8,
      0.25,
      "C4",
      0.85
     ],
     [
      12,
      0.25,
      "C4",
      0.85
     ]
    ],
    "ride": [
     [
      0,
      0.25,
      "C4",
      0.35
     ],
     [
      1,
      0.25,
      "C4",
      0.35
     ],
     [
      2,
      0.25,
      "C4",
      0.35
     ],
     [
      3,
      0.25,
      "C4",
      0.35
     ],
     [
      4,
      0.25,
      "C4",
      0.35
     ],
     [
      5,
      0.25,
      "C4",
      0.35
     ],
     [
      6,
      0.25,
      "C4",
      0.35
     ],
     [
      7,
      0.25,
      "C4",
      0.35
     ],
     [
      8,
      0.25,
      "C4",
      0.35
     ],
     [
      9,
      0.25,
      "C4",
      0.35
     ],
     [
      10,
      0.25,
      "C4",
      0.35
     ],
     [
      11,
      0.25,
      "C4",
      0.35
     ],
     [
      12,
      0.25,
      "C4",
      0.35
     ],
     [
      13,
      0.25,
      "C4",
      0.35
     ],
     [
      14,
      0.25,
      "C4",
      0.35
     ],
     [
      15,
      0.25,
      "C4",
      0.35
     ]
    ],
    "lead-grind-fifth": [
     [
      8,
      0.1568,
      "D#5",
      0.568
     ],
     [
      9.75,
      0.225,
      "D#7",
      0.558
     ],
     [
      12.5,
      0.5,
      "G#6",
      0.496
     ],
     [
      14,
      0.225,
      "C6",
      0.571
     ],
     [
      14.25,
      1.225,
      "D6",
      0.485,
      0,
      8
     ]
    ],
    "lead-24": [
     [
      0,
      0.225,
      "C4",
      0.588
     ],
     [
      0.25,
      0.225,
      "D#4",
      0.694
     ],
     [
      0.5,
      0.1568,
      "G4",
      0.7,
      0,
      2.1111
     ],
     [
      1,
      0.0743,
      "C4",
      0.799
     ],
     [
      1.25,
      0.0743,
      "D#4",
      0.604
     ],
     [
      1.5,
      0.225,
      "G5",
      0.64
     ],
     [
      1.75,
      0.225,
      "C6",
      0.74
     ],
     [
      2,
      0.225,
      "C4",
      0.743
     ],
     [
      2.25,
      0.225,
      "D#4",
      0.662
     ],
     [
      2.5,
      0.225,
      "G4",
      0.559
     ],
     [
      2.75,
      0.225,
      "C6",
      0.849
     ],
     [
      3,
      0.225,
      "C4",
      0.842
     ],
     [
      3.25,
      0.1125,
      "D#4",
      0.648
     ],
     [
      3.5,
      0.225,
      "G4",
      0.767
     ],
     [
      4,
      0.225,
      "D#5",
      0.754
     ],
     [
      4.25,
      0.225,
      "G5",
      0.665
     ],
     [
      4.5,
      0.0743,
      "A#4",
      0.598
     ],
     [
      4.75,
      0.0743,
      "D#5",
      0.808
     ],
     [
      5.25,
      0.225,
      "G4",
      0.755
     ],
     [
      5.5,
      0.1125,
      "A#5",
      0.752
     ],
     [
      5.75,
      0.225,
      "D#5",
      0.551
     ],
     [
      6,
      0.475,
      "D#4",
      0.668,
      0,
      2.1111
     ],
     [
      6.5,
      0.725,
      "A#4",
      0.55,
      0,
      3.2222
     ],
     [
      7.25,
      0.1125,
      "G4",
      0.85
     ],
     [
      7.5,
      0.225,
      "A#5",
      0.63
     ],
     [
      7.75,
      0.225,
      "D#6",
      0.657
     ],
     [
      8.25,
      0.225,
      "C6",
      0.875
     ],
     [
      8.5,
      0.225,
      "D#5",
      0.553
     ],
     [
      9,
      0.6375,
      "G#4",
      0.576
     ],
     [
      9.75,
      0.6375,
      "D#5",
      0.574
     ],
     [
      10.5,
      0.1,
      "G#5",
      0.644
     ],
     [
      10.625,
      0.1,
      "G#5",
      0.454
     ],
     [
      10.75,
      0.1,
      "G#5",
      0.597
     ],
     [
      10.875,
      0.1,
      "G#5",
      0.464
     ],
     [
      11,
      0.1,
      "G#5",
      0.562
     ],
     [
      11.125,
      0.1,
      "G#5",
      0.442
     ],
     [
      11.25,
      0.1,
      "G#5",
      0.556
     ],
     [
      11.375,
      0.1,
      "G#5",
      0.417
     ],
     [
      11.5,
      0.1,
      "G#5",
      0.529
     ],
     [
      11.625,
      0.1,
      "G#5",
      0.39
     ],
     [
      11.75,
      0.1,
      "G#5",
      0.565
     ],
     [
      11.875,
      0.0125,
      "G#5",
      0.393
     ],
     [
      12,
      0.225,
      "B4",
      0.672
     ],
     [
      12.25,
      0.0743,
      "D5",
      0.571
     ],
     [
      13,
      0.225,
      "B4",
      0.828
     ],
     [
      13.25,
      0.225,
      "D5",
      0.663
     ],
     [
      13.5,
      0.1125,
      "F#5",
      0.567
     ],
     [
      13.75,
      0.225,
      "B5",
      0.766
     ],
     [
      14.25,
      0.725,
      "D5",
      0.721,
      0,
      3.2222
     ],
     [
      15,
      0.225,
      "B5",
      0.701
     ],
     [
      15.5,
      0.225,
      "F#5",
      0.701
     ],
     [
      15.75,
      0.225,
      "B5",
      0.848
     ]
    ]
   }
  },
  {
   "id": "drop-d2-sauce2",
   "name": "✨ Drop D2 sauce",
   "color": "#ffc6e0",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.22
     ],
     [
      0.25,
      0.25,
      "C4",
      0.22
     ],
     [
      0.5,
      0.25,
      "C4",
      0.45
     ],
     [
      0.75,
      0.25,
      "C4",
      0.22
     ],
     [
      1,
      0.25,
      "C4",
      0.22
     ],
     [
      1.25,
      0.25,
      "C4",
      0.22
     ],
     [
      1.5,
      0.25,
      "C4",
      0.45
     ],
     [
      1.75,
      0.25,
      "C4",
      0.22
     ],
     [
      2,
      0.25,
      "C4",
      0.22
     ],
     [
      2.25,
      0.25,
      "C4",
      0.22
     ],
     [
      2.5,
      0.25,
      "C4",
      0.45
     ],
     [
      2.75,
      0.25,
      "C4",
      0.22
     ],
     [
      3,
      0.25,
      "C4",
      0.22
     ],
     [
      3.25,
      0.25,
      "C4",
      0.22
     ],
     [
      3.5,
      0.25,
      "C4",
      0.45
     ],
     [
      3.75,
      0.25,
      "C4",
      0.22
     ],
     [
      4,
      0.25,
      "C4",
      0.22
     ],
     [
      4.25,
      0.25,
      "C4",
      0.22
     ],
     [
      4.5,
      0.25,
      "C4",
      0.45
     ],
     [
      4.75,
      0.25,
      "C4",
      0.22
     ],
     [
      5,
      0.25,
      "C4",
      0.22
     ],
     [
      5.25,
      0.25,
      "C4",
      0.22
     ],
     [
      5.5,
      0.25,
      "C4",
      0.45
     ],
     [
      5.75,
      0.25,
      "C4",
      0.22
     ],
     [
      6,
      0.25,
      "C4",
      0.22
     ],
     [
      6.25,
      0.25,
      "C4",
      0.22
     ],
     [
      6.5,
      0.25,
      "C4",
      0.45
     ],
     [
      6.75,
      0.25,
      "C4",
      0.22
     ],
     [
      7,
      0.25,
      "C4",
      0.22
     ],
     [
      7.25,
      0.25,
      "C4",
      0.22
     ],
     [
      7.5,
      0.25,
      "C4",
      0.45
     ],
     [
      7.75,
      0.25,
      "C4",
      0.22
     ],
     [
      8,
      0.25,
      "C4",
      0.22
     ],
     [
      8.25,
      0.25,
      "C4",
      0.22
     ],
     [
      8.5,
      0.25,
      "C4",
      0.45
     ],
     [
      8.75,
      0.25,
      "C4",
      0.22
     ],
     [
      9,
      0.25,
      "C4",
      0.22
     ],
     [
      9.25,
      0.25,
      "C4",
      0.22
     ],
     [
      9.5,
      0.25,
      "C4",
      0.45
     ],
     [
      9.75,
      0.25,
      "C4",
      0.22
     ],
     [
      10,
      0.25,
      "C4",
      0.22
     ],
     [
      10.25,
      0.25,
      "C4",
      0.22
     ],
     [
      10.5,
      0.25,
      "C4",
      0.45
     ],
     [
      10.75,
      0.25,
      "C4",
      0.22
     ],
     [
      11,
      0.25,
      "C4",
      0.22
     ],
     [
      11.25,
      0.25,
      "C4",
      0.22
     ],
     [
      11.5,
      0.25,
      "C4",
      0.45
     ],
     [
      11.75,
      0.25,
      "C4",
      0.22
     ],
     [
      12,
      0.25,
      "C4",
      0.22
     ],
     [
      12.25,
      0.25,
      "C4",
      0.22
     ],
     [
      12.5,
      0.25,
      "C4",
      0.45
     ],
     [
      12.75,
      0.25,
      "C4",
      0.22
     ],
     [
      13,
      0.25,
      "C4",
      0.22
     ],
     [
      13.25,
      0.25,
      "C4",
      0.22
     ],
     [
      13.5,
      0.25,
      "C4",
      0.45
     ],
     [
      13.75,
      0.25,
      "C4",
      0.22
     ],
     [
      14,
      0.25,
      "C4",
      0.22
     ],
     [
      14.25,
      0.25,
      "C4",
      0.22
     ],
     [
      14.5,
      0.25,
      "C4",
      0.45
     ],
     [
      14.75,
      0.25,
      "C4",
      0.22
     ],
     [
      15,
      0.25,
      "C4",
      0.22
     ],
     [
      15.25,
      0.25,
      "C4",
      0.22
     ],
     [
      15.5,
      0.25,
      "C4",
      0.45
     ],
     [
      15.75,
      0.25,
      "C4",
      0.22
     ]
    ],
    "sub-acid": [
     [
      0,
      3.8,
      "C1",
      0.9
     ],
     [
      4,
      3.8,
      "D#1",
      0.9
     ],
     [
      8,
      3.8,
      "G#1",
      0.9
     ],
     [
      12,
      3.8,
      "B1",
      0.9
     ]
    ],
    "snare": [
     [
      4,
      0.25,
      "C4",
      0.85
     ],
     [
      8,
      0.25,
      "C4",
      0.85
     ],
     [
      12,
      0.25,
      "C4",
      0.85
     ]
    ],
    "ride": [
     [
      0,
      0.25,
      "C4",
      0.35
     ],
     [
      1,
      0.25,
      "C4",
      0.35
     ],
     [
      2,
      0.25,
      "C4",
      0.35
     ],
     [
      3,
      0.25,
      "C4",
      0.35
     ],
     [
      4,
      0.25,
      "C4",
      0.35
     ],
     [
      5,
      0.25,
      "C4",
      0.35
     ],
     [
      6,
      0.25,
      "C4",
      0.35
     ],
     [
      7,
      0.25,
      "C4",
      0.35
     ],
     [
      8,
      0.25,
      "C4",
      0.35
     ],
     [
      9,
      0.25,
      "C4",
      0.35
     ],
     [
      10,
      0.25,
      "C4",
      0.35
     ],
     [
      11,
      0.25,
      "C4",
      0.35
     ],
     [
      12,
      0.25,
      "C4",
      0.35
     ],
     [
      13,
      0.25,
      "C4",
      0.35
     ],
     [
      14,
      0.25,
      "C4",
      0.35
     ],
     [
      15,
      0.25,
      "C4",
      0.35
     ]
    ],
    "lead-grind-fifth": [
     [
      8,
      0.1568,
      "D#5",
      0.568
     ],
     [
      9.75,
      0.225,
      "D#7",
      0.558
     ],
     [
      12.5,
      0.5,
      "G#6",
      0.496
     ],
     [
      14,
      0.225,
      "C6",
      0.571
     ],
     [
      14.25,
      1.225,
      "D6",
      0.485,
      0,
      8
     ]
    ],
    "lead-24": [
     [
      0,
      0.0743,
      "C4",
      0.588
     ],
     [
      0.25,
      0.1125,
      "D#4",
      0.694
     ],
     [
      0.5,
      0.1568,
      "G4",
      0.7,
      0,
      2.1111
     ],
     [
      1,
      0.225,
      "C4",
      0.799
     ],
     [
      1.25,
      0.0743,
      "D#4",
      0.604
     ],
     [
      1.5,
      0.225,
      "G5",
      0.64
     ],
     [
      1.75,
      0.0743,
      "C6",
      0.74
     ],
     [
      2,
      0.225,
      "C4",
      0.743
     ],
     [
      2.25,
      0.225,
      "D#4",
      0.662
     ],
     [
      2.5,
      0.225,
      "G4",
      0.559
     ],
     [
      2.75,
      0.225,
      "C7",
      0.899
     ],
     [
      3,
      0.1125,
      "C5",
      0.892
     ],
     [
      3.25,
      0.1125,
      "D#4",
      0.648
     ],
     [
      3.5,
      0.225,
      "G5",
      0.817
     ],
     [
      4,
      0.225,
      "D#6",
      0.804
     ],
     [
      4.25,
      0.0743,
      "G5",
      0.665
     ],
     [
      4.5,
      0.475,
      "A#5",
      0.648,
      0,
      2.1111
     ],
     [
      5,
      0.1593,
      "G4",
      0.755
     ],
     [
      5.375,
      0.3187,
      "A#5",
      0.752
     ],
     [
      5.75,
      0.1875,
      "D#5",
      0.551
     ],
     [
      6.125,
      0.3187,
      "D#4",
      0.668,
      0,
      2.1111
     ],
     [
      6.5,
      0.725,
      "A#4",
      0.55,
      0,
      3.2222
     ],
     [
      7.25,
      0.1125,
      "G5",
      0.9
     ],
     [
      7.5,
      0.225,
      "A#7",
      0.73
     ],
     [
      7.75,
      0.0743,
      "D#7",
      0.707
     ],
     [
      8.25,
      0.475,
      "C7",
      0.925,
      0,
      2.1111
     ],
     [
      9,
      0.6375,
      "G#4",
      0.576
     ],
     [
      9.75,
      0.2104,
      "D#5",
      0.574
     ],
     [
      10.5,
      1.3875,
      "G#5",
      0.584,
      0,
      3.7
     ],
     [
      12,
      0.225,
      "B4",
      0.672
     ],
     [
      12.25,
      0.0743,
      "D5",
      0.571
     ],
     [
      13,
      0.225,
      "B5",
      0.878
     ],
     [
      13.25,
      0.3625,
      "D5",
      0.663,
      0,
      1.6111
     ],
     [
      13.75,
      0.225,
      "B5",
      0.766
     ],
     [
      14.25,
      0.1,
      "D5",
      0.808
     ],
     [
      14.375,
      0.1,
      "D5",
      0.573
     ],
     [
      14.5,
      0.1,
      "D5",
      0.769
     ],
     [
      14.625,
      0.1,
      "D5",
      0.522
     ],
     [
      14.75,
      0.1,
      "D5",
      0.722
     ],
     [
      14.875,
      0.1,
      "D5",
      0.494
     ],
     [
      15,
      0.725,
      "B6",
      0.751,
      0,
      3.2222
     ],
     [
      15.75,
      0.225,
      "B7",
      0.948
     ]
    ]
   }
  },
  {
   "id": "drop-d2-2-срыв-в2",
   "name": "✨ Drop D2.2 · Срыв в другой синт",
   "color": "#fff09e",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "sub-acid": [
     [
      0,
      3.8,
      "C1",
      0.9
     ],
     [
      4,
      3.8,
      "D#1",
      0.9
     ],
     [
      8,
      3.8,
      "G#1",
      0.9
     ],
     [
      12,
      3.8,
      "B1",
      0.9
     ]
    ],
    "lead-grind-fifth": [
     [
      8,
      0.1568,
      "D#5",
      0.568
     ],
     [
      9.75,
      0.225,
      "D#7",
      0.558
     ],
     [
      12.5,
      0.5,
      "G#6",
      0.496
     ],
     [
      14,
      0.225,
      "C6",
      0.571
     ],
     [
      14.25,
      1.225,
      "D6",
      0.485,
      0,
      8
     ]
    ],
    "lead-25": [
     [
      0,
      0.225,
      "C4",
      0.588
     ],
     [
      0.25,
      0.225,
      "D#4",
      0.694
     ],
     [
      0.5,
      0.475,
      "G4",
      0.7,
      0,
      2.1111
     ],
     [
      1,
      0.225,
      "C4",
      0.799
     ],
     [
      1.25,
      0.0743,
      "D#4",
      0.604
     ],
     [
      1.5,
      0.225,
      "G5",
      0.64
     ],
     [
      1.75,
      0.225,
      "C6",
      0.74
     ],
     [
      2,
      0.225,
      "C4",
      0.743
     ],
     [
      2.25,
      0.225,
      "D#4",
      0.662
     ],
     [
      2.5,
      0.225,
      "G4",
      0.559
     ],
     [
      2.75,
      0.225,
      "C6",
      0.849
     ],
     [
      3,
      0.225,
      "C4",
      0.842
     ],
     [
      3.25,
      0.1125,
      "D#4",
      0.648
     ],
     [
      3.5,
      0.225,
      "G4",
      0.767
     ],
     [
      4,
      0.225,
      "D#5",
      0.754
     ],
     [
      4.25,
      0.225,
      "G5",
      0.665
     ],
     [
      4.5,
      0.225,
      "A#4",
      0.598
     ],
     [
      4.75,
      0.225,
      "D#5",
      0.808
     ],
     [
      5.25,
      0.225,
      "G4",
      0.755
     ],
     [
      5.5,
      0.1125,
      "A#5",
      0.752
     ],
     [
      5.75,
      0.225,
      "D#5",
      0.551
     ],
     [
      6,
      0.475,
      "D#4",
      0.668,
      0,
      2.1111
     ],
     [
      6.5,
      0.725,
      "A#4",
      0.55,
      0,
      3.2222
     ],
     [
      7.25,
      0.1125,
      "G4",
      0.85
     ],
     [
      7.5,
      0.225,
      "A#5",
      0.63
     ],
     [
      7.75,
      0.225,
      "D#6",
      0.657
     ]
    ],
    "kick": [
     [
      0,
      0.25,
      "C4",
      1
     ],
     [
      0.75,
      0.25,
      "C4",
      0.55
     ],
     [
      2.25,
      0.25,
      "C4",
      0.8
     ],
     [
      2.5,
      0.25,
      "C4",
      0.9
     ],
     [
      4,
      0.25,
      "C4",
      1
     ],
     [
      4.75,
      0.25,
      "C4",
      0.527
     ],
     [
      6.25,
      0.25,
      "C4",
      0.816
     ],
     [
      6.5,
      0.25,
      "C4",
      0.936
     ],
     [
      8,
      0.25,
      "C4",
      0.985
     ],
     [
      8.75,
      0.25,
      "C4",
      0.542
     ],
     [
      10.25,
      0.25,
      "C4",
      0.759
     ],
     [
      10.5,
      0.25,
      "C4",
      0.879
     ],
     [
      12,
      0.25,
      "C4",
      1
     ],
     [
      12.75,
      0.25,
      "C4",
      0.55
     ],
     [
      14.25,
      0.25,
      "C4",
      0.754
     ],
     [
      14.5,
      0.25,
      "C4",
      0.934
     ]
    ],
    "snare": [
     [
      1,
      0.25,
      "C4",
      1
     ],
     [
      1.5,
      0.25,
      "C4",
      0.35
     ],
     [
      3,
      0.25,
      "C4",
      1
     ],
     [
      3.25,
      0.25,
      "C4",
      0.4
     ],
     [
      3.75,
      0.25,
      "C4",
      0.55
     ],
     [
      5,
      0.25,
      "C4",
      0.964
     ],
     [
      5.5,
      0.25,
      "C4",
      0.334
     ],
     [
      7,
      0.25,
      "C4",
      1
     ],
     [
      7.25,
      0.25,
      "C4",
      0.409
     ],
     [
      7.75,
      0.25,
      "C4",
      0.513
     ],
     [
      9,
      0.25,
      "C4",
      1
     ],
     [
      9.5,
      0.25,
      "C4",
      0.361
     ],
     [
      11,
      0.25,
      "C4",
      0.981
     ],
     [
      11.25,
      0.25,
      "C4",
      0.377
     ],
     [
      11.75,
      0.25,
      "C4",
      0.565
     ],
     [
      12,
      0.1,
      "C4",
      0.7
     ],
     [
      12.125,
      0.1,
      "C4",
      0.709
     ],
     [
      12.25,
      0.1,
      "C4",
      0.719
     ],
     [
      12.375,
      0.1,
      "C4",
      0.728
     ],
     [
      12.5,
      0.1,
      "C4",
      0.738
     ],
     [
      12.625,
      0.1,
      "C4",
      0.747
     ],
     [
      12.75,
      0.1,
      "C4",
      0.756
     ],
     [
      12.875,
      0.1,
      "C4",
      0.766
     ],
     [
      13,
      0.1,
      "C4",
      0.775
     ],
     [
      13.125,
      0.1,
      "C4",
      0.784
     ],
     [
      13.25,
      0.1,
      "C4",
      0.794
     ],
     [
      13.375,
      0.1,
      "C4",
      0.803
     ],
     [
      13.5,
      0.1,
      "C4",
      0.813
     ],
     [
      13.625,
      0.1,
      "C4",
      0.822
     ],
     [
      13.75,
      0.1,
      "C4",
      0.831
     ],
     [
      13.875,
      0.1,
      "C4",
      0.841
     ],
     [
      14,
      0.1,
      "C4",
      0.85
     ],
     [
      14.125,
      0.1,
      "C4",
      0.859
     ],
     [
      14.25,
      0.1,
      "C4",
      0.869
     ],
     [
      14.375,
      0.1,
      "C4",
      0.878
     ],
     [
      14.5,
      0.1,
      "C4",
      0.887
     ],
     [
      14.625,
      0.1,
      "C4",
      0.897
     ],
     [
      14.75,
      0.1,
      "C4",
      0.906
     ],
     [
      14.875,
      0.1,
      "C4",
      0.916
     ],
     [
      15,
      0.1,
      "C4",
      0.925
     ],
     [
      15.125,
      0.1,
      "C4",
      0.934
     ],
     [
      15.25,
      0.1,
      "C4",
      0.944
     ],
     [
      15.375,
      0.1,
      "C4",
      0.953
     ],
     [
      15.5,
      0.1,
      "C4",
      0.963
     ],
     [
      15.625,
      0.1,
      "C4",
      0.972
     ],
     [
      15.75,
      0.1,
      "C4",
      0.981
     ],
     [
      15.875,
      0.1,
      "C4",
      0.991
     ]
    ],
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.5
     ],
     [
      0.5,
      0.25,
      "C4",
      0.3
     ],
     [
      1,
      0.25,
      "C4",
      0.5
     ],
     [
      1.5,
      0.25,
      "C4",
      0.3
     ],
     [
      2,
      0.25,
      "C4",
      0.5
     ],
     [
      2.5,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.5
     ],
     [
      3.5,
      0.25,
      "C4",
      0.3
     ],
     [
      4,
      0.25,
      "C4",
      0.496
     ],
     [
      4.5,
      0.25,
      "C4",
      0.289
     ],
     [
      5,
      0.25,
      "C4",
      0.516
     ],
     [
      5.5,
      0.25,
      "C4",
      0.292
     ],
     [
      6,
      0.25,
      "C4",
      0.466
     ],
     [
      6.5,
      0.25,
      "C4",
      0.284
     ],
     [
      7,
      0.25,
      "C4",
      0.476
     ],
     [
      7.5,
      0.25,
      "C4",
      0.29
     ],
     [
      8,
      0.25,
      "C4",
      0.505
     ],
     [
      8.5,
      0.25,
      "C4",
      0.3
     ],
     [
      9,
      0.25,
      "C4",
      0.504
     ],
     [
      9.5,
      0.25,
      "C4",
      0.291
     ],
     [
      10,
      0.25,
      "C4",
      0.478
     ],
     [
      10.5,
      0.25,
      "C4",
      0.276
     ],
     [
      11,
      0.25,
      "C4",
      0.473
     ],
     [
      11.5,
      0.25,
      "C4",
      0.31
     ]
    ],
    "open-hat": [
     [
      2,
      0.25,
      "C4",
      0.4
     ],
     [
      6,
      0.25,
      "C4",
      0.375
     ],
     [
      10,
      0.25,
      "C4",
      0.402
     ]
    ],
    "shaker": [
     [
      0,
      0.25,
      "C4",
      0.15
     ],
     [
      0.25,
      0.25,
      "C4",
      0.3
     ],
     [
      0.5,
      0.25,
      "C4",
      0.15
     ],
     [
      0.75,
      0.25,
      "C4",
      0.3
     ],
     [
      1,
      0.25,
      "C4",
      0.15
     ],
     [
      1.25,
      0.25,
      "C4",
      0.3
     ],
     [
      1.5,
      0.25,
      "C4",
      0.15
     ],
     [
      1.75,
      0.25,
      "C4",
      0.3
     ],
     [
      2,
      0.25,
      "C4",
      0.15
     ],
     [
      2.25,
      0.25,
      "C4",
      0.3
     ],
     [
      2.5,
      0.25,
      "C4",
      0.15
     ],
     [
      2.75,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.15
     ],
     [
      3.25,
      0.25,
      "C4",
      0.3
     ],
     [
      3.5,
      0.25,
      "C4",
      0.15
     ],
     [
      3.75,
      0.25,
      "C4",
      0.3
     ],
     [
      4,
      0.25,
      "C4",
      0.146
     ],
     [
      4.25,
      0.25,
      "C4",
      0.309
     ],
     [
      4.5,
      0.25,
      "C4",
      0.148
     ],
     [
      4.75,
      0.25,
      "C4",
      0.276
     ],
     [
      5,
      0.25,
      "C4",
      0.149
     ],
     [
      5.25,
      0.25,
      "C4",
      0.285
     ],
     [
      5.5,
      0.25,
      "C4",
      0.141
     ],
     [
      5.75,
      0.25,
      "C4",
      0.287
     ],
     [
      6,
      0.25,
      "C4",
      0.15
     ],
     [
      6.25,
      0.25,
      "C4",
      0.303
     ],
     [
      6.5,
      0.25,
      "C4",
      0.154
     ],
     [
      6.75,
      0.25,
      "C4",
      0.278
     ],
     [
      7,
      0.25,
      "C4",
      0.144
     ],
     [
      7.25,
      0.25,
      "C4",
      0.29
     ],
     [
      7.5,
      0.25,
      "C4",
      0.149
     ],
     [
      7.75,
      0.25,
      "C4",
      0.296
     ],
     [
      8,
      0.25,
      "C4",
      0.146
     ],
     [
      8.25,
      0.25,
      "C4",
      0.289
     ],
     [
      8.5,
      0.25,
      "C4",
      0.14
     ],
     [
      8.75,
      0.25,
      "C4",
      0.282
     ],
     [
      9,
      0.25,
      "C4",
      0.15
     ],
     [
      9.25,
      0.25,
      "C4",
      0.302
     ],
     [
      9.5,
      0.25,
      "C4",
      0.154
     ],
     [
      9.75,
      0.25,
      "C4",
      0.288
     ],
     [
      10,
      0.25,
      "C4",
      0.141
     ],
     [
      10.25,
      0.25,
      "C4",
      0.29
     ],
     [
      10.5,
      0.25,
      "C4",
      0.138
     ],
     [
      10.75,
      0.25,
      "C4",
      0.299
     ],
     [
      11,
      0.25,
      "C4",
      0.154
     ],
     [
      11.25,
      0.25,
      "C4",
      0.308
     ],
     [
      11.5,
      0.25,
      "C4",
      0.149
     ],
     [
      11.75,
      0.25,
      "C4",
      0.292
     ]
    ],
    "lead-2": [
     [
      8.25,
      0.225,
      "C6",
      0.875
     ],
     [
      8.5,
      0.225,
      "D#5",
      0.553
     ],
     [
      9,
      0.6375,
      "G#5",
      0.576
     ],
     [
      9.75,
      0.6375,
      "D#5",
      0.574
     ],
     [
      10.5,
      0.375,
      "G#6",
      0.584
     ],
     [
      11.25,
      0.6375,
      "G#4",
      0.576
     ],
     [
      12,
      0.225,
      "B4",
      0.672
     ],
     [
      12.25,
      0.0743,
      "D5",
      0.571
     ],
     [
      13,
      0.225,
      "B5",
      0.828
     ],
     [
      13.25,
      0.225,
      "D6",
      0.663
     ],
     [
      13.5,
      0.1125,
      "F#6",
      0.567
     ],
     [
      13.75,
      0.225,
      "B5",
      0.766
     ],
     [
      14.25,
      0.1,
      "D5",
      0.763
     ],
     [
      14.375,
      0.1,
      "D6",
      0.553
     ],
     [
      14.5,
      0.1,
      "D5",
      0.695
     ],
     [
      14.625,
      0.1,
      "D5",
      0.526
     ],
     [
      14.75,
      0.1,
      "D5",
      0.736
     ],
     [
      14.875,
      0.1,
      "D6",
      0.501
     ],
     [
      15,
      0.225,
      "B6",
      0.751
     ],
     [
      15.5,
      0.225,
      "F#5",
      0.701
     ],
     [
      15.75,
      0.225,
      "B5",
      0.848
     ]
    ]
   }
  },
  {
   "id": "drop-d2-2-пробеж2",
   "name": "✨ Drop D2.2 · Пробежка с октавой",
   "color": "#fff09e",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "sub-acid": [
     [
      0,
      3.8,
      "C1",
      0.9
     ],
     [
      4,
      3.8,
      "D#1",
      0.9
     ],
     [
      8,
      3.8,
      "G#1",
      0.9
     ],
     [
      12,
      3.8,
      "B1",
      0.9
     ]
    ],
    "lead-grind-fifth": [
     [
      8,
      0.1568,
      "D#5",
      0.568
     ],
     [
      9.75,
      0.225,
      "D#7",
      0.558
     ],
     [
      12.5,
      0.5,
      "G#6",
      0.496
     ],
     [
      14,
      0.225,
      "C6",
      0.571
     ],
     [
      14.25,
      1.225,
      "D6",
      0.485,
      0,
      8
     ]
    ],
    "lead-25": [
     [
      0,
      0.225,
      "C4",
      0.588
     ],
     [
      0.25,
      0.225,
      "D#4",
      0.694
     ],
     [
      0.5,
      0.475,
      "G4",
      0.7,
      0,
      2.1111
     ],
     [
      1,
      0.225,
      "C4",
      0.799
     ],
     [
      1.25,
      0.0743,
      "D#4",
      0.604
     ],
     [
      1.5,
      0.225,
      "G5",
      0.64
     ],
     [
      1.75,
      0.225,
      "C6",
      0.74
     ],
     [
      2,
      0.225,
      "C4",
      0.743
     ],
     [
      2.25,
      0.225,
      "D#4",
      0.662
     ],
     [
      2.5,
      0.225,
      "G4",
      0.559
     ],
     [
      2.75,
      0.225,
      "C6",
      0.849
     ],
     [
      3,
      0.225,
      "C4",
      0.842
     ],
     [
      3.25,
      0.1125,
      "D#4",
      0.648
     ],
     [
      3.5,
      0.225,
      "G4",
      0.767
     ],
     [
      4,
      0.225,
      "D#5",
      0.754
     ],
     [
      4.25,
      0.225,
      "G5",
      0.665
     ],
     [
      4.5,
      0.225,
      "A#4",
      0.598
     ],
     [
      4.75,
      0.225,
      "D#5",
      0.808
     ],
     [
      5.25,
      0.225,
      "G4",
      0.755
     ],
     [
      5.5,
      0.1125,
      "A#5",
      0.752
     ],
     [
      5.75,
      0.225,
      "D#5",
      0.551
     ],
     [
      6,
      0.475,
      "D#4",
      0.668,
      0,
      2.1111
     ],
     [
      6.5,
      0.725,
      "A#4",
      0.55,
      0,
      3.2222
     ],
     [
      7.25,
      0.1125,
      "G4",
      0.85
     ],
     [
      7.5,
      0.225,
      "A#5",
      0.63
     ],
     [
      7.75,
      0.225,
      "D#6",
      0.657
     ],
     [
      8,
      0.1,
      "C4",
      0.6
     ],
     [
      8.125,
      0.1,
      "D#4",
      0.606
     ],
     [
      8.25,
      0.1,
      "G4",
      0.612
     ],
     [
      8.375,
      0.1,
      "C4",
      0.619
     ],
     [
      8.5,
      0.1,
      "D#4",
      0.625
     ],
     [
      8.625,
      0.1,
      "G5",
      0.631
     ],
     [
      8.75,
      0.1,
      "C6",
      0.637
     ],
     [
      8.875,
      0.1,
      "C4",
      0.644
     ],
     [
      9,
      0.1,
      "D#4",
      0.65
     ],
     [
      9.125,
      0.1,
      "G4",
      0.656
     ],
     [
      9.25,
      0.1,
      "C6",
      0.662
     ],
     [
      9.375,
      0.1,
      "C4",
      0.669
     ],
     [
      9.5,
      0.1,
      "D#4",
      0.675
     ],
     [
      9.625,
      0.1,
      "G4",
      0.681
     ],
     [
      9.75,
      0.1,
      "D#5",
      0.688
     ],
     [
      9.875,
      0.1,
      "G5",
      0.694
     ],
     [
      10,
      0.1,
      "A#4",
      0.7
     ],
     [
      10.125,
      0.1,
      "D#5",
      0.706
     ],
     [
      10.25,
      0.1,
      "G4",
      0.713
     ],
     [
      10.375,
      0.1,
      "A#5",
      0.719
     ],
     [
      10.5,
      0.1,
      "D#5",
      0.725
     ],
     [
      10.625,
      0.1,
      "D#4",
      0.731
     ],
     [
      10.75,
      0.1,
      "A#4",
      0.738
     ],
     [
      10.875,
      0.1,
      "G4",
      0.744
     ],
     [
      11,
      0.1,
      "A#5",
      0.75
     ],
     [
      11.125,
      0.1,
      "D#6",
      0.756
     ],
     [
      11.25,
      0.1,
      "C6",
      0.762
     ],
     [
      11.375,
      0.1,
      "D#5",
      0.769
     ],
     [
      11.5,
      0.1,
      "G#4",
      0.775
     ],
     [
      11.625,
      0.1,
      "D#5",
      0.781
     ],
     [
      11.75,
      0.1,
      "G#5",
      0.787
     ],
     [
      11.875,
      0.1,
      "B4",
      0.794
     ],
     [
      12,
      0.1,
      "D6",
      0.8
     ],
     [
      12.125,
      0.1,
      "B5",
      0.806
     ],
     [
      12.25,
      0.1,
      "D6",
      0.813
     ],
     [
      12.375,
      0.1,
      "F#6",
      0.819
     ],
     [
      12.5,
      0.1,
      "B6",
      0.825
     ],
     [
      12.625,
      0.1,
      "D6",
      0.831
     ],
     [
      12.75,
      0.1,
      "B6",
      0.838
     ],
     [
      12.875,
      0.1,
      "F#6",
      0.844
     ],
     [
      13,
      0.1,
      "B6",
      0.85
     ],
     [
      13.125,
      0.1,
      "C5",
      0.856
     ],
     [
      13.25,
      0.1,
      "D#5",
      0.863
     ],
     [
      13.375,
      0.1,
      "G5",
      0.869
     ],
     [
      13.5,
      0.1,
      "C5",
      0.875
     ],
     [
      13.625,
      0.1,
      "D#5",
      0.881
     ],
     [
      13.75,
      0.1,
      "G6",
      0.887
     ],
     [
      13.875,
      0.1,
      "C7",
      0.894
     ],
     [
      14,
      0.1,
      "C5",
      0.9
     ],
     [
      14.125,
      0.1,
      "D#5",
      0.906
     ],
     [
      14.25,
      0.1,
      "G5",
      0.912
     ],
     [
      14.375,
      0.1,
      "C7",
      0.919
     ],
     [
      14.5,
      0.1,
      "C5",
      0.925
     ],
     [
      14.625,
      0.1,
      "D#5",
      0.931
     ],
     [
      14.75,
      0.1,
      "G5",
      0.938
     ],
     [
      14.875,
      0.1,
      "D#7",
      0.944
     ],
     [
      15,
      0.1,
      "G7",
      0.95
     ],
     [
      15.125,
      0.1,
      "A#6",
      0.956
     ],
     [
      15.25,
      0.1,
      "D#7",
      0.963
     ],
     [
      15.375,
      0.1,
      "G6",
      0.969
     ],
     [
      15.5,
      0.1,
      "A#7",
      0.975
     ],
     [
      15.625,
      0.1,
      "D#7",
      0.981
     ],
     [
      15.75,
      0.1,
      "D#6",
      0.988
     ],
     [
      15.875,
      0.1,
      "A#6",
      0.994
     ]
    ],
    "kick": [
     [
      0,
      0.25,
      "C4",
      1
     ],
     [
      0.75,
      0.25,
      "C4",
      0.55
     ],
     [
      2.25,
      0.25,
      "C4",
      0.8
     ],
     [
      2.5,
      0.25,
      "C4",
      0.9
     ],
     [
      4,
      0.25,
      "C4",
      1
     ],
     [
      4.75,
      0.25,
      "C4",
      0.527
     ],
     [
      6.25,
      0.25,
      "C4",
      0.816
     ],
     [
      6.5,
      0.25,
      "C4",
      0.936
     ],
     [
      8,
      0.25,
      "C4",
      0.985
     ],
     [
      8.75,
      0.25,
      "C4",
      0.542
     ],
     [
      10.25,
      0.25,
      "C4",
      0.759
     ],
     [
      10.5,
      0.25,
      "C4",
      0.879
     ],
     [
      12,
      0.25,
      "C4",
      1
     ],
     [
      12.75,
      0.25,
      "C4",
      0.55
     ],
     [
      14.25,
      0.25,
      "C4",
      0.754
     ],
     [
      14.5,
      0.25,
      "C4",
      0.934
     ]
    ],
    "snare": [
     [
      1,
      0.25,
      "C4",
      1
     ],
     [
      1.5,
      0.25,
      "C4",
      0.35
     ],
     [
      3,
      0.25,
      "C4",
      1
     ],
     [
      3.25,
      0.25,
      "C4",
      0.4
     ],
     [
      3.75,
      0.25,
      "C4",
      0.55
     ],
     [
      5,
      0.25,
      "C4",
      0.964
     ],
     [
      5.5,
      0.25,
      "C4",
      0.334
     ],
     [
      7,
      0.25,
      "C4",
      1
     ],
     [
      7.25,
      0.25,
      "C4",
      0.409
     ],
     [
      7.75,
      0.25,
      "C4",
      0.513
     ],
     [
      8,
      0.1,
      "C4",
      0.35
     ],
     [
      8.25,
      0.1,
      "C4",
      0.37
     ],
     [
      8.5,
      0.1,
      "C4",
      0.391
     ],
     [
      8.75,
      0.1,
      "C4",
      0.411
     ],
     [
      9,
      0.1,
      "C4",
      0.431
     ],
     [
      9.25,
      0.1,
      "C4",
      0.452
     ],
     [
      9.5,
      0.1,
      "C4",
      0.472
     ],
     [
      9.75,
      0.1,
      "C4",
      0.492
     ],
     [
      10,
      0.1,
      "C4",
      0.512
     ],
     [
      10.25,
      0.1,
      "C4",
      0.533
     ],
     [
      10.5,
      0.1,
      "C4",
      0.553
     ],
     [
      10.75,
      0.1,
      "C4",
      0.573
     ],
     [
      11,
      0.1,
      "C4",
      0.594
     ],
     [
      11.25,
      0.1,
      "C4",
      0.614
     ],
     [
      11.5,
      0.1,
      "C4",
      0.634
     ],
     [
      11.75,
      0.1,
      "C4",
      0.655
     ],
     [
      12,
      0.1,
      "C4",
      0.675
     ],
     [
      12.125,
      0.1,
      "C4",
      0.685
     ],
     [
      12.25,
      0.1,
      "C4",
      0.695
     ],
     [
      12.375,
      0.1,
      "C4",
      0.705
     ],
     [
      12.5,
      0.1,
      "C4",
      0.716
     ],
     [
      12.625,
      0.1,
      "C4",
      0.726
     ],
     [
      12.75,
      0.1,
      "C4",
      0.736
     ],
     [
      12.875,
      0.1,
      "C4",
      0.746
     ],
     [
      13,
      0.1,
      "C4",
      0.756
     ],
     [
      13.125,
      0.1,
      "C4",
      0.766
     ],
     [
      13.25,
      0.1,
      "C4",
      0.777
     ],
     [
      13.375,
      0.1,
      "C4",
      0.787
     ],
     [
      13.5,
      0.1,
      "C4",
      0.797
     ],
     [
      13.625,
      0.1,
      "C4",
      0.807
     ],
     [
      13.75,
      0.1,
      "C4",
      0.817
     ],
     [
      13.875,
      0.1,
      "C4",
      0.827
     ],
     [
      14,
      0.1,
      "C4",
      0.838
     ],
     [
      14.125,
      0.1,
      "C4",
      0.848
     ],
     [
      14.25,
      0.1,
      "C4",
      0.858
     ],
     [
      14.375,
      0.1,
      "C4",
      0.868
     ],
     [
      14.5,
      0.1,
      "C4",
      0.878
     ],
     [
      14.625,
      0.1,
      "C4",
      0.888
     ],
     [
      14.75,
      0.1,
      "C4",
      0.898
     ],
     [
      14.875,
      0.1,
      "C4",
      0.909
     ],
     [
      15,
      0.1,
      "C4",
      0.919
     ],
     [
      15.125,
      0.1,
      "C4",
      0.929
     ],
     [
      15.25,
      0.1,
      "C4",
      0.939
     ],
     [
      15.375,
      0.1,
      "C4",
      0.949
     ],
     [
      15.5,
      0.1,
      "C4",
      0.959
     ],
     [
      15.625,
      0.1,
      "C4",
      0.97
     ],
     [
      15.75,
      0.1,
      "C4",
      0.98
     ],
     [
      15.875,
      0.1,
      "C4",
      0.99
     ]
    ],
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.5
     ],
     [
      0.5,
      0.25,
      "C4",
      0.3
     ],
     [
      1,
      0.25,
      "C4",
      0.5
     ],
     [
      1.5,
      0.25,
      "C4",
      0.3
     ],
     [
      2,
      0.25,
      "C4",
      0.5
     ],
     [
      2.5,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.5
     ],
     [
      3.5,
      0.25,
      "C4",
      0.3
     ],
     [
      4,
      0.25,
      "C4",
      0.496
     ],
     [
      4.5,
      0.25,
      "C4",
      0.289
     ],
     [
      5,
      0.25,
      "C4",
      0.516
     ],
     [
      5.5,
      0.25,
      "C4",
      0.292
     ],
     [
      6,
      0.25,
      "C4",
      0.466
     ],
     [
      6.5,
      0.25,
      "C4",
      0.284
     ],
     [
      7,
      0.25,
      "C4",
      0.476
     ],
     [
      7.5,
      0.25,
      "C4",
      0.29
     ]
    ],
    "open-hat": [
     [
      2,
      0.25,
      "C4",
      0.4
     ],
     [
      6,
      0.25,
      "C4",
      0.375
     ]
    ],
    "shaker": [
     [
      0,
      0.25,
      "C4",
      0.15
     ],
     [
      0.25,
      0.25,
      "C4",
      0.3
     ],
     [
      0.5,
      0.25,
      "C4",
      0.15
     ],
     [
      0.75,
      0.25,
      "C4",
      0.3
     ],
     [
      1,
      0.25,
      "C4",
      0.15
     ],
     [
      1.25,
      0.25,
      "C4",
      0.3
     ],
     [
      1.5,
      0.25,
      "C4",
      0.15
     ],
     [
      1.75,
      0.25,
      "C4",
      0.3
     ],
     [
      2,
      0.25,
      "C4",
      0.15
     ],
     [
      2.25,
      0.25,
      "C4",
      0.3
     ],
     [
      2.5,
      0.25,
      "C4",
      0.15
     ],
     [
      2.75,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.15
     ],
     [
      3.25,
      0.25,
      "C4",
      0.3
     ],
     [
      3.5,
      0.25,
      "C4",
      0.15
     ],
     [
      3.75,
      0.25,
      "C4",
      0.3
     ],
     [
      4,
      0.25,
      "C4",
      0.146
     ],
     [
      4.25,
      0.25,
      "C4",
      0.309
     ],
     [
      4.5,
      0.25,
      "C4",
      0.148
     ],
     [
      4.75,
      0.25,
      "C4",
      0.276
     ],
     [
      5,
      0.25,
      "C4",
      0.149
     ],
     [
      5.25,
      0.25,
      "C4",
      0.285
     ],
     [
      5.5,
      0.25,
      "C4",
      0.141
     ],
     [
      5.75,
      0.25,
      "C4",
      0.287
     ],
     [
      6,
      0.25,
      "C4",
      0.15
     ],
     [
      6.25,
      0.25,
      "C4",
      0.303
     ],
     [
      6.5,
      0.25,
      "C4",
      0.154
     ],
     [
      6.75,
      0.25,
      "C4",
      0.278
     ],
     [
      7,
      0.25,
      "C4",
      0.144
     ],
     [
      7.25,
      0.25,
      "C4",
      0.29
     ],
     [
      7.5,
      0.25,
      "C4",
      0.149
     ],
     [
      7.75,
      0.25,
      "C4",
      0.296
     ]
    ]
   }
  },
  {
   "id": "drop-d2-3-holes2",
   "name": "✨ Drop D2.3 holes",
   "color": "#ffb3b3",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "sub-acid": [
     [
      0,
      3.8,
      "C1",
      0.9
     ],
     [
      4,
      3.8,
      "D#1",
      0.9
     ],
     [
      8,
      3.8,
      "G#1",
      0.9
     ],
     [
      12,
      3.8,
      "B1",
      0.9
     ]
    ],
    "lead-grind-fifth": [
     [
      8,
      0.1568,
      "D#5",
      0.568
     ],
     [
      9.75,
      0.225,
      "D#7",
      0.558
     ],
     [
      12.5,
      0.5,
      "G#6",
      0.496
     ],
     [
      14,
      0.225,
      "C6",
      0.571
     ],
     [
      14.25,
      1.225,
      "D6",
      0.485,
      0,
      8
     ]
    ],
    "lead-26": [
     [
      2,
      0.225,
      "C4",
      0.743
     ],
     [
      2.25,
      0.225,
      "D#4",
      0.662
     ],
     [
      2.5,
      0.225,
      "G4",
      0.559
     ],
     [
      2.75,
      0.225,
      "C6",
      0.849
     ],
     [
      3,
      0.225,
      "C4",
      0.842
     ],
     [
      3.25,
      0.1125,
      "D#4",
      0.648
     ],
     [
      3.5,
      0.225,
      "G4",
      0.767
     ],
     [
      8.25,
      0.225,
      "C6",
      0.875
     ],
     [
      8.5,
      0.225,
      "D#5",
      0.553
     ],
     [
      9,
      0.6375,
      "G#4",
      0.576
     ],
     [
      9.75,
      0.6375,
      "D#5",
      0.574
     ],
     [
      12,
      0.225,
      "B4",
      0.672
     ],
     [
      12.25,
      0.0743,
      "D5",
      0.571
     ],
     [
      13,
      0.225,
      "B4",
      0.828
     ],
     [
      13.25,
      0.225,
      "D5",
      0.663
     ],
     [
      13.5,
      0.1125,
      "F#5",
      0.567
     ],
     [
      13.75,
      0.225,
      "B5",
      0.766
     ],
     [
      14.25,
      0.725,
      "D5",
      0.721,
      0,
      3.2222
     ],
     [
      15,
      0.225,
      "B5",
      0.701
     ],
     [
      15.5,
      0.225,
      "F#5",
      0.701
     ],
     [
      15.75,
      0.225,
      "B5",
      0.848
     ]
    ],
    "kick": [
     [
      0,
      0.25,
      "C4",
      1
     ],
     [
      0.75,
      0.25,
      "C4",
      0.55
     ],
     [
      2.25,
      0.25,
      "C4",
      0.8
     ],
     [
      2.5,
      0.25,
      "C4",
      0.9
     ],
     [
      8,
      0.25,
      "C4",
      0.985
     ],
     [
      8.75,
      0.25,
      "C4",
      0.542
     ],
     [
      12,
      0.25,
      "C4",
      1
     ],
     [
      12.75,
      0.25,
      "C4",
      0.55
     ],
     [
      14.25,
      0.25,
      "C4",
      0.754
     ],
     [
      14.5,
      0.25,
      "C4",
      0.934
     ]
    ],
    "snare": [
     [
      3,
      0.25,
      "C4",
      1
     ],
     [
      3.25,
      0.25,
      "C4",
      0.4
     ],
     [
      3.75,
      0.25,
      "C4",
      0.55
     ],
     [
      9,
      0.25,
      "C4",
      1
     ],
     [
      9.5,
      0.25,
      "C4",
      0.361
     ],
     [
      13,
      0.25,
      "C4",
      1
     ],
     [
      13.5,
      0.25,
      "C4",
      0.334
     ],
     [
      15,
      0.25,
      "C4",
      0.924
     ],
     [
      15.25,
      0.25,
      "C4",
      0.369
     ],
     [
      15.75,
      0.25,
      "C4",
      0.565
     ]
    ],
    "hat": [
     [
      2,
      0.25,
      "C4",
      0.5
     ],
     [
      2.5,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.5
     ],
     [
      3.5,
      0.25,
      "C4",
      0.3
     ],
     [
      8,
      0.25,
      "C4",
      0.505
     ],
     [
      8.5,
      0.25,
      "C4",
      0.3
     ],
     [
      9,
      0.25,
      "C4",
      0.504
     ],
     [
      9.5,
      0.25,
      "C4",
      0.291
     ],
     [
      12,
      0.25,
      "C4",
      0.507
     ],
     [
      12.5,
      0.25,
      "C4",
      0.293
     ],
     [
      13,
      0.25,
      "C4",
      0.486
     ],
     [
      13.5,
      0.25,
      "C4",
      0.289
     ],
     [
      14,
      0.25,
      "C4",
      0.487
     ],
     [
      14.5,
      0.25,
      "C4",
      0.295
     ],
     [
      15,
      0.25,
      "C4",
      0.503
     ],
     [
      15.5,
      0.25,
      "C4",
      0.278
     ]
    ],
    "open-hat": [
     [
      2,
      0.25,
      "C4",
      0.4
     ],
     [
      14,
      0.25,
      "C4",
      0.387
     ]
    ],
    "shaker": [
     [
      2,
      0.25,
      "C4",
      0.15
     ],
     [
      2.25,
      0.25,
      "C4",
      0.3
     ],
     [
      2.5,
      0.25,
      "C4",
      0.15
     ],
     [
      2.75,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.15
     ],
     [
      3.25,
      0.25,
      "C4",
      0.3
     ],
     [
      3.5,
      0.25,
      "C4",
      0.15
     ],
     [
      3.75,
      0.25,
      "C4",
      0.3
     ],
     [
      8,
      0.25,
      "C4",
      0.146
     ],
     [
      8.25,
      0.25,
      "C4",
      0.289
     ],
     [
      8.5,
      0.25,
      "C4",
      0.14
     ],
     [
      8.75,
      0.25,
      "C4",
      0.282
     ],
     [
      9,
      0.25,
      "C4",
      0.15
     ],
     [
      9.25,
      0.25,
      "C4",
      0.302
     ],
     [
      9.5,
      0.25,
      "C4",
      0.154
     ],
     [
      9.75,
      0.25,
      "C4",
      0.288
     ],
     [
      12,
      0.25,
      "C4",
      0.151
     ],
     [
      12.25,
      0.25,
      "C4",
      0.28
     ],
     [
      12.5,
      0.25,
      "C4",
      0.143
     ],
     [
      12.75,
      0.25,
      "C4",
      0.289
     ],
     [
      13,
      0.25,
      "C4",
      0.147
     ],
     [
      13.25,
      0.25,
      "C4",
      0.278
     ],
     [
      13.5,
      0.25,
      "C4",
      0.148
     ],
     [
      13.75,
      0.25,
      "C4",
      0.295
     ],
     [
      14,
      0.25,
      "C4",
      0.154
     ],
     [
      14.25,
      0.25,
      "C4",
      0.281
     ],
     [
      14.5,
      0.25,
      "C4",
      0.144
     ],
     [
      14.75,
      0.25,
      "C4",
      0.299
     ],
     [
      15,
      0.25,
      "C4",
      0.141
     ],
     [
      15.25,
      0.25,
      "C4",
      0.29
     ],
     [
      15.5,
      0.25,
      "C4",
      0.143
     ],
     [
      15.75,
      0.25,
      "C4",
      0.296
     ]
    ]
   }
  },
  {
   "id": "drop-d2-3-пробеж2",
   "name": "✨ Drop D2.3 · Пробежка с октавой",
   "color": "#fff09e",
   "sig": "4/4",
   "length": 16,
   "notes": {
    "sub-acid": [
     [
      0,
      3.8,
      "C1",
      0.9
     ],
     [
      4,
      3.8,
      "D#1",
      0.9
     ],
     [
      8,
      3.8,
      "G#1",
      0.9
     ],
     [
      12,
      3.8,
      "B1",
      0.9
     ]
    ],
    "lead-grind-fifth": [
     [
      8,
      0.1568,
      "D#5",
      0.568
     ],
     [
      9.75,
      0.225,
      "D#7",
      0.558
     ],
     [
      12.5,
      0.5,
      "G#6",
      0.496
     ],
     [
      14,
      0.225,
      "C6",
      0.571
     ],
     [
      14.25,
      1.225,
      "D6",
      0.485,
      0,
      8
     ]
    ],
    "lead-26": [
     [
      0,
      0.225,
      "C4",
      0.588
     ],
     [
      0.25,
      0.225,
      "D#4",
      0.694
     ],
     [
      0.5,
      0.475,
      "G4",
      0.7,
      0,
      2.1111
     ],
     [
      1,
      0.225,
      "C4",
      0.799
     ],
     [
      1.25,
      0.0743,
      "D#4",
      0.604
     ],
     [
      1.5,
      0.225,
      "G5",
      0.64
     ],
     [
      1.75,
      0.225,
      "C6",
      0.74
     ],
     [
      2,
      0.225,
      "C4",
      0.743
     ],
     [
      2.25,
      0.225,
      "D#4",
      0.662
     ],
     [
      2.5,
      0.225,
      "G4",
      0.559
     ],
     [
      2.75,
      0.225,
      "C6",
      0.849
     ],
     [
      3,
      0.225,
      "C4",
      0.842
     ],
     [
      3.25,
      0.1125,
      "D#4",
      0.648
     ],
     [
      3.5,
      0.225,
      "G4",
      0.767
     ],
     [
      4,
      0.225,
      "D#5",
      0.754
     ],
     [
      4.25,
      0.225,
      "G5",
      0.665
     ],
     [
      4.5,
      0.225,
      "A#4",
      0.598
     ],
     [
      4.75,
      0.225,
      "D#5",
      0.808
     ],
     [
      5.25,
      0.225,
      "G4",
      0.755
     ],
     [
      5.5,
      0.1125,
      "A#5",
      0.752
     ],
     [
      5.75,
      0.225,
      "D#5",
      0.551
     ],
     [
      6,
      0.475,
      "D#4",
      0.668,
      0,
      2.1111
     ],
     [
      6.5,
      0.725,
      "A#4",
      0.55,
      0,
      3.2222
     ],
     [
      7.25,
      0.1125,
      "G4",
      0.85
     ],
     [
      7.5,
      0.225,
      "A#5",
      0.63
     ],
     [
      7.75,
      0.225,
      "D#6",
      0.657
     ],
     [
      8,
      0.1,
      "C4",
      0.6
     ],
     [
      8.125,
      0.1,
      "D#4",
      0.606
     ],
     [
      8.25,
      0.1,
      "G4",
      0.612
     ],
     [
      8.375,
      0.1,
      "C4",
      0.619
     ],
     [
      8.5,
      0.1,
      "D#4",
      0.625
     ],
     [
      8.625,
      0.1,
      "G5",
      0.631
     ],
     [
      8.75,
      0.1,
      "C6",
      0.637
     ],
     [
      8.875,
      0.1,
      "C4",
      0.644
     ],
     [
      9,
      0.1,
      "D#4",
      0.65
     ],
     [
      9.125,
      0.1,
      "G4",
      0.656
     ],
     [
      9.25,
      0.1,
      "C6",
      0.662
     ],
     [
      9.375,
      0.1,
      "C4",
      0.669
     ],
     [
      9.5,
      0.1,
      "D#4",
      0.675
     ],
     [
      9.625,
      0.1,
      "G4",
      0.681
     ],
     [
      9.75,
      0.1,
      "D#5",
      0.688
     ],
     [
      9.875,
      0.1,
      "G5",
      0.694
     ],
     [
      10,
      0.1,
      "A#4",
      0.7
     ],
     [
      10.125,
      0.1,
      "D#5",
      0.706
     ],
     [
      10.25,
      0.1,
      "G4",
      0.713
     ],
     [
      10.375,
      0.1,
      "A#5",
      0.719
     ],
     [
      10.5,
      0.1,
      "D#5",
      0.725
     ],
     [
      10.625,
      0.1,
      "D#4",
      0.731
     ],
     [
      10.75,
      0.1,
      "A#4",
      0.738
     ],
     [
      10.875,
      0.1,
      "G4",
      0.744
     ],
     [
      11,
      0.1,
      "A#5",
      0.75
     ],
     [
      11.125,
      0.1,
      "D#6",
      0.756
     ],
     [
      11.25,
      0.1,
      "C6",
      0.762
     ],
     [
      11.375,
      0.1,
      "D#5",
      0.769
     ],
     [
      11.5,
      0.1,
      "G#4",
      0.775
     ],
     [
      11.625,
      0.1,
      "D#5",
      0.781
     ],
     [
      11.75,
      0.1,
      "G#5",
      0.787
     ],
     [
      11.875,
      0.1,
      "B4",
      0.794
     ],
     [
      12,
      0.1,
      "D6",
      0.8
     ],
     [
      12.125,
      0.1,
      "B5",
      0.806
     ],
     [
      12.25,
      0.1,
      "D6",
      0.813
     ],
     [
      12.375,
      0.1,
      "F#6",
      0.819
     ],
     [
      12.5,
      0.1,
      "B6",
      0.825
     ],
     [
      12.625,
      0.1,
      "D6",
      0.831
     ],
     [
      12.75,
      0.1,
      "B6",
      0.838
     ],
     [
      12.875,
      0.1,
      "F#6",
      0.844
     ],
     [
      13,
      0.1,
      "B6",
      0.85
     ],
     [
      13.125,
      0.1,
      "C5",
      0.856
     ],
     [
      13.25,
      0.1,
      "D#5",
      0.863
     ],
     [
      13.375,
      0.1,
      "G5",
      0.869
     ],
     [
      13.5,
      0.1,
      "C5",
      0.875
     ],
     [
      13.625,
      0.1,
      "D#5",
      0.881
     ],
     [
      13.75,
      0.1,
      "G6",
      0.887
     ],
     [
      13.875,
      0.1,
      "C7",
      0.894
     ],
     [
      14,
      0.1,
      "C5",
      0.9
     ],
     [
      14.125,
      0.1,
      "D#5",
      0.906
     ],
     [
      14.25,
      0.1,
      "G5",
      0.912
     ],
     [
      14.375,
      0.1,
      "C7",
      0.919
     ],
     [
      14.5,
      0.1,
      "C5",
      0.925
     ],
     [
      14.625,
      0.1,
      "D#5",
      0.931
     ],
     [
      14.75,
      0.1,
      "G5",
      0.938
     ],
     [
      14.875,
      0.1,
      "D#7",
      0.944
     ],
     [
      15,
      0.1,
      "G7",
      0.95
     ],
     [
      15.125,
      0.1,
      "A#6",
      0.956
     ],
     [
      15.25,
      0.1,
      "D#7",
      0.963
     ],
     [
      15.375,
      0.1,
      "G6",
      0.969
     ],
     [
      15.5,
      0.1,
      "A#7",
      0.975
     ],
     [
      15.625,
      0.1,
      "D#7",
      0.981
     ],
     [
      15.75,
      0.1,
      "D#6",
      0.988
     ],
     [
      15.875,
      0.1,
      "A#6",
      0.994
     ]
    ],
    "kick": [
     [
      0,
      0.25,
      "C4",
      1
     ],
     [
      0.75,
      0.25,
      "C4",
      0.55
     ],
     [
      2.25,
      0.25,
      "C4",
      0.8
     ],
     [
      2.5,
      0.25,
      "C4",
      0.9
     ],
     [
      4,
      0.25,
      "C4",
      1
     ],
     [
      4.75,
      0.25,
      "C4",
      0.527
     ],
     [
      6.25,
      0.25,
      "C4",
      0.816
     ],
     [
      6.5,
      0.25,
      "C4",
      0.936
     ],
     [
      8,
      0.25,
      "C4",
      0.985
     ],
     [
      8.75,
      0.25,
      "C4",
      0.542
     ],
     [
      10.25,
      0.25,
      "C4",
      0.759
     ],
     [
      10.5,
      0.25,
      "C4",
      0.879
     ],
     [
      12,
      0.25,
      "C4",
      1
     ],
     [
      12.75,
      0.25,
      "C4",
      0.55
     ],
     [
      14.25,
      0.25,
      "C4",
      0.754
     ],
     [
      14.5,
      0.25,
      "C4",
      0.934
     ]
    ],
    "snare": [
     [
      1,
      0.25,
      "C4",
      1
     ],
     [
      1.5,
      0.25,
      "C4",
      0.35
     ],
     [
      3,
      0.25,
      "C4",
      1
     ],
     [
      3.25,
      0.25,
      "C4",
      0.4
     ],
     [
      3.75,
      0.25,
      "C4",
      0.55
     ],
     [
      5,
      0.25,
      "C4",
      0.964
     ],
     [
      5.5,
      0.25,
      "C4",
      0.334
     ],
     [
      7,
      0.25,
      "C4",
      1
     ],
     [
      7.25,
      0.25,
      "C4",
      0.409
     ],
     [
      7.75,
      0.25,
      "C4",
      0.513
     ],
     [
      8,
      0.1,
      "C4",
      0.35
     ],
     [
      8.25,
      0.1,
      "C4",
      0.37
     ],
     [
      8.5,
      0.1,
      "C4",
      0.391
     ],
     [
      8.75,
      0.1,
      "C4",
      0.411
     ],
     [
      9,
      0.1,
      "C4",
      0.431
     ],
     [
      9.25,
      0.1,
      "C4",
      0.452
     ],
     [
      9.5,
      0.1,
      "C4",
      0.472
     ],
     [
      9.75,
      0.1,
      "C4",
      0.492
     ],
     [
      10,
      0.1,
      "C4",
      0.512
     ],
     [
      10.25,
      0.1,
      "C4",
      0.533
     ],
     [
      10.5,
      0.1,
      "C4",
      0.553
     ],
     [
      10.75,
      0.1,
      "C4",
      0.573
     ],
     [
      11,
      0.1,
      "C4",
      0.594
     ],
     [
      11.25,
      0.1,
      "C4",
      0.614
     ],
     [
      11.5,
      0.1,
      "C4",
      0.634
     ],
     [
      11.75,
      0.1,
      "C4",
      0.655
     ],
     [
      12,
      0.1,
      "C4",
      0.675
     ],
     [
      12.125,
      0.1,
      "C4",
      0.685
     ],
     [
      12.25,
      0.1,
      "C4",
      0.695
     ],
     [
      12.375,
      0.1,
      "C4",
      0.705
     ],
     [
      12.5,
      0.1,
      "C4",
      0.716
     ],
     [
      12.625,
      0.1,
      "C4",
      0.726
     ],
     [
      12.75,
      0.1,
      "C4",
      0.736
     ],
     [
      12.875,
      0.1,
      "C4",
      0.746
     ],
     [
      13,
      0.1,
      "C4",
      0.756
     ],
     [
      13.125,
      0.1,
      "C4",
      0.766
     ],
     [
      13.25,
      0.1,
      "C4",
      0.777
     ],
     [
      13.375,
      0.1,
      "C4",
      0.787
     ],
     [
      13.5,
      0.1,
      "C4",
      0.797
     ],
     [
      13.625,
      0.1,
      "C4",
      0.807
     ],
     [
      13.75,
      0.1,
      "C4",
      0.817
     ],
     [
      13.875,
      0.1,
      "C4",
      0.827
     ],
     [
      14,
      0.1,
      "C4",
      0.838
     ],
     [
      14.125,
      0.1,
      "C4",
      0.848
     ],
     [
      14.25,
      0.1,
      "C4",
      0.858
     ],
     [
      14.375,
      0.1,
      "C4",
      0.868
     ],
     [
      14.5,
      0.1,
      "C4",
      0.878
     ],
     [
      14.625,
      0.1,
      "C4",
      0.888
     ],
     [
      14.75,
      0.1,
      "C4",
      0.898
     ],
     [
      14.875,
      0.1,
      "C4",
      0.909
     ],
     [
      15,
      0.1,
      "C4",
      0.919
     ],
     [
      15.125,
      0.1,
      "C4",
      0.929
     ],
     [
      15.25,
      0.1,
      "C4",
      0.939
     ],
     [
      15.375,
      0.1,
      "C4",
      0.949
     ],
     [
      15.5,
      0.1,
      "C4",
      0.959
     ],
     [
      15.625,
      0.1,
      "C4",
      0.97
     ],
     [
      15.75,
      0.1,
      "C4",
      0.98
     ],
     [
      15.875,
      0.1,
      "C4",
      0.99
     ]
    ],
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.5
     ],
     [
      0.5,
      0.25,
      "C4",
      0.3
     ],
     [
      1,
      0.25,
      "C4",
      0.5
     ],
     [
      1.5,
      0.25,
      "C4",
      0.3
     ],
     [
      2,
      0.25,
      "C4",
      0.5
     ],
     [
      2.5,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.5
     ],
     [
      3.5,
      0.25,
      "C4",
      0.3
     ],
     [
      4,
      0.25,
      "C4",
      0.496
     ],
     [
      4.5,
      0.25,
      "C4",
      0.289
     ],
     [
      5,
      0.25,
      "C4",
      0.516
     ],
     [
      5.5,
      0.25,
      "C4",
      0.292
     ],
     [
      6,
      0.25,
      "C4",
      0.466
     ],
     [
      6.5,
      0.25,
      "C4",
      0.284
     ],
     [
      7,
      0.25,
      "C4",
      0.476
     ],
     [
      7.5,
      0.25,
      "C4",
      0.29
     ]
    ],
    "open-hat": [
     [
      2,
      0.25,
      "C4",
      0.4
     ],
     [
      6,
      0.25,
      "C4",
      0.375
     ]
    ],
    "shaker": [
     [
      0,
      0.25,
      "C4",
      0.15
     ],
     [
      0.25,
      0.25,
      "C4",
      0.3
     ],
     [
      0.5,
      0.25,
      "C4",
      0.15
     ],
     [
      0.75,
      0.25,
      "C4",
      0.3
     ],
     [
      1,
      0.25,
      "C4",
      0.15
     ],
     [
      1.25,
      0.25,
      "C4",
      0.3
     ],
     [
      1.5,
      0.25,
      "C4",
      0.15
     ],
     [
      1.75,
      0.25,
      "C4",
      0.3
     ],
     [
      2,
      0.25,
      "C4",
      0.15
     ],
     [
      2.25,
      0.25,
      "C4",
      0.3
     ],
     [
      2.5,
      0.25,
      "C4",
      0.15
     ],
     [
      2.75,
      0.25,
      "C4",
      0.3
     ],
     [
      3,
      0.25,
      "C4",
      0.15
     ],
     [
      3.25,
      0.25,
      "C4",
      0.3
     ],
     [
      3.5,
      0.25,
      "C4",
      0.15
     ],
     [
      3.75,
      0.25,
      "C4",
      0.3
     ],
     [
      4,
      0.25,
      "C4",
      0.146
     ],
     [
      4.25,
      0.25,
      "C4",
      0.309
     ],
     [
      4.5,
      0.25,
      "C4",
      0.148
     ],
     [
      4.75,
      0.25,
      "C4",
      0.276
     ],
     [
      5,
      0.25,
      "C4",
      0.149
     ],
     [
      5.25,
      0.25,
      "C4",
      0.285
     ],
     [
      5.5,
      0.25,
      "C4",
      0.141
     ],
     [
      5.75,
      0.25,
      "C4",
      0.287
     ],
     [
      6,
      0.25,
      "C4",
      0.15
     ],
     [
      6.25,
      0.25,
      "C4",
      0.303
     ],
     [
      6.5,
      0.25,
      "C4",
      0.154
     ],
     [
      6.75,
      0.25,
      "C4",
      0.278
     ],
     [
      7,
      0.25,
      "C4",
      0.144
     ],
     [
      7.25,
      0.25,
      "C4",
      0.29
     ],
     [
      7.5,
      0.25,
      "C4",
      0.149
     ],
     [
      7.75,
      0.25,
      "C4",
      0.296
     ]
    ]
   }
  },
  {
   "id": "pattern171",
   "name": "Pattern 171",
   "color": "#8fe8cf",
   "sig": "4/4",
   "notes": {
    "ride2": [
     [
      0,
      0.25,
      "C4",
      0.85
     ],
     [
      1,
      0.25,
      "C4",
      0.85
     ],
     [
      2,
      0.25,
      "C4",
      0.85
     ],
     [
      3,
      0.25,
      "C4",
      0.85
     ],
     [
      3.5,
      0.25,
      "C4",
      0.85
     ]
    ],
    "crash": [
     [
      0,
      0.25,
      "C4",
      0.85
     ],
     [
      1,
      0.25,
      "C4",
      0.85
     ],
     [
      2,
      0.25,
      "C4",
      0.85
     ],
     [
      3,
      0.25,
      "C4",
      0.85
     ],
     [
      3.5,
      0.25,
      "C4",
      0.85
     ]
    ]
   }
  },
  {
   "id": "kick-in",
   "name": "＋ Бочка входит",
   "color": "#9fd3ff",
   "sig": "4/4",
   "notes": {
    "kick": [
     [
      8,
      0.25,
      "C4",
      0.739
     ],
     [
      8.75,
      0.25,
      "C4",
      0.419
     ],
     [
      10.25,
      0.25,
      "C4",
      0.623
     ],
     [
      10.5,
      0.25,
      "C4",
      0.728
     ],
     [
      12,
      0.25,
      "C4",
      0.875
     ],
     [
      12.75,
      0.25,
      "C4",
      0.494
     ],
     [
      14.25,
      0.25,
      "C4",
      0.713
     ],
     [
      14.5,
      0.25,
      "C4",
      0.89
     ]
    ]
   }
  },
  {
   "id": "outro-fade",
   "name": "＋ Аутро (затухает)",
   "color": "#c3a6ff",
   "sig": "4/4",
   "notes": {
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.22
     ],
     [
      0.25,
      0.25,
      "C4",
      0.217
     ],
     [
      0.5,
      0.25,
      "C4",
      0.436
     ],
     [
      0.75,
      0.25,
      "C4",
      0.21
     ],
     [
      1,
      0.25,
      "C4",
      0.206
     ],
     [
      1.25,
      0.25,
      "C4",
      0.203
     ],
     [
      1.5,
      0.25,
      "C4",
      0.408
     ],
     [
      1.75,
      0.25,
      "C4",
      0.196
     ],
     [
      2,
      0.25,
      "C4",
      0.193
     ],
     [
      2.25,
      0.25,
      "C4",
      0.189
     ],
     [
      2.5,
      0.25,
      "C4",
      0.38
     ],
     [
      2.75,
      0.25,
      "C4",
      0.182
     ],
     [
      3,
      0.25,
      "C4",
      0.179
     ],
     [
      3.25,
      0.25,
      "C4",
      0.175
     ],
     [
      3.5,
      0.25,
      "C4",
      0.352
     ],
     [
      3.75,
      0.25,
      "C4",
      0.168
     ],
     [
      4,
      0.25,
      "C4",
      0.165
     ],
     [
      4.25,
      0.25,
      "C4",
      0.162
     ],
     [
      4.5,
      0.25,
      "C4",
      0.323
     ],
     [
      4.75,
      0.25,
      "C4",
      0.155
     ],
     [
      5,
      0.25,
      "C4",
      0.151
     ],
     [
      5.25,
      0.25,
      "C4",
      0.148
     ],
     [
      5.5,
      0.25,
      "C4",
      0.295
     ],
     [
      5.75,
      0.25,
      "C4",
      0.141
     ],
     [
      6,
      0.25,
      "C4",
      0.138
     ],
     [
      6.25,
      0.25,
      "C4",
      0.134
     ],
     [
      6.5,
      0.25,
      "C4",
      0.267
     ],
     [
      6.75,
      0.25,
      "C4",
      0.127
     ],
     [
      7,
      0.25,
      "C4",
      0.124
     ],
     [
      7.25,
      0.25,
      "C4",
      0.12
     ],
     [
      7.5,
      0.25,
      "C4",
      0.239
     ],
     [
      7.75,
      0.25,
      "C4",
      0.113
     ],
     [
      8,
      0.25,
      "C4",
      0.11
     ],
     [
      8.25,
      0.25,
      "C4",
      0.107
     ],
     [
      8.5,
      0.25,
      "C4",
      0.211
     ],
     [
      8.75,
      0.25,
      "C4",
      0.1
     ],
     [
      9,
      0.25,
      "C4",
      0.096
     ],
     [
      9.25,
      0.25,
      "C4",
      0.093
     ],
     [
      9.5,
      0.25,
      "C4",
      0.183
     ],
     [
      9.75,
      0.25,
      "C4",
      0.086
     ],
     [
      10,
      0.25,
      "C4",
      0.083
     ],
     [
      10.25,
      0.25,
      "C4",
      0.079
     ],
     [
      10.5,
      0.25,
      "C4",
      0.155
     ],
     [
      10.75,
      0.25,
      "C4",
      0.072
     ],
     [
      11,
      0.25,
      "C4",
      0.069
     ],
     [
      11.25,
      0.25,
      "C4",
      0.065
     ],
     [
      11.5,
      0.25,
      "C4",
      0.127
     ],
     [
      11.75,
      0.25,
      "C4",
      0.058
     ],
     [
      12,
      0.25,
      "C4",
      0.055
     ],
     [
      12.25,
      0.25,
      "C4",
      0.052
     ],
     [
      12.5,
      0.25,
      "C4",
      0.098
     ],
     [
      12.75,
      0.25,
      "C4",
      0.045
     ],
     [
      13,
      0.25,
      "C4",
      0.041
     ],
     [
      13.25,
      0.25,
      "C4",
      0.038
     ],
     [
      13.5,
      0.25,
      "C4",
      0.07
     ],
     [
      13.75,
      0.25,
      "C4",
      0.033
     ],
     [
      14,
      0.25,
      "C4",
      0.033
     ],
     [
      14.25,
      0.25,
      "C4",
      0.033
     ],
     [
      14.5,
      0.25,
      "C4",
      0.068
     ],
     [
      14.75,
      0.25,
      "C4",
      0.033
     ],
     [
      15,
      0.25,
      "C4",
      0.033
     ],
     [
      15.25,
      0.25,
      "C4",
      0.033
     ],
     [
      15.5,
      0.25,
      "C4",
      0.068
     ],
     [
      15.75,
      0.25,
      "C4",
      0.033
     ]
    ],
    "sub-acid": [
     [
      0,
      3,
      "C2",
      0.9
     ],
     [
      4.5,
      3,
      "D#2",
      0.647
     ],
     [
      8,
      3,
      "G#1",
      0.45
     ],
     [
      12.5,
      3.25,
      "B1",
      0.197
     ]
    ]
   }
  },
  {
   "id": "juicy-a",
   "name": "🍑 Лид A",
   "color": "#ffc6e0",
   "sig": "4/4",
   "notes": {
    "juicy": [
     [
      0,
      0.5,
      "G5",
      0.85
     ],
     [
      0.75,
      0.25,
      "G5",
      0.6
     ],
     [
      1,
      0.5,
      "D#5",
      0.8
     ],
     [
      1.5,
      1,
      "C6",
      0.9
     ],
     [
      2.75,
      0.25,
      "A#5",
      0.65
     ],
     [
      3,
      0.75,
      "G5",
      0.8
     ],
     [
      4,
      0.5,
      "A#5",
      0.85
     ],
     [
      4.75,
      0.5,
      "G5",
      0.7
     ],
     [
      5.5,
      0.5,
      "D#6",
      0.9
     ],
     [
      6.5,
      0.25,
      "D6",
      0.65
     ],
     [
      6.75,
      1.1,
      "D#6",
      0.85,
      0,
      2
     ],
     [
      8,
      0.5,
      "C6",
      0.85
     ],
     [
      8.75,
      0.12,
      "C6",
      0.7
     ],
     [
      8.875,
      0.12,
      "C6",
      0.6
     ],
     [
      9,
      0.12,
      "C6",
      0.75
     ],
     [
      9.125,
      0.12,
      "C6",
      0.65
     ],
     [
      9.5,
      0.75,
      "D#6",
      0.9
     ],
     [
      10.5,
      0.5,
      "C6",
      0.8
     ],
     [
      11,
      0.75,
      "G#5",
      0.8
     ],
     [
      12,
      0.5,
      "B5",
      0.85
     ],
     [
      12.75,
      0.5,
      "D6",
      0.8
     ],
     [
      13.5,
      0.75,
      "G6",
      0.95
     ],
     [
      14.5,
      0.12,
      "G6",
      0.7
     ],
     [
      14.625,
      0.12,
      "G6",
      0.6
     ],
     [
      14.75,
      0.12,
      "G6",
      0.75
     ],
     [
      14.875,
      0.12,
      "G6",
      0.8
     ],
     [
      15,
      0.9,
      "B5",
      0.8
     ]
    ]
   }
  },
  {
   "id": "juicy-b",
   "name": "🍑 Лид B (вторая половина +окт.)",
   "color": "#ffb3d9",
   "sig": "4/4",
   "notes": {
    "juicy": [
     [
      0,
      0.5,
      "G5",
      0.85
     ],
     [
      0.75,
      0.25,
      "G5",
      0.6
     ],
     [
      1,
      0.5,
      "D#5",
      0.8
     ],
     [
      1.5,
      1,
      "C6",
      0.9
     ],
     [
      2.75,
      0.25,
      "A#5",
      0.65
     ],
     [
      3,
      0.75,
      "G5",
      0.8
     ],
     [
      4,
      0.5,
      "A#5",
      0.85
     ],
     [
      4.75,
      0.5,
      "G5",
      0.7
     ],
     [
      5.5,
      0.5,
      "D#6",
      0.9
     ],
     [
      6.5,
      0.25,
      "D6",
      0.65
     ],
     [
      6.75,
      1.1,
      "D#6",
      0.85,
      0,
      2
     ],
     [
      8,
      0.5,
      "C7",
      0.85
     ],
     [
      8.75,
      0.12,
      "C7",
      0.7
     ],
     [
      8.875,
      0.12,
      "C7",
      0.6
     ],
     [
      9,
      0.12,
      "C7",
      0.75
     ],
     [
      9.125,
      0.12,
      "C7",
      0.65
     ],
     [
      9.5,
      0.75,
      "D#7",
      0.9
     ],
     [
      10.5,
      0.5,
      "C7",
      0.8
     ],
     [
      11,
      0.75,
      "G#6",
      0.8
     ],
     [
      12,
      0.5,
      "B6",
      0.85
     ],
     [
      12.75,
      0.5,
      "D7",
      0.8
     ],
     [
      13.5,
      0.75,
      "G7",
      0.95
     ],
     [
      14.5,
      0.12,
      "G7",
      0.7
     ],
     [
      14.625,
      0.12,
      "G7",
      0.6
     ],
     [
      14.75,
      0.12,
      "G7",
      0.75
     ],
     [
      14.875,
      0.12,
      "G7",
      0.8
     ],
     [
      15,
      0.9,
      "B6",
      0.8
     ]
    ]
   }
  },
  {
   "id": "pluck16",
   "name": "🍑 Плак по аккордам",
   "color": "#fff09e",
   "sig": "4/4",
   "notes": {
    "arp": [
     [
      0.0,
      0.2,
      "C5",
      0.75
     ],
     [
      0.25,
      0.2,
      "D#5",
      0.55
     ],
     [
      0.5,
      0.2,
      "G5",
      0.45
     ],
     [
      0.75,
      0.2,
      "C6",
      0.55
     ],
     [
      1.0,
      0.2,
      "G5",
      0.75
     ],
     [
      1.25,
      0.2,
      "D#5",
      0.55
     ],
     [
      1.5,
      0.2,
      "C5",
      0.45
     ],
     [
      1.75,
      0.2,
      "D#5",
      0.55
     ],
     [
      2.0,
      0.2,
      "G5",
      0.75
     ],
     [
      2.25,
      0.2,
      "C6",
      0.55
     ],
     [
      2.5,
      0.2,
      "G5",
      0.45
     ],
     [
      2.75,
      0.2,
      "D#5",
      0.55
     ],
     [
      3.0,
      0.2,
      "C5",
      0.75
     ],
     [
      3.25,
      0.2,
      "D#5",
      0.55
     ],
     [
      3.5,
      0.2,
      "G5",
      0.45
     ],
     [
      3.75,
      0.2,
      "C6",
      0.55
     ],
     [
      4.0,
      0.2,
      "D#5",
      0.75
     ],
     [
      4.25,
      0.2,
      "G5",
      0.55
     ],
     [
      4.5,
      0.2,
      "A#5",
      0.45
     ],
     [
      4.75,
      0.2,
      "D#6",
      0.55
     ],
     [
      5.0,
      0.2,
      "A#5",
      0.75
     ],
     [
      5.25,
      0.2,
      "G5",
      0.55
     ],
     [
      5.5,
      0.2,
      "D#5",
      0.45
     ],
     [
      5.75,
      0.2,
      "G5",
      0.55
     ],
     [
      6.0,
      0.2,
      "A#5",
      0.75
     ],
     [
      6.25,
      0.2,
      "D#6",
      0.55
     ],
     [
      6.5,
      0.2,
      "A#5",
      0.45
     ],
     [
      6.75,
      0.2,
      "G5",
      0.55
     ],
     [
      7.0,
      0.2,
      "D#5",
      0.75
     ],
     [
      7.25,
      0.2,
      "G5",
      0.55
     ],
     [
      7.5,
      0.2,
      "A#5",
      0.45
     ],
     [
      7.75,
      0.2,
      "D#6",
      0.55
     ],
     [
      8.0,
      0.2,
      "G#4",
      0.75
     ],
     [
      8.25,
      0.2,
      "C5",
      0.55
     ],
     [
      8.5,
      0.2,
      "D#5",
      0.45
     ],
     [
      8.75,
      0.2,
      "G#5",
      0.55
     ],
     [
      9.0,
      0.2,
      "D#5",
      0.75
     ],
     [
      9.25,
      0.2,
      "C5",
      0.55
     ],
     [
      9.5,
      0.2,
      "G#4",
      0.45
     ],
     [
      9.75,
      0.2,
      "C5",
      0.55
     ],
     [
      10.0,
      0.2,
      "D#5",
      0.75
     ],
     [
      10.25,
      0.2,
      "G#5",
      0.55
     ],
     [
      10.5,
      0.2,
      "D#5",
      0.45
     ],
     [
      10.75,
      0.2,
      "C5",
      0.55
     ],
     [
      11.0,
      0.2,
      "G#4",
      0.75
     ],
     [
      11.25,
      0.2,
      "C5",
      0.55
     ],
     [
      11.5,
      0.2,
      "D#5",
      0.45
     ],
     [
      11.75,
      0.2,
      "G#5",
      0.55
     ],
     [
      12.0,
      0.2,
      "B4",
      0.75
     ],
     [
      12.25,
      0.2,
      "D5",
      0.55
     ],
     [
      12.5,
      0.2,
      "G5",
      0.45
     ],
     [
      12.75,
      0.2,
      "B5",
      0.55
     ],
     [
      13.0,
      0.2,
      "G5",
      0.75
     ],
     [
      13.25,
      0.2,
      "D5",
      0.55
     ],
     [
      13.5,
      0.2,
      "B4",
      0.45
     ],
     [
      13.75,
      0.2,
      "D5",
      0.55
     ],
     [
      14.0,
      0.2,
      "G5",
      0.75
     ],
     [
      14.25,
      0.2,
      "B5",
      0.55
     ],
     [
      14.5,
      0.2,
      "G5",
      0.45
     ],
     [
      14.75,
      0.2,
      "D5",
      0.55
     ],
     [
      15.0,
      0.2,
      "B4",
      0.75
     ],
     [
      15.25,
      0.2,
      "D5",
      0.55
     ],
     [
      15.5,
      0.2,
      "G5",
      0.45
     ],
     [
      15.75,
      0.2,
      "B5",
      0.55
     ]
    ]
   }
  },
  {
   "id": "pluck16-in",
   "name": "🍑 Плак (нарастает)",
   "color": "#fff09e",
   "sig": "4/4",
   "notes": {
    "arp": [
     [
      0.0,
      0.2,
      "C5",
      0.15
     ],
     [
      0.25,
      0.2,
      "D#5",
      0.117
     ],
     [
      0.5,
      0.2,
      "G5",
      0.101
     ],
     [
      0.75,
      0.2,
      "C6",
      0.131
     ],
     [
      1.0,
      0.2,
      "G5",
      0.188
     ],
     [
      1.25,
      0.2,
      "D#5",
      0.144
     ],
     [
      1.5,
      0.2,
      "C5",
      0.124
     ],
     [
      1.75,
      0.2,
      "D#5",
      0.158
     ],
     [
      2.0,
      0.2,
      "G5",
      0.225
     ],
     [
      2.25,
      0.2,
      "C6",
      0.172
     ],
     [
      2.5,
      0.2,
      "G5",
      0.146
     ],
     [
      2.75,
      0.2,
      "D#5",
      0.186
     ],
     [
      3.0,
      0.2,
      "C5",
      0.263
     ],
     [
      3.25,
      0.2,
      "D#5",
      0.199
     ],
     [
      3.5,
      0.2,
      "G5",
      0.169
     ],
     [
      3.75,
      0.2,
      "C6",
      0.213
     ],
     [
      4.0,
      0.2,
      "D#5",
      0.3
     ],
     [
      4.25,
      0.2,
      "G5",
      0.227
     ],
     [
      4.5,
      0.2,
      "A#5",
      0.191
     ],
     [
      4.75,
      0.2,
      "D#6",
      0.241
     ],
     [
      5.0,
      0.2,
      "A#5",
      0.338
     ],
     [
      5.25,
      0.2,
      "G5",
      0.254
     ],
     [
      5.5,
      0.2,
      "D#5",
      0.214
     ],
     [
      5.75,
      0.2,
      "G5",
      0.268
     ],
     [
      6.0,
      0.2,
      "A#5",
      0.375
     ],
     [
      6.25,
      0.2,
      "D#6",
      0.282
     ],
     [
      6.5,
      0.2,
      "A#5",
      0.236
     ],
     [
      6.75,
      0.2,
      "G5",
      0.296
     ],
     [
      7.0,
      0.2,
      "D#5",
      0.413
     ],
     [
      7.25,
      0.2,
      "G5",
      0.309
     ],
     [
      7.5,
      0.2,
      "A#5",
      0.259
     ],
     [
      7.75,
      0.2,
      "D#6",
      0.323
     ],
     [
      8.0,
      0.2,
      "G#4",
      0.45
     ],
     [
      8.25,
      0.2,
      "C5",
      0.337
     ],
     [
      8.5,
      0.2,
      "D#5",
      0.281
     ],
     [
      8.75,
      0.2,
      "G#5",
      0.351
     ],
     [
      9.0,
      0.2,
      "D#5",
      0.488
     ],
     [
      9.25,
      0.2,
      "C5",
      0.364
     ],
     [
      9.5,
      0.2,
      "G#4",
      0.304
     ],
     [
      9.75,
      0.2,
      "C5",
      0.378
     ],
     [
      10.0,
      0.2,
      "D#5",
      0.525
     ],
     [
      10.25,
      0.2,
      "G#5",
      0.392
     ],
     [
      10.5,
      0.2,
      "D#5",
      0.326
     ],
     [
      10.75,
      0.2,
      "C5",
      0.406
     ],
     [
      11.0,
      0.2,
      "G#4",
      0.562
     ],
     [
      11.25,
      0.2,
      "C5",
      0.419
     ],
     [
      11.5,
      0.2,
      "D#5",
      0.349
     ],
     [
      11.75,
      0.2,
      "G#5",
      0.433
     ],
     [
      12.0,
      0.2,
      "B4",
      0.6
     ],
     [
      12.25,
      0.2,
      "D5",
      0.447
     ],
     [
      12.5,
      0.2,
      "G5",
      0.371
     ],
     [
      12.75,
      0.2,
      "B5",
      0.461
     ],
     [
      13.0,
      0.2,
      "G5",
      0.638
     ],
     [
      13.25,
      0.2,
      "D5",
      0.474
     ],
     [
      13.5,
      0.2,
      "B4",
      0.394
     ],
     [
      13.75,
      0.2,
      "D5",
      0.488
     ],
     [
      14.0,
      0.2,
      "G5",
      0.675
     ],
     [
      14.25,
      0.2,
      "B5",
      0.502
     ],
     [
      14.5,
      0.2,
      "G5",
      0.416
     ],
     [
      14.75,
      0.2,
      "D5",
      0.516
     ],
     [
      15.0,
      0.2,
      "B4",
      0.712
     ],
     [
      15.25,
      0.2,
      "D5",
      0.529
     ],
     [
      15.5,
      0.2,
      "G5",
      0.439
     ],
     [
      15.75,
      0.2,
      "B5",
      0.543
     ]
    ]
   }
  },
  {
   "id": "pad-in",
   "name": "🍑 Пэд (нарастает)",
   "color": "#c3a6ff",
   "sig": "4/4",
   "notes": {
    "grapefruit": [
     [
      0,
      3.9,
      "C4",
      0.193
     ],
     [
      0,
      3.9,
      "D#4",
      0.193
     ],
     [
      0,
      3.9,
      "G4",
      0.193
     ],
     [
      4,
      3.9,
      "D#4",
      0.312
     ],
     [
      4,
      3.9,
      "G4",
      0.312
     ],
     [
      4,
      3.9,
      "A#4",
      0.312
     ],
     [
      8,
      3.9,
      "G#3",
      0.431
     ],
     [
      8,
      3.9,
      "C4",
      0.431
     ],
     [
      8,
      3.9,
      "D#4",
      0.431
     ],
     [
      12,
      3.9,
      "B3",
      0.55
     ],
     [
      12,
      3.9,
      "D4",
      0.55
     ],
     [
      12,
      3.9,
      "G4",
      0.55
     ]
    ]
   }
  },
  {
   "id": "pad",
   "name": "🍑 Пэд",
   "color": "#c3a6ff",
   "sig": "4/4",
   "notes": {
    "grapefruit": [
     [
      0,
      3.9,
      "C4",
      0.55
     ],
     [
      0,
      3.9,
      "D#4",
      0.55
     ],
     [
      0,
      3.9,
      "G4",
      0.55
     ],
     [
      4,
      3.9,
      "D#4",
      0.55
     ],
     [
      4,
      3.9,
      "G4",
      0.55
     ],
     [
      4,
      3.9,
      "A#4",
      0.55
     ],
     [
      8,
      3.9,
      "G#3",
      0.55
     ],
     [
      8,
      3.9,
      "C4",
      0.55
     ],
     [
      8,
      3.9,
      "D#4",
      0.55
     ],
     [
      12,
      3.9,
      "B3",
      0.55
     ],
     [
      12,
      3.9,
      "D4",
      0.55
     ],
     [
      12,
      3.9,
      "G4",
      0.55
     ]
    ]
   }
  },
  {
   "id": "pad-out",
   "name": "🍑 Пэд (затихает)",
   "color": "#c3a6ff",
   "sig": "4/4",
   "notes": {
    "grapefruit": [
     [
      0,
      3.9,
      "C4",
      0.55
     ],
     [
      0,
      3.9,
      "D#4",
      0.55
     ],
     [
      0,
      3.9,
      "G4",
      0.55
     ],
     [
      4,
      3.9,
      "D#4",
      0.428
     ],
     [
      4,
      3.9,
      "G4",
      0.428
     ],
     [
      4,
      3.9,
      "A#4",
      0.428
     ],
     [
      8,
      3.9,
      "G#3",
      0.306
     ],
     [
      8,
      3.9,
      "C4",
      0.306
     ],
     [
      8,
      3.9,
      "D#4",
      0.306
     ],
     [
      12,
      3.9,
      "B3",
      0.183
     ],
     [
      12,
      3.9,
      "D4",
      0.183
     ],
     [
      12,
      3.9,
      "G4",
      0.183
     ]
    ]
   }
  },
  {
   "id": "riser-64",
   "name": "🍑 Райзер перед 64",
   "color": "#ffb3b3",
   "sig": "4/4",
   "notes": {
    "riser": [
     [
      8,
      7.5,
      "C4",
      0.8
     ]
    ]
   }
  }
 ],
 "playlist": [
  {
   "pattern": "break2",
   "track": 5,
   "start": 0,
   "length": 16
  },
  {
   "pattern": "build-22",
   "track": 3,
   "start": 0,
   "length": 16
  },
  {
   "pattern": "drop-d2-var2",
   "track": 4,
   "start": 16,
   "length": 16
  },
  {
   "pattern": "drop-d2-sauce2",
   "track": 4,
   "start": 48,
   "length": 16
  },
  {
   "pattern": "drop-d2-2-срыв-в2",
   "track": 4,
   "start": 64,
   "length": 16
  },
  {
   "pattern": "drop-d2-2-пробеж2",
   "track": 4,
   "start": 80,
   "length": 16
  },
  {
   "pattern": "drop-d2-2-срыв-в2",
   "track": 4,
   "start": 96,
   "length": 16
  },
  {
   "pattern": "drop-d2-3-holes2",
   "track": 5,
   "start": 32,
   "length": 16
  },
  {
   "pattern": "drop-d2-3-пробеж2",
   "track": 5,
   "start": 112,
   "length": 16
  },
  {
   "pattern": "impact2",
   "track": 3,
   "start": 16,
   "length": 1
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 72,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 76,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 80,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 84,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 88,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 92,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 96,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 100,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 104,
   "length": 4
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 108,
   "length": 4
  },
  {
   "pattern": "kick-in",
   "track": 7,
   "start": 48,
   "length": 16
  },
  {
   "pattern": "impact2",
   "track": 7,
   "start": 64,
   "length": 1
  },
  {
   "pattern": "impact2",
   "track": 7,
   "start": 96,
   "length": 1
  },
  {
   "pattern": "pattern171",
   "track": 6,
   "start": 64,
   "length": 4
  },
  {
   "pattern": "impact2",
   "track": 7,
   "start": 128,
   "length": 1
  },
  {
   "pattern": "outro-fade",
   "track": 5,
   "start": 128,
   "length": 16
  },
  {
   "pattern": "pad-in",
   "track": 8,
   "start": 0,
   "length": 16
  },
  {
   "pattern": "pluck16-in",
   "track": 9,
   "start": 0,
   "length": 16
  },
  {
   "pattern": "pluck16",
   "track": 9,
   "start": 16,
   "length": 16
  },
  {
   "pattern": "juicy-a",
   "track": 10,
   "start": 32,
   "length": 16
  },
  {
   "pattern": "pad",
   "track": 8,
   "start": 32,
   "length": 16
  },
  {
   "pattern": "juicy-b",
   "track": 10,
   "start": 48,
   "length": 16
  },
  {
   "pattern": "riser-64",
   "track": 11,
   "start": 48,
   "length": 16
  },
  {
   "pattern": "juicy-a",
   "track": 10,
   "start": 64,
   "length": 16
  },
  {
   "pattern": "pad",
   "track": 8,
   "start": 64,
   "length": 16
  },
  {
   "pattern": "pluck16",
   "track": 9,
   "start": 80,
   "length": 16
  },
  {
   "pattern": "juicy-b",
   "track": 10,
   "start": 96,
   "length": 16
  },
  {
   "pattern": "pad",
   "track": 8,
   "start": 96,
   "length": 16
  },
  {
   "pattern": "juicy-b",
   "track": 10,
   "start": 112,
   "length": 16
  },
  {
   "pattern": "pluck16",
   "track": 9,
   "start": 112,
   "length": 16
  },
  {
   "pattern": "pad-out",
   "track": 8,
   "start": 128,
   "length": 16
  }
 ],
 "mixer": [
  {
   "name": "Master",
   "vol": 0.85,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 35,
     "lg": 0,
     "mf": 350,
     "mg": -1.5,
     "mq": 0.8,
     "hf": 9000,
     "hg": 2.5
    }
   ]
  },
  {
   "name": "Kick",
   "color": "#9fd3ff",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 55,
     "lg": 4,
     "mf": 350,
     "mg": -4,
     "mq": 1,
     "hf": 4500,
     "hg": 3
    },
    {
     "type": "dist",
     "on": true,
     "drive": 0.35,
     "shape": 1,
     "tone": 1212.8088,
     "mix": 0.6,
     "out": 0.75
    },
    {
     "type": "comp",
     "on": true,
     "thresh": -14,
     "ratio": 4,
     "attack": 0.012,
     "release": 0.12,
     "gain": 4
    },
    {
     "type": "eq",
     "on": true,
     "lf": 372.7534,
     "lg": -18,
     "mf": 1000,
     "mg": 0,
     "mq": 1,
     "hf": 6000,
     "hg": 0
    }
   ]
  },
  {
   "name": "Snare",
   "color": "#fff09e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 190,
     "lg": 3,
     "mf": 900,
     "mg": -2,
     "mq": 1,
     "hf": 6000,
     "hg": 4
    },
    {
     "type": "dist",
     "on": true,
     "drive": 0.3,
     "shape": 0,
     "tone": 10000,
     "mix": 0.5,
     "out": 0.75
    },
    {
     "type": "comp",
     "on": true,
     "thresh": -16,
     "ratio": 5,
     "attack": 0.003,
     "release": 0.1,
     "gain": 5
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 0.9,
     "pre": 0.01,
     "damp": 7000,
     "low": 300,
     "mix": 0.18
    }
   ]
  },
  {
   "name": "Hat",
   "color": "#ffb3b3",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 400,
     "lg": -10,
     "mf": 3000,
     "mg": -1,
     "mq": 1,
     "hf": 9000,
     "hg": 4
    },
    {
     "type": "ott",
     "on": true,
     "depth": 0.5,
     "time": 1,
     "low": 0,
     "mid": 0,
     "high": 3,
     "out": 0.9
    },
    {
     "type": "delay",
     "on": true,
     "sync": 0,
     "fb": 0.15,
     "mix": 0.08,
     "damp": 5000,
     "pp": 1
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 0.6,
     "pre": 0.02,
     "damp": 7000,
     "low": 500,
     "mix": 0.12
    }
   ]
  },
  {
   "name": "Neuro stab",
   "color": "#b8f59e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "delay",
     "on": true,
     "sync": 4,
     "fb": 0.4,
     "mix": 0.25,
     "damp": 5000,
     "pp": 1
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 4,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.35
    }
   ]
  },
  {
   "name": "Grapefruit",
   "color": "#ff9ecf",
   "vol": 1.25,
   "pan": 0,
   "fx": [
    {
     "type": "reverb",
     "on": true,
     "decay": 5,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.4
    }
   ]
  },
  {
   "name": "Grapefruit",
   "color": "#c3a6ff",
   "vol": 0.8,
   "pan": 0,
   "fx": []
  },
  {
   "name": "Open hat",
   "color": "#8fe8cf",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 400,
     "lg": -10,
     "mf": 3000,
     "mg": -1,
     "mq": 1,
     "hf": 9000,
     "hg": 4
    },
    {
     "type": "ott",
     "on": true,
     "depth": 0.5,
     "time": 1,
     "low": 0,
     "mid": 0,
     "high": 3,
     "out": 0.9
    },
    {
     "type": "delay",
     "on": true,
     "sync": 0,
     "fb": 0.15,
     "mix": 0.08,
     "damp": 5000,
     "pp": 1
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 0.6,
     "pre": 0.02,
     "damp": 7000,
     "low": 500,
     "mix": 0.12
    }
   ]
  },
  {
   "name": "Neuro",
   "color": "#ffc59e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.6,
     "shape": 2,
     "tone": 8000,
     "mix": 1,
     "out": 0.6
    },
    {
     "type": "ott",
     "on": true,
     "depth": 0.8,
     "time": 1,
     "low": -4,
     "mid": 0,
     "high": 4,
     "out": 0.9
    },
    {
     "type": "eq",
     "on": true,
     "lf": 60,
     "lg": 2,
     "mf": 500,
     "mg": -3,
     "mq": 1,
     "hf": 7000,
     "hg": 1
    }
   ]
  },
  {
   "name": "Acid",
   "color": "#9fd3ff",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 120,
     "lg": -10,
     "mf": 900,
     "mg": 1,
     "mq": 1,
     "hf": 7000,
     "hg": 0
    }
   ]
  },
  {
   "name": "Insert 10",
   "color": "#fff09e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.0736,
     "shape": 1,
     "tone": 5560.2426,
     "mix": 1,
     "out": 0.7
    },
    {
     "type": "eq",
     "on": true,
     "lf": 120,
     "lg": -10,
     "mf": 900,
     "mg": 1,
     "mq": 1,
     "hf": 7000,
     "hg": 0
    },
    {
     "type": "eq",
     "on": true,
     "lf": 120,
     "lg": 0,
     "mf": 200.0522,
     "mg": -0.0288,
     "mq": 1,
     "hf": 2743.6782,
     "hg": -18
    }
   ]
  },
  {
   "name": "Swap ✨",
   "color": "#ffb3b3",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.3,
     "shape": 0,
     "tone": 9000,
     "mix": 0.5,
     "out": 0.7
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 1.8,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.15
    }
   ]
  },
  {
   "name": "Wub D1.2 ✨",
   "color": "#b8f59e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.3,
     "shape": 0,
     "tone": 9000,
     "mix": 0.5,
     "out": 0.7
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 1.8,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.15
    }
   ]
  },
  {
   "name": "Wub D1.3 ✨",
   "color": "#ff9ecf",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.45,
     "shape": 0,
     "tone": 6000,
     "mix": 0.8,
     "out": 0.7
    },
    {
     "type": "ott",
     "on": true,
     "depth": 0.6,
     "time": 1,
     "low": 0,
     "mid": 0,
     "high": 3,
     "out": 0.9
    },
    {
     "type": "eq",
     "on": true,
     "lf": 45,
     "lg": 2,
     "mf": 300,
     "mg": -3,
     "mq": 1,
     "hf": 6000,
     "hg": -2
    }
   ]
  },
  {
   "name": "Wub D2 ✨",
   "color": "#c3a6ff",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.3,
     "shape": 0,
     "tone": 9000,
     "mix": 0.5,
     "out": 0.7
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 1.8,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.15
    }
   ]
  },
  {
   "name": "Wub D2.2 ✨",
   "color": "#8fe8cf",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 1,
     "shape": 3,
     "tone": 400,
     "mix": 1,
     "out": 0.75
    },
    {
     "type": "ott",
     "on": true,
     "depth": 1,
     "time": 0.4,
     "low": 0,
     "mid": 0,
     "high": 5,
     "out": 0.9
    },
    {
     "type": "eq",
     "on": true,
     "lf": 50,
     "lg": 2,
     "mf": 2500,
     "mg": 4,
     "mq": 2,
     "hf": 9000,
     "hg": -2
    }
   ]
  },
  {
   "name": "Wub D2.3 ✨",
   "color": "#ffc59e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.8744,
     "shape": 3,
     "tone": 500,
     "mix": 1,
     "out": 1.2386
    }
   ]
  },
  {
   "name": "Melodic",
   "color": "#ffc6e0",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 250,
     "lg": -12,
     "mf": 800,
     "mg": -1,
     "mq": 1,
     "hf": 7000,
     "hg": 3
    },
    {
     "type": "delay",
     "on": true,
     "sync": 3,
     "fb": 0.32,
     "mix": 0.22,
     "damp": 5000,
     "pp": 1
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 2.4,
     "pre": 0.02,
     "damp": 7000,
     "low": 250,
     "mix": 0.22
    }
   ]
  }
 ],
 "mods": [
  {
   "id": "pacid-250",
   "type": "trig",
   "name": "Grind to end",
   "color": "#ffc59e",
   "trig": {
    "ch": "acid-25",
    "att": 400,
    "hold": 300,
    "rel": 200,
    "vel": true
   },
   "wires": [
    {
     "to": "mix.15.0.tone",
     "amt": 0.85
    },
    {
     "to": "ch.acid-25.res",
     "amt": 0.25
    }
   ]
  },
  {
   "id": "pacid-260",
   "type": "trig",
   "name": "Metal tone",
   "color": "#9fd3ff",
   "trig": {
    "ch": "acid-26",
    "att": 72.5,
    "hold": 77.3,
    "rel": 250,
    "vel": true
   },
   "wires": [
    {
     "to": "mix.16.0.tone",
     "amt": 0.5
    }
   ]
  },
  {
   "id": "mbuildw2c",
   "type": "env",
   "name": "✨ Build sweep",
   "color": "#ffb3b3",
   "env": {
    "len": 176,
    "loop": false,
    "pts": [
     [
      0,
      0
     ],
     [
      3.72,
      0.1
     ],
     [
      15.5,
      1
     ],
     [
      15.51,
      0
     ],
     [
      176,
      0
     ]
    ]
   },
   "wires": [
    {
     "to": "ch.riser.cut",
     "amt": 0.45
    },
    {
     "to": "ch.lead-24.cut",
     "amt": 0.35
    }
   ]
  },
  {
   "id": "ajhj3iw",
   "type": "env",
   "name": "📈 EQ lf",
   "color": "#ffc59e",
   "env": {
    "len": 16.01,
    "loop": false,
    "pts": [
     [
      0,
      0
     ],
     [
      2,
      0.016
     ],
     [
      4,
      0.063
     ],
     [
      6,
      0.141
     ],
     [
      8,
      0.25
     ],
     [
      10,
      0.391
     ],
     [
      12,
      0.563
     ],
     [
      14,
      0.766
     ],
     [
      16,
      1
     ],
     [
      16.01,
      0.987
     ]
    ]
   },
   "wires": [
    {
     "to": "mix.1.3.lf",
     "amt": -0.511
    }
   ]
  },
  {
   "id": "ahw5qee",
   "type": "env",
   "name": "📈 EQ mg",
   "color": "#9fd3ff",
   "env": {
    "len": 16.01,
    "loop": false,
    "pts": [
     [
      0,
      0
     ],
     [
      0.25,
      0
     ],
     [
      15.75,
      0.257
     ]
    ]
   },
   "wires": [
    {
     "to": "mix.10.2.mg",
     "amt": 0.426
    }
   ]
  },
  {
   "id": "mdeep",
   "type": "env",
   "name": "📈 Бас из глубины",
   "color": "#9fd3ff",
   "value": 0,
   "env": {
    "len": 144,
    "loop": false,
    "pts": [
     [
      0,
      1
     ],
     [
      8,
      0.85
     ],
     [
      16,
      0.55
     ],
     [
      24,
      0.25
     ],
     [
      32,
      0
     ],
     [
      58,
      0
     ],
     [
      63.5,
      0.75
     ],
     [
      64,
      0
     ],
     [
      144,
      0
     ]
    ]
   },
   "lfo": {
    "sync": 3,
    "shape": "sine",
    "phase": 0
   },
   "trig": {},
   "meter": {},
   "wind": {},
   "wires": [
    {
     "to": "ch.sub-acid.vol",
     "amt": -0.55
    },
    {
     "to": "ch.sub-acid.cut",
     "amt": -0.012
    },
    {
     "to": "ch.lead-24.cut",
     "amt": -0.25
    },
    {
     "to": "ch.lead-25.cut",
     "amt": -0.25
    },
    {
     "to": "ch.lead-26.cut",
     "amt": -0.25
    },
    {
     "to": "ch.lead-grind-fifth.cut",
     "amt": -0.25
    }
   ]
  }
 ],
 "layout": {
  "transport": [
   12,
   60,
   1070.4,
   429.6,
   1
  ],
  "rack": [
   93.7333,
   100.333,
   1899.4,
   868,
   1
  ],
  "piano": [
   780,
   250,
   900,
   540,
   1
  ],
  "playlist": [
   94,
   348,
   2016.6,
   654.867,
   1
  ],
  "lib": [
   650,
   142,
   847.133,
   961.267,
   1
  ],
  "inst:kick": [
   729.5,
   271.5,
   560,
   400,
   1
  ],
  "inst:snare": [
   757.5,
   299.5,
   560,
   400,
   1
  ],
  "inst:grapefruit": [
   657.5,
   179.5,
   760,
   640,
   1
  ],
  "inst:neuro-stab": [
   685.5,
   207.5,
   760,
   640,
   1
  ],
  "inst:neuro": [
   713.5,
   235.5,
   760,
   640,
   1
  ],
  "inst:sub-acid": [
   812,
   264,
   1250.93,
   612,
   1
  ],
  "mixer": [
   137.067,
   425.867,
   900,
   470,
   1
  ],
  "magic": [
   464.6,
   250,
   560,
   640,
   1
  ],
  "inst:lead-24": [
   867.5,
   319.5,
   620,
   640,
   1
  ],
  "inst:lead-26": [
   895.5,
   347.5,
   620,
   640,
   1
  ],
  "inst:lead-2": [
   700,
   152,
   838.4,
   724,
   1
  ]
 }
};
