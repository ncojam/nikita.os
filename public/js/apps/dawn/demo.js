/* ================= DAWN — демо-трек =================
 * Открывается у посетителя при первом запуске (или по ✚ «Новый проект»).
 * 7/8, бас в 24-EDO (макам Баяти), лид в 31-EDO (нейтральный лад), колокольчики в 7-EDO,
 * LFO и огибающая на проводках, ручка Macro тянет сразу бас, лид и… оттенок окон ОС.
 */
export const DEMO = {
 "format": "dawn/2",
 "name": "Bayati in 7/8",
 "bpm": 112,
 "swing": 0.1,
 "mode": "song",
 "current": "groove",
 "channels": [
  {
   "id": "kick",
   "type": "sampler",
   "name": "Kick",
   "sample": "builtin:kick",
   "mixer": 1,
   "vol": 0.95
  },
  {
   "id": "clap",
   "type": "sampler",
   "name": "Clap",
   "sample": "builtin:clap",
   "mixer": 2,
   "vol": 0.7
  },
  {
   "id": "hat",
   "type": "sampler",
   "name": "Hat",
   "sample": "builtin:hat",
   "mixer": 3,
   "vol": 0.5
  },
  {
   "id": "bass",
   "type": "osc3",
   "name": "Bayati Bass",
   "edo": 24,
   "mixer": 4,
   "vol": 0.8,
   "scale": {
    "root": "D",
    "mode": "bayati"
   },
   "params": {
    "oscs": [
     {
      "wave": "sawtooth",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -4,
      "o_pan": 0
     },
     {
      "wave": "square",
      "o_vol": 0.45,
      "o_crs": -12,
      "o_fin": 0,
      "o_pan": 0
     },
     {
      "wave": "sine",
      "o_vol": 0.3,
      "o_crs": 0,
      "o_fin": 4,
      "o_pan": 0
     }
    ],
    "att": 0.004,
    "dec": 0.22,
    "sus": 0.45,
    "rel": 0.08,
    "cut": 950,
    "res": 4
   }
  },
  {
   "id": "lead",
   "type": "osc3",
   "name": "Neutral Lead",
   "edo": 31,
   "mixer": 5,
   "vol": 0.6,
   "pan": 0.1,
   "scale": {
    "root": "5",
    "mode": "neutral"
   },
   "params": {
    "oscs": [
     {
      "wave": "triangle",
      "o_vol": 0.6,
      "o_crs": 0,
      "o_fin": -7,
      "o_pan": -0.3
     },
     {
      "wave": "sawtooth",
      "o_vol": 0.25,
      "o_crs": 0,
      "o_fin": 7,
      "o_pan": 0.3
     },
     {
      "wave": "sine",
      "o_vol": 0.35,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.03,
    "dec": 0.4,
    "sus": 0.6,
    "rel": 0.35,
    "cut": 3800,
    "res": 1.5
   }
  },
  {
   "id": "bells",
   "type": "osc3",
   "name": "7-EDO Bells",
   "edo": 7,
   "mixer": 6,
   "vol": 0.45,
   "pan": -0.2,
   "params": {
    "oscs": [
     {
      "wave": "sine",
      "o_vol": 0.7,
      "o_crs": 0,
      "o_fin": 0,
      "o_pan": -0.4
     },
     {
      "wave": "sine",
      "o_vol": 0.3,
      "o_crs": 19,
      "o_fin": 3,
      "o_pan": 0.4
     },
     {
      "wave": "triangle",
      "o_vol": 0.15,
      "o_crs": 12,
      "o_fin": 0,
      "o_pan": 0
     }
    ],
    "att": 0.002,
    "dec": 0.7,
    "sus": 0,
    "rel": 0.6,
    "cut": 9000,
    "res": 0.7
   }
  }
 ],
 "patterns": [
  {
   "id": "groove",
   "name": "Groove 7/8",
   "sig": "7/8",
   "length": 7,
   "notes": {
    "kick": [
     [
      0,
      0.25,
      "C4",
      1
     ],
     [
      2,
      0.25,
      "C4",
      0.85
     ],
     [
      3.5,
      0.25,
      "C4",
      1
     ],
     [
      5.5,
      0.25,
      "C4",
      0.85
     ],
     [
      6,
      0.25,
      "C4",
      0.7
     ]
    ],
    "clap": [
     [
      1,
      0.25,
      "C4",
      0.8
     ],
     [
      3,
      0.25,
      "C4",
      0.6
     ],
     [
      4.5,
      0.25,
      "C4",
      0.8
     ],
     [
      6.5,
      0.25,
      "C4",
      0.9
     ]
    ],
    "hat": [
     [
      0,
      0.25,
      "C4",
      0.7
     ],
     [
      0.5,
      0.25,
      "C4",
      0.35
     ],
     [
      1,
      0.25,
      "C4",
      0.55
     ],
     [
      1.5,
      0.25,
      "C4",
      0.35
     ],
     [
      2,
      0.25,
      "C4",
      0.7
     ],
     [
      2.5,
      0.25,
      "C4",
      0.35
     ],
     [
      3,
      0.25,
      "C4",
      0.45
     ],
     [
      3.5,
      0.25,
      "C4",
      0.7
     ],
     [
      4,
      0.25,
      "C4",
      0.35
     ],
     [
      4.5,
      0.25,
      "C4",
      0.55
     ],
     [
      5,
      0.25,
      "C4",
      0.35
     ],
     [
      5.5,
      0.25,
      "C4",
      0.7
     ],
     [
      5.75,
      0.25,
      "C4",
      0.3
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
      0.4
     ]
    ]
   }
  },
  {
   "id": "bassline",
   "name": "Bass (24-EDO)",
   "sig": "7/8",
   "length": 7,
   "notes": {
    "bass": [
     [
      0,
      0.45,
      "D2",
      0.95
     ],
     [
      0.5,
      0.45,
      "D3",
      0.55
     ],
     [
      1,
      0.45,
      "D#↑2",
      0.85
     ],
     [
      1.5,
      0.45,
      "F2",
      0.7
     ],
     [
      2,
      0.45,
      "G2",
      0.9
     ],
     [
      2.5,
      0.45,
      "F2",
      0.6
     ],
     [
      3,
      0.45,
      "D#↑2",
      0.75
     ],
     [
      3.5,
      0.45,
      "D2",
      0.95
     ],
     [
      4,
      0.45,
      "A2",
      0.7
     ],
     [
      4.5,
      0.45,
      "A#2",
      0.85
     ],
     [
      5,
      0.45,
      "A2",
      0.65
     ],
     [
      5.5,
      0.45,
      "G2",
      0.9
     ],
     [
      6,
      0.45,
      "F2",
      0.7
     ],
     [
      6.5,
      0.45,
      "D#↑2",
      0.8
     ]
    ]
   }
  },
  {
   "id": "melody",
   "name": "Lead (31-EDO)",
   "sig": "7/8",
   "length": 14,
   "notes": {
    "lead": [
     [
      0,
      1,
      "4:5",
      0.8
     ],
     [
      1,
      0.5,
      "4:9",
      0.7
     ],
     [
      1.5,
      0.5,
      "4:14",
      0.7
     ],
     [
      2,
      1.5,
      "4:18",
      0.85
     ],
     [
      3.5,
      0.5,
      "4:23",
      0.75
     ],
     [
      4,
      0.5,
      "4:18",
      0.7
     ],
     [
      4.5,
      1,
      "4:14",
      0.75
     ],
     [
      5.5,
      1.5,
      "4:9",
      0.8
     ],
     [
      7,
      1,
      "4:14",
      0.8
     ],
     [
      8,
      0.5,
      "4:18",
      0.7
     ],
     [
      8.5,
      0.5,
      "4:23",
      0.75
     ],
     [
      9,
      1,
      "4:27",
      0.85
     ],
     [
      10,
      0.5,
      "5:1",
      0.8
     ],
     [
      10.5,
      1,
      "4:27",
      0.75
     ],
     [
      11.5,
      0.5,
      "4:23",
      0.7
     ],
     [
      12,
      2,
      "4:18",
      0.85
     ]
    ]
   }
  },
  {
   "id": "chimes",
   "name": "Bells (7-EDO)",
   "sig": "7/8",
   "length": 7,
   "notes": {
    "bells": [
     [
      0,
      0.5,
      "5:0",
      0.7
     ],
     [
      0.5,
      0.5,
      "5:2",
      0.5
     ],
     [
      1,
      0.5,
      "5:4",
      0.6
     ],
     [
      1.5,
      0.5,
      "5:6",
      0.5
     ],
     [
      2,
      0.5,
      "6:1",
      0.7
     ],
     [
      2.5,
      0.5,
      "5:6",
      0.45
     ],
     [
      3,
      0.5,
      "5:4",
      0.5
     ],
     [
      3.5,
      0.5,
      "5:3",
      0.7
     ],
     [
      4,
      0.5,
      "5:5",
      0.5
     ],
     [
      4.5,
      0.5,
      "6:0",
      0.6
     ],
     [
      5,
      0.5,
      "6:2",
      0.5
     ],
     [
      5.5,
      0.5,
      "6:4",
      0.7
     ],
     [
      6,
      0.5,
      "6:2",
      0.45
     ],
     [
      6.5,
      0.5,
      "5:6",
      0.5
     ]
    ]
   }
  }
 ],
 "playlist": [
  {
   "pattern": "chimes",
   "track": 1,
   "start": 0,
   "length": 14
  },
  {
   "pattern": "groove",
   "track": 2,
   "start": 7,
   "length": 49
  },
  {
   "pattern": "bassline",
   "track": 3,
   "start": 14,
   "length": 42
  },
  {
   "pattern": "melody",
   "track": 4,
   "start": 28,
   "length": 28
  },
  {
   "pattern": "chimes",
   "track": 1,
   "start": 42,
   "length": 14
  }
 ],
 "mixer": [
  {
   "name": "Master",
   "vol": 0.85
  },
  {
   "name": "Kick"
  },
  {
   "name": "Clap",
   "fx": [
    {
     "type": "reverb",
     "decay": 1.2,
     "mix": 0.2
    }
   ]
  },
  {
   "name": "Hat",
   "pan": 0.15
  },
  {
   "name": "Bass",
   "fx": [
    {
     "type": "eq",
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
   "name": "Lead",
   "fx": [
    {
     "type": "delay",
     "sync": 2,
     "fb": 0.35,
     "mix": 0.28,
     "damp": 4500,
     "pp": 1
    },
    {
     "type": "reverb",
     "decay": 2.8,
     "mix": 0.25
    }
   ]
  },
  {
   "name": "Bells",
   "fx": [
    {
     "type": "reverb",
     "decay": 4.5,
     "pre": 0.03,
     "mix": 0.4
    }
   ]
  }
 ],
 "mods": [
  {
   "id": "wobble",
   "type": "lfo",
   "name": "Lead wobble",
   "lfo": {
    "sync": 5,
    "shape": "sine",
    "phase": 0
   },
   "wires": [
    {
     "to": "ch.lead.cut",
     "amt": 0.12
    },
    {
     "to": "ch.bells.pan",
     "amt": 0.6
    }
   ]
  },
  {
   "id": "space",
   "type": "env",
   "name": "Bells space",
   "env": {
    "len": 56,
    "loop": true,
    "pts": [
     [
      0,
      0.1
     ],
     [
      14,
      0.7
     ],
     [
      42,
      0.2
     ],
     [
      56,
      0.9
     ]
    ]
   },
   "wires": [
    {
     "to": "mix.6.0.mix",
     "amt": 0.45
    }
   ]
  },
  {
   "id": "macro",
   "type": "knob",
   "name": "Macro",
   "value": 0,
   "wires": [
    {
     "to": "ch.bass.cut",
     "amt": 0.25
    },
    {
     "to": "ch.lead.osc2.o_vol",
     "amt": 0.5
    },
    {
     "to": "os.hue",
     "amt": 0.3
    }
   ]
  }
 ]
};
