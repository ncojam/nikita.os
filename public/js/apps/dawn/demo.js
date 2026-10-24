/* ================= DAWN — демо-трек =================
 * Открывается при запуске DAWN (кнопка ✚ — пустой трек). «Riddim 8/8» — риддим на 140: бас 3XOSC с crush и
 * медленной атакой, стабы, свеллы, пэд с сайдчейном от бочки; огибающие Highs up / Attack morph раскрывают
 * верха и меняют атаку по ходу трека (их видно полосами под дорожками плейлиста), клэп трясёт окна ОС.
 * Прошлое демо «Bayati in 7/8» лежит в /home/nikita/Projects (seed/ → fs/ при deploy).
 */
export const DEMO = {
 "format": "dawn/2",
 "name": "Riddim 8/8",
 "bpm": 140,
 "swing": 0.04,
 "mode": "song",
 "current": "drop3",
 "channels": [
  {
   "id": "kick",
   "type": "sampler",
   "name": "Kick",
   "color": "#ff9ecf",
   "vol": 0.962,
   "pan": -0.0104,
   "mixer": 1,
   "sample": "builtin:kick",
   "flash": "#fff05f",
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
   "id": "clap",
   "type": "sampler",
   "name": "Clap",
   "color": "#c3a6ff",
   "vol": 0.7,
   "pan": 0,
   "mixer": 2,
   "sample": "builtin:clap",
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
   "color": "#8fe8cf",
   "vol": 0.65,
   "pan": 0,
   "mixer": 2,
   "sample": "builtin:snare",
   "flash": null,
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
   "vol": 0.5,
   "pan": 0,
   "mixer": 3,
   "sample": "builtin:hat",
   "flash": null,
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
   "id": "open-hat",
   "type": "sampler",
   "name": "Open hat",
   "color": "#fff09e",
   "vol": 0.8,
   "pan": 0,
   "mixer": 4,
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
   "id": "3xosc",
   "type": "osc3",
   "name": "3XOSC",
   "color": "#ffb3b3",
   "vol": 0.8,
   "pan": 0,
   "mixer": 7,
   "poly": 1,
   "flash": null,
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
    "att": 0.3775,
    "dec": 0.1273,
    "sus": 0,
    "rel": 0.01,
    "cut": 1249.211,
    "res": 1.2,
    "uni": 1,
    "udet": 20,
    "uspr": 0.9276
   }
  },
  {
   "id": "3xosc-22",
   "type": "osc3",
   "name": "3XOSC 2",
   "color": "#ffb3b3",
   "vol": 0.8,
   "pan": 0,
   "mixer": 0,
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
      "o_vol": 0.208,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.0755,
    "dec": 1.9103,
    "sus": 0.7852,
    "rel": 0.01,
    "cut": 1249.211,
    "res": 1.2,
    "uni": 2,
    "udet": 25.2,
    "uspr": 0.9276
   }
  },
  {
   "id": "3xosc-2",
   "type": "osc3",
   "name": "3XOSC 2",
   "color": "#ffb3b3",
   "vol": 0.8,
   "pan": 0,
   "mixer": 7,
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
    "att": 0.1876,
    "dec": 0.1628,
    "sus": 0,
    "rel": 0.01,
    "cut": 1249.211,
    "res": 1.2,
    "uni": 1,
    "udet": 20,
    "uspr": 0.9276
   }
  },
  {
   "id": "pad",
   "type": "osc3",
   "name": "Pad",
   "color": "#c3a6ff",
   "vol": 0.55,
   "pan": 0,
   "mixer": 6,
   "params": {
    "oscs": [
     {
      "wave": "triangle",
      "o_vol": 0.5,
      "o_crs": 0,
      "o_fin": -5,
      "o_pan": -0.3
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.25,
      "o_crs": 0,
      "o_fin": 5,
      "o_pan": 0.3
     },
     {
      "wave": "sine",
      "o_vol": 0.4,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.6,
    "dec": 1,
    "sus": 0.85,
    "rel": 1.5,
    "cut": 900,
    "res": 0.8,
    "uni": 5,
    "udet": 25,
    "uspr": 1
   }
  },
  {
   "id": "riser",
   "type": "osc3",
   "name": "Riser",
   "color": "#9fd3ff",
   "vol": 0.5,
   "pan": 0,
   "mixer": 8,
   "poly": 4,
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
    "att": 3,
    "dec": 0.5,
    "sus": 1,
    "rel": 0.4,
    "cut": 1500,
    "res": 6,
    "uni": 1,
    "udet": 20,
    "uspr": 0.6
   }
  },
  {
   "id": "stab",
   "type": "osc3",
   "name": "3XOSC Stab",
   "color": "#ff9e7a",
   "vol": 0.8665,
   "pan": 0,
   "mixer": 5,
   "poly": 1,
   "flash": null,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.3,
      "o_crs": 0,
      "o_fin": -6,
      "o_pan": -0.2
     },
     {
      "wave": "square",
      "o_vol": 0.8944,
      "o_crs": -12,
      "o_fin": 6,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.2132,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.004,
    "dec": 0.0977,
    "sus": 0.2652,
    "rel": 0.6136,
    "cut": 1249.211,
    "res": 1.2,
    "uni": 1,
    "udet": 20,
    "uspr": 0.9276
   }
  },
  {
   "id": "3xosc-stab-2",
   "type": "osc3",
   "name": "3XOSC Stab 2",
   "color": "#ff9e7a",
   "vol": 0.8665,
   "pan": 0,
   "mixer": 0,
   "poly": 1,
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.3,
      "o_crs": 0,
      "o_fin": -6,
      "o_pan": -0.2
     },
     {
      "wave": "square",
      "o_vol": 0.8944,
      "o_crs": -12,
      "o_fin": 6,
      "o_pan": 0.2
     },
     {
      "wave": "square",
      "o_vol": 0.234,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.1016,
    "dec": 0.0811,
    "sus": 0.702,
    "rel": 0.6136,
    "cut": 1249.211,
    "res": 1.2,
    "uni": 2,
    "udet": 20,
    "uspr": 0.9276
   }
  },
  {
   "id": "swell",
   "type": "osc3",
   "name": "3XOSC Swell",
   "color": "#ffd59e",
   "vol": 0.6,
   "pan": 0,
   "mixer": 7,
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
    "att": 1.2,
    "dec": 0.5,
    "sus": 0.8,
    "rel": 0.6,
    "cut": 1249.211,
    "res": 1.2,
    "uni": 1,
    "udet": 20,
    "uspr": 0.9276
   }
  }
 ],
 "patterns": [
  {
   "id": "pattern5",
   "name": "Drop A",
   "color": "#9fd3ff",
   "sig": "8/8",
   "notes": {
    "kick": [
     [
      0,
      0.25,
      "C4",
      0.85
     ],
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "clap": [
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "hat": [
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
     ]
    ],
    "3xosc": [
     [
      0,
      1,
      "F2",
      0.85
     ],
     [
      1,
      1,
      "F2",
      0.85
     ],
     [
      2,
      1,
      "F2",
      0.85
     ]
    ],
    "3xosc-2": [
     [
      3,
      0.5,
      "E2",
      0.85
     ],
     [
      3.5,
      0.5,
      "E2",
      0.85
     ]
    ],
    "open-hat": [
     [
      0,
      0.5,
      "C4",
      0.85
     ],
     [
      0.5,
      0.5,
      "C4",
      0.281
     ],
     [
      1,
      0.5,
      "C4",
      0.85
     ],
     [
      1.5,
      0.5,
      "C4",
      0.297
     ],
     [
      2,
      0.5,
      "C4",
      0.85
     ],
     [
      2.5,
      0.5,
      "C4",
      0.297
     ],
     [
      3,
      0.5,
      "C4",
      0.85
     ],
     [
      3.5,
      0.5,
      "C4",
      0.297
     ]
    ],
    "stab": [
     [
      0.5,
      0.25,
      "F6",
      0.85
     ],
     [
      1,
      0.25,
      "E6",
      0.85
     ],
     [
      1.5,
      0.25,
      "D6",
      0.85
     ],
     [
      2,
      0.25,
      "C#6",
      0.85
     ],
     [
      2.5,
      0.25,
      "F6",
      0.85
     ],
     [
      3,
      0.25,
      "E6",
      0.85
     ],
     [
      3.5,
      0.25,
      "D6",
      0.85
     ]
    ]
   }
  },
  {
   "id": "drop2",
   "name": "Drop A var",
   "color": "#8fe8cf",
   "sig": "8/8",
   "notes": {
    "kick": [
     [
      0,
      0.25,
      "C4",
      0.85
     ],
     [
      0.75,
      0.25,
      "C4",
      0.6
     ],
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "clap": [
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "hat": [
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
      3.75,
      0.25,
      "C4",
      0.4
     ]
    ],
    "open-hat": [
     [
      0,
      0.5,
      "C4",
      0.85
     ],
     [
      0.5,
      0.5,
      "C4",
      0.281
     ],
     [
      1,
      0.5,
      "C4",
      0.85
     ],
     [
      1.5,
      0.5,
      "C4",
      0.297
     ],
     [
      2,
      0.5,
      "C4",
      0.85
     ],
     [
      2.5,
      0.5,
      "C4",
      0.297
     ],
     [
      3,
      0.5,
      "C4",
      0.85
     ],
     [
      3.5,
      0.5,
      "C4",
      0.297
     ]
    ],
    "3xosc": [
     [
      0,
      0.75,
      "F2",
      0.85
     ],
     [
      0.75,
      0.25,
      "F2",
      0.7
     ],
     [
      1,
      0.5,
      "F2",
      0.85
     ],
     [
      1.5,
      0.5,
      "F3",
      0.8
     ],
     [
      2,
      1,
      "F2",
      0.85
     ]
    ],
    "3xosc-2": [
     [
      3,
      0.25,
      "E2",
      0.85
     ],
     [
      3.25,
      0.25,
      "E2",
      0.7
     ],
     [
      3.5,
      0.5,
      "D2",
      0.85
     ]
    ],
    "3xosc-22": [
     [
      0,
      0.75,
      "F2",
      0.85
     ],
     [
      0.75,
      0.25,
      "F2",
      0.7
     ],
     [
      1,
      0.5,
      "F2",
      0.85
     ],
     [
      1.5,
      0.5,
      "F3",
      0.8
     ],
     [
      2,
      1,
      "F2",
      0.85
     ]
    ]
   }
  },
  {
   "id": "drop3",
   "name": "Drop B · growl",
   "color": "#ff9e7a",
   "sig": "8/8",
   "notes": {
    "kick": [
     [
      0,
      0.25,
      "C4",
      0.85
     ],
     [
      0.75,
      0.25,
      "C4",
      0.6
     ],
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "clap": [
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "hat": [
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
      3.75,
      0.25,
      "C4",
      0.4
     ]
    ],
    "open-hat": [
     [
      0,
      0.5,
      "C4",
      0.85
     ],
     [
      0.5,
      0.5,
      "C4",
      0.281
     ],
     [
      1,
      0.5,
      "C4",
      0.85
     ],
     [
      1.5,
      0.5,
      "C4",
      0.297
     ],
     [
      2,
      0.5,
      "C4",
      0.85
     ],
     [
      2.5,
      0.5,
      "C4",
      0.297
     ],
     [
      3,
      0.5,
      "C4",
      0.85
     ],
     [
      3.5,
      0.5,
      "C4",
      0.297
     ]
    ],
    "3xosc": [
     [
      0,
      1,
      "F2",
      0.85
     ],
     [
      1,
      1,
      "F2",
      0.85
     ],
     [
      2,
      1,
      "F2",
      0.85
     ]
    ],
    "stab": [
     [
      3,
      0.25,
      "F2",
      0.85
     ],
     [
      3.25,
      0.25,
      "F2",
      0.7
     ],
     [
      3.5,
      0.25,
      "E2",
      0.85
     ],
     [
      3.75,
      0.25,
      "C#2",
      0.9
     ]
    ]
   }
  },
  {
   "id": "fill",
   "name": "Fill",
   "color": "#fff09e",
   "sig": "8/8",
   "notes": {
    "kick": [
     [
      0,
      0.25,
      "C4",
      0.85
     ]
    ],
    "clap": [
     [
      2,
      0.25,
      "C4",
      0.85
     ]
    ],
    "snare": [
     [
      3,
      0.25,
      "C4",
      0.6
     ],
     [
      3.25,
      0.25,
      "C4",
      0.7
     ],
     [
      3.5,
      0.25,
      "C4",
      0.8
     ],
     [
      3.75,
      0.25,
      "C4",
      1
     ]
    ],
    "hat": [
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
     ]
    ],
    "3xosc": [
     [
      0,
      1,
      "F2",
      0.85
     ],
     [
      1,
      1,
      "F2",
      0.85
     ],
     [
      2,
      0.5,
      "D2",
      0.85
     ],
     [
      2.5,
      0.5,
      "C#2",
      0.85
     ]
    ]
   }
  },
  {
   "id": "pad",
   "name": "Pad Dm–A",
   "color": "#c3a6ff",
   "sig": "8/8",
   "length": 8,
   "notes": {
    "pad": [
     [
      0,
      4,
      "D3",
      0.6
     ],
     [
      0,
      4,
      "F3",
      0.6
     ],
     [
      0,
      4,
      "A3",
      0.6
     ],
     [
      4,
      4,
      "C#3",
      0.6
     ],
     [
      4,
      4,
      "E3",
      0.6
     ],
     [
      4,
      4,
      "A3",
      0.6
     ]
    ]
   }
  },
  {
   "id": "hats",
   "name": "Hats",
   "color": "#b8f59e",
   "sig": "8/8",
   "notes": {
    "hat": [
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
     ]
    ],
    "open-hat": [
     [
      0,
      0.5,
      "C4",
      0.85
     ],
     [
      0.5,
      0.5,
      "C4",
      0.281
     ],
     [
      1,
      0.5,
      "C4",
      0.85
     ],
     [
      1.5,
      0.5,
      "C4",
      0.297
     ],
     [
      2,
      0.5,
      "C4",
      0.85
     ],
     [
      2.5,
      0.5,
      "C4",
      0.297
     ],
     [
      3,
      0.5,
      "C4",
      0.85
     ],
     [
      3.5,
      0.5,
      "C4",
      0.297
     ]
    ]
   }
  },
  {
   "id": "build",
   "name": "Build",
   "color": "#ffb3b3",
   "sig": "8/8",
   "length": 8,
   "notes": {
    "kick": [
     [
      0,
      0.25,
      "C4",
      0.7
     ],
     [
      2,
      0.25,
      "C4",
      0.7
     ],
     [
      4,
      0.25,
      "C4",
      0.7
     ],
     [
      6,
      0.25,
      "C4",
      0.7
     ]
    ],
    "snare": [
     [
      0,
      0.25,
      "C4",
      0.35
     ],
     [
      0.5,
      0.25,
      "C4",
      0.37
     ],
     [
      1,
      0.25,
      "C4",
      0.39
     ],
     [
      1.5,
      0.25,
      "C4",
      0.41
     ],
     [
      2,
      0.25,
      "C4",
      0.43
     ],
     [
      2.5,
      0.25,
      "C4",
      0.45
     ],
     [
      3,
      0.25,
      "C4",
      0.47
     ],
     [
      3.5,
      0.25,
      "C4",
      0.49
     ],
     [
      4,
      0.2,
      "C4",
      0.55
     ],
     [
      4.25,
      0.2,
      "C4",
      0.59
     ],
     [
      4.5,
      0.2,
      "C4",
      0.63
     ],
     [
      4.75,
      0.2,
      "C4",
      0.67
     ],
     [
      5,
      0.2,
      "C4",
      0.71
     ],
     [
      5.25,
      0.2,
      "C4",
      0.75
     ],
     [
      5.5,
      0.2,
      "C4",
      0.79
     ],
     [
      5.75,
      0.2,
      "C4",
      0.83
     ],
     [
      6,
      0.1,
      "C4",
      0.8
     ],
     [
      6.125,
      0.1,
      "C4",
      0.812
     ],
     [
      6.25,
      0.1,
      "C4",
      0.824
     ],
     [
      6.375,
      0.1,
      "C4",
      0.836
     ],
     [
      6.5,
      0.1,
      "C4",
      0.848
     ],
     [
      6.625,
      0.1,
      "C4",
      0.86
     ],
     [
      6.75,
      0.1,
      "C4",
      0.872
     ],
     [
      6.875,
      0.1,
      "C4",
      0.884
     ],
     [
      7,
      0.1,
      "C4",
      0.896
     ],
     [
      7.125,
      0.1,
      "C4",
      0.908
     ],
     [
      7.25,
      0.1,
      "C4",
      0.92
     ],
     [
      7.375,
      0.1,
      "C4",
      0.932
     ],
     [
      7.5,
      0.1,
      "C4",
      0.944
     ],
     [
      7.625,
      0.1,
      "C4",
      0.956
     ],
     [
      7.75,
      0.1,
      "C4",
      0.968
     ],
     [
      7.875,
      0.1,
      "C4",
      0.98
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
      0.5
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
      0.5
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
      0.5
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
      0.5
     ],
     [
      4,
      0.25,
      "C4",
      0.5
     ],
     [
      4.5,
      0.25,
      "C4",
      0.5
     ],
     [
      5,
      0.25,
      "C4",
      0.5
     ],
     [
      5.5,
      0.25,
      "C4",
      0.5
     ],
     [
      6,
      0.25,
      "C4",
      0.5
     ],
     [
      6.5,
      0.25,
      "C4",
      0.5
     ],
     [
      7,
      0.25,
      "C4",
      0.5
     ],
     [
      7.5,
      0.25,
      "C4",
      0.5
     ]
    ],
    "riser": [
     [
      0,
      8,
      "C4",
      0.8
     ]
    ],
    "swell": [
     [
      0,
      4,
      "F2",
      0.7
     ],
     [
      4,
      4,
      "E2",
      0.8
     ]
    ]
   }
  },
  {
   "id": "growlbrk",
   "name": "Stab break",
   "color": "#ffc59e",
   "sig": "8/8",
   "notes": {
    "stab": [
     [
      0,
      0.5,
      "F2",
      0.85
     ],
     [
      1.5,
      0.25,
      "E2",
      0.7
     ],
     [
      2,
      1,
      "D2",
      0.85
     ],
     [
      3.5,
      0.5,
      "C#2",
      0.85
     ]
    ],
    "3xosc-stab-2": [
     [
      0,
      0.5,
      "F2",
      0.85
     ],
     [
      1.5,
      0.25,
      "E2",
      0.7
     ],
     [
      2,
      1,
      "D2",
      0.85
     ],
     [
      3.5,
      0.5,
      "C#2",
      0.85
     ]
    ]
   }
  },
  {
   "id": "swellbrk",
   "name": "Swell break",
   "color": "#ffd59e",
   "sig": "8/8",
   "length": 8,
   "notes": {
    "swell": [
     [
      0,
      3,
      "F2",
      0.7
     ],
     [
      3,
      1,
      "E2",
      0.6
     ],
     [
      4,
      3,
      "D2",
      0.7
     ],
     [
      7,
      1,
      "C#2",
      0.6
     ]
    ]
   }
  }
 ],
 "playlist": [
  {
   "pattern": "pad",
   "track": 1,
   "start": 0,
   "length": 8
  },
  {
   "pattern": "pad",
   "track": 1,
   "start": 8,
   "length": 8
  },
  {
   "pattern": "pad",
   "track": 1,
   "start": 56,
   "length": 8
  },
  {
   "pattern": "pad",
   "track": 1,
   "start": 64,
   "length": 8
  },
  {
   "pattern": "pad",
   "track": 1,
   "start": 104,
   "length": 8
  },
  {
   "pattern": "pad",
   "track": 1,
   "start": 112,
   "length": 8
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 0,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 4,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 8,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 12,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 16,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 20,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 56,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 60,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 104,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 108,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 112,
   "length": 4
  },
  {
   "pattern": "hats",
   "track": 2,
   "start": 116,
   "length": 4
  },
  {
   "pattern": "build",
   "track": 3,
   "start": 16,
   "length": 8
  },
  {
   "pattern": "build",
   "track": 3,
   "start": 64,
   "length": 8
  },
  {
   "pattern": "pattern5",
   "track": 4,
   "start": 24,
   "length": 4
  },
  {
   "pattern": "drop2",
   "track": 4,
   "start": 28,
   "length": 4
  },
  {
   "pattern": "pattern5",
   "track": 4,
   "start": 32,
   "length": 4
  },
  {
   "pattern": "fill",
   "track": 4,
   "start": 36,
   "length": 4
  },
  {
   "pattern": "pattern5",
   "track": 4,
   "start": 40,
   "length": 4
  },
  {
   "pattern": "drop2",
   "track": 4,
   "start": 44,
   "length": 4
  },
  {
   "pattern": "pattern5",
   "track": 4,
   "start": 48,
   "length": 4
  },
  {
   "pattern": "fill",
   "track": 4,
   "start": 52,
   "length": 4
  },
  {
   "pattern": "drop3",
   "track": 4,
   "start": 72,
   "length": 4
  },
  {
   "pattern": "drop2",
   "track": 4,
   "start": 76,
   "length": 4
  },
  {
   "pattern": "drop3",
   "track": 4,
   "start": 80,
   "length": 4
  },
  {
   "pattern": "fill",
   "track": 4,
   "start": 84,
   "length": 4
  },
  {
   "pattern": "drop3",
   "track": 4,
   "start": 88,
   "length": 4
  },
  {
   "pattern": "drop2",
   "track": 4,
   "start": 92,
   "length": 4
  },
  {
   "pattern": "drop3",
   "track": 4,
   "start": 96,
   "length": 4
  },
  {
   "pattern": "fill",
   "track": 4,
   "start": 100,
   "length": 4
  },
  {
   "pattern": "growlbrk",
   "track": 5,
   "start": 60,
   "length": 4
  },
  {
   "pattern": "swellbrk",
   "track": 6,
   "start": 56,
   "length": 8
  },
  {
   "pattern": "swellbrk",
   "track": 6,
   "start": 104,
   "length": 8
  }
 ],
 "mixer": [
  {
   "name": "Master",
   "vol": 0.85,
   "pan": 0,
   "fx": []
  },
  {
   "name": "Kick",
   "color": "#9fd3ff",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.136,
     "shape": 1,
     "tone": 2129.6862,
     "mix": 1,
     "out": 0.7
    },
    {
     "type": "eq",
     "on": true,
     "lf": 112.8343,
     "lg": 2.0592,
     "mf": 3924.6211,
     "mg": -12.7296,
     "mq": 4.3799,
     "hf": 6000,
     "hg": 0
    }
   ]
  },
  {
   "name": "Clap",
   "color": "#fff09e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "reverb",
     "on": true,
     "decay": 1.2,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.2
    }
   ]
  },
  {
   "name": "Hat",
   "color": "#ffb3b3",
   "vol": 0.8,
   "pan": 0.15,
   "fx": []
  },
  {
   "name": "Open hat",
   "color": "#b8f59e",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 90,
     "lg": 3,
     "mf": 400,
     "mg": -3,
     "mq": 1,
     "hf": 6000,
     "hg": -2
    }
   ]
  },
  {
   "name": "Stab",
   "color": "#ff9e7a",
   "vol": 0.7,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.682,
     "shape": 3,
     "tone": 800,
     "mix": 1,
     "out": 0.8
    },
    {
     "type": "eq",
     "on": false,
     "lf": 57.531,
     "lg": 0,
     "mf": 287.612,
     "mg": -2,
     "mq": 1,
     "hf": 3000,
     "hg": -4.6896
    }
   ]
  },
  {
   "name": "Pad",
   "color": "#c3a6ff",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "eq",
     "on": true,
     "lf": 250,
     "lg": -10,
     "mf": 1000,
     "mg": 0,
     "mq": 1,
     "hf": 8000,
     "hg": 2
    },
    {
     "type": "reverb",
     "on": true,
     "decay": 6,
     "pre": 0.05,
     "damp": 7000,
     "low": 120,
     "mix": 0.45
    },
    {
     "type": "side",
     "on": true,
     "src": "kick",
     "amount": 0.75,
     "attack": 0.004,
     "release": 0.22
    }
   ]
  },
  {
   "name": "3XOSC",
   "color": "#8fe8cf",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "dist",
     "on": true,
     "drive": 0.7964,
     "shape": 3,
     "tone": 616.409,
     "mix": 1,
     "out": 0.9496
    }
   ]
  },
  {
   "name": "Riser",
   "color": "#9fd3ff",
   "vol": 0.8,
   "pan": 0,
   "fx": [
    {
     "type": "reverb",
     "on": true,
     "decay": 4,
     "pre": 0.02,
     "damp": 7000,
     "low": 120,
     "mix": 0.4
    }
   ]
  }
 ],
 "mods": [
  {
   "id": "padopen",
   "type": "env",
   "name": "Pad filter",
   "color": "#c3a6ff",
   "env": {
    "len": 120,
    "loop": false,
    "pts": [
     [
      0,
      0
     ],
     [
      24,
      0.6
     ],
     [
      56,
      0.2
     ],
     [
      72,
      0.7
     ],
     [
      104,
      0.4
     ],
     [
      120,
      0
     ]
    ]
   },
   "wires": [
    {
     "to": "ch.pad.cut",
     "amt": 0.3
    }
   ]
  },
  {
   "id": "riserf",
   "type": "env",
   "name": "Riser sweep",
   "color": "#9fd3ff",
   "env": {
    "len": 8,
    "loop": true,
    "pts": [
     [
      0,
      0
     ],
     [
      8,
      1
     ]
    ]
   },
   "wires": [
    {
     "to": "ch.riser.cut",
     "amt": 0.45
    }
   ]
  },
  {
   "id": "shake",
   "type": "trig",
   "name": "Clap shake",
   "color": "#fff09e",
   "trig": {
    "ch": "clap",
    "att": 2,
    "hold": 20,
    "rel": 220,
    "vel": true
   },
   "wires": [
    {
     "to": "win.*.shake",
     "amt": 0.2
    }
   ]
  },
  {
   "id": "highs",
   "type": "env",
   "name": "Highs up",
   "color": "#8fe8cf",
   "env": {
    "len": 120,
    "loop": false,
    "pts": [
     [
      0,
      0
     ],
     [
      24,
      0.1
     ],
     [
      40,
      0.25
     ],
     [
      56,
      0.45
     ],
     [
      56.01,
      0.2
     ],
     [
      64,
      0.25
     ],
     [
      72,
      0.7
     ],
     [
      88,
      0.85
     ],
     [
      104,
      1
     ],
     [
      104.01,
      0.3
     ],
     [
      120,
      0
     ]
    ]
   },
   "wires": [
    {
     "to": "mix.7.0.tone",
     "amt": 0.25
    },
    {
     "to": "mix.5.0.tone",
     "amt": 0.3
    },
    {
     "to": "ch.3xosc.cut",
     "amt": 0.12
    },
    {
     "to": "ch.3xosc-2.cut",
     "amt": 0.15
    },
    {
     "to": "ch.stab.cut",
     "amt": 0.15
    }
   ]
  },
  {
   "id": "attack",
   "type": "env",
   "name": "Attack morph",
   "color": "#ffb3b3",
   "env": {
    "len": 120,
    "loop": false,
    "pts": [
     [
      0,
      0
     ],
     [
      16,
      0
     ],
     [
      24,
      1
     ],
     [
      28,
      0
     ],
     [
      64,
      0
     ],
     [
      72,
      1
     ],
     [
      88,
      0.5
     ],
     [
      104,
      1
     ],
     [
      120,
      0
     ]
    ]
   },
   "wires": [
    {
     "to": "ch.3xosc.att",
     "amt": -0.19
    },
    {
     "to": "ch.3xosc-2.att",
     "amt": -0.09
    }
   ]
  },
  {
   "id": "swellatt",
   "type": "env",
   "name": "Swell attack",
   "color": "#ffd59e",
   "env": {
    "len": 8,
    "loop": true,
    "pts": [
     [
      0,
      0
     ],
     [
      4,
      0
     ],
     [
      4.01,
      1
     ],
     [
      8,
      1
     ]
    ]
   },
   "wires": [
    {
     "to": "ch.swell.att",
     "amt": -0.5
    }
   ]
  }
 ]
};
