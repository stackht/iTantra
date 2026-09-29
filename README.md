# iTantra Web Prototype

**Indian Multilingual TTS & STT Aided Neural Transceiver Radio Access for Low-Bitrate Links**

> Different languages. One communication channel.

This repository is a standalone, browser-based **demonstration prototype** of the iTantra
communication concept, built for live presentation. It is separate from, and does not
depend on, the Android iTantra project.

> **Honesty statement.** This web application is a demonstration prototype. It does not
> claim that browser APIs provide the same offline neural STT/TTS/translation
> implementation as the Android SIH system. What it demonstrates is the communication
> architecture, the message pipeline, the network behaviour and the user experience.
> Every number shown in the UI is either measured in the browser session or explicitly
> labelled as simulated.

---

## 1. Overview

Two people who speak different languages should be able to talk to each other over a
link too poor to carry audio. iTantra sends **text**, not voice: speech is recognised on
the sender's device, translated, packed into a compact packet, relayed across a mesh,
translated into the receiver's language and spoken aloud on arrival.

The prototype puts two phone-shaped virtual devices side by side on one screen, each
set to its own language, and runs that whole pipeline between them, stage by stage, in
front of you.

```
PERSON A (Hindi)
  │  "मुझे मदद चाहिए"
  ▼
Speech-to-text ──► Language detect ──► Translate (HI → EN pivot)
  ▼
Compact packet (UTF-8 bytes + SHA-256 tag)
  ▼
DEVICE A ──► RELAY 01 ──► RELAY 02 ──► DEVICE B
  ▼
Translate (EN → MR) ──► Text-to-speech
  ▼
PERSON B (Marathi)
  "मला मदत हवी आहे"
```

The reverse direction works identically.

## 2. Problem

- During disasters, in remote terrain and on the move, mobile data and voice coverage
  are unreliable or absent.
- Low-bitrate links (Bluetooth, Wi-Fi Direct, LoRa-class radios) can carry short text
  but not usable audio.
- India's linguistic diversity means the two ends of such a link often do not share a
  language, so a text link alone does not solve the problem.

## 3. Solution

Treat language as a property of each **device**, not of the **channel**. Each device
runs speech recognition and speech synthesis in its owner's language; only a compact,
language-tagged text packet crosses the link, and the receiving device renders it into
its own language. The channel is therefore language-independent, and emergency traffic
can be prioritised at the packet level.

## 4. Architecture

```
itantra-web/
├── client/                  React + Vite + Tailwind + Framer Motion (TypeScript, strict)
│   └── src/
│       ├── components/      Device panels, pipeline, network map, packet inspector, SOS, log
│       ├── pages/           Live Transceiver (two phones) · Console (pipeline, mesh, packets, queue, log)
│       ├── hooks/           push-to-talk recorder → hub Whisper, voice playback, capability probes
│       ├── lib/             WebSocket transport with local fallback, config, hash router
│       └── store/           Zustand store (devices, jobs, queue, topology, log, metrics…)
├── server/                  Node WebSocket hub (ws) + static host for the built client
│   └── src/
│       ├── hub.ts           Authoritative SimulationEngine, typed event broadcast
│       └── index.ts         HTTP + /ws upgrade, /healthz
├── shared/                  Framework-free domain code used by BOTH client and server
│   ├── src/
│   │   ├── simulation/      SimulationEngine — discrete-event pipeline state machine
│   │   ├── translation/     TranslationEngine interface · MockTranslationEngine · Service
│   │   ├── data/phrases.ts  Curated parallel demo corpus (10 languages)
│   │   ├── network.ts       Topology, hop-window routing, fault injection
│   │   ├── queue.ts         Strict priority queue (SOS > HIGH > NORMAL, FIFO within band)
│   │   ├── packet.ts        Packet creation, byte counting, validation, verification
│   │   ├── crypto/          Web Crypto SHA-256 integrity tag
│   │   ├── demo.ts          Scripted demo (pure, clock-injected runner)
│   │   └── events.ts        Typed client ⇄ server message contracts
│   └── test/                node:test suites (translation, queue, packet, network, demo)
├── .env.example
└── package.json             npm workspaces: shared · client · server
```

**Key design decision: one engine, two hosts.** `SimulationEngine` in `shared/` is the
only implementation of the pipeline. The hub runs one instance authoritatively and
streams typed events to every browser. If the hub is unreachable, the browser
instantiates the very same class in-tab and the UI cannot tell the difference apart
from the connection badge. There is no second, "fake" code path for offline mode.

## 5. Features

| Area | What actually happens |
| --- | --- |
| Live Transceiver | Only two handsets, drawn at phone aspect ratio side by side and laid out like the Android app: THIS DEVICE card with link toggle, MY LANGUAGE chip, PRESS TO TALK, READY/TRANSMITTING/RECEIVING status, SOS, E2E latency, received message with PLAY, YOUR MESSAGE field, technical footer. MODELS, history and info open as in-phone overlays. Text always works; PRESS TO TALK records the mic and the hub transcribes it with the product's Whisper model, with a live input-level meter |
| Header | **Start demo** runs the scripted Hindi ↔ Marathi exchange on the two phones with a slim narration strip |
| Console tab | Everything between the phones: 12-stage pipeline (input → STT → detect → translate → encode → queue → route → transmit → decode → translate → TTS → ready), relay map, fault injection, packet inspector, queue, metrics, event log |
| Translation | Pluggable `TranslationEngine`; shipped `MockTranslationEngine` resolves a curated corpus through an English pivot and reports **passthrough** for anything it does not know rather than inventing text |
| Packet | Real UTF-8 byte count of the transmitted fields and a real Web Crypto SHA-256 integrity tag; labelled **SIMULATED PACKET** because the link itself is simulated |
| Network | Four-node topology; modes Direct / 1-Hop Relay / 2-Hop Mesh / Store & Forward; packet position on the map comes from engine hop-progress events |
| Fault injection | Take either relay or the direct link down; the router recalculates mid-flight or, in Store & Forward mode, holds the packet and flushes it on reconnect |
| Priority queue | Strict SOS > HIGH > NORMAL with FIFO inside each band; an SOS raised behind queued traffic transmits first |
| SOS | Confirmation dialog, red emergency styling only while active, Web Audio alarm tone, fixed Hindi emergency sentence translated for the receiver |
| Demo | Started from the header: ~19 s scripted run on the two phones, with Pause / Resume / Skip / Stop and progress shown in the header bar |
| Metrics | Counters from real message state; latency is wall-clock submit → delivered in this session; `-- ms` until something has been measured |
| Event log | Timestamped, channelled, clearable |
| Connection badge | Online (hub) or Local demo mode (in-tab engine); click for the node/socket status sheet |
| Accessibility | Semantic buttons, ARIA labels, keyboard hold-to-speak (space bar), visible focus, live regions, `prefers-reduced-motion` respected |

## 6. Demo Flow

For a live presentation, in this order:

1. Open the app. The Live Transceiver shows the two phones. Device A is Hindi, Device B is Marathi.
2. On Device A hold **PRESS TO TALK** and speak, or type `मुझे मदद चाहिए` in YOUR MESSAGE and press Enter.
   Device A reads TRANSMITTING, Device B reads RECEIVING.
3. Device B shows `मला मदत हवी आहे` with the route it came by. Press **PLAY**; the browser speaks Marathi
   if a voice is installed. Both phones now show the measured E2E latency.
4. On Device B type `मी मदतीसाठी येत आहे`. Device A receives `मैं आपकी मदद के लिए आ रहा हूँ`.
5. Switch to the **Console** tab to show the 12-stage pipeline, the packet bytes and tag, and the relay map
   for the message that just went through (the store is shared, so it is still there).
6. Press the red triangle on a phone and confirm **SEND SOS**. In the Console, the emergency packet sits at
   queue position 1 ahead of any normal traffic.
7. In the Console toggle **Simulate Relay 02 failure**, send again from a phone: the route becomes
   DEV-A → R1 → DEV-B. Toggle it while a packet is in flight to see "Route recalculation".
8. Press **Cut Device A off (store & forward)**, send a message (the phone reads STORED), then press
   **Restore connectivity** and watch it deliver.
9. Press **Start demo** in the header for the fully scripted 19-second run narrated above the phones.

## 7. Tech Stack

- **Frontend:** React 18, TypeScript (strict), Vite 6, Tailwind CSS 4, Framer Motion, Lucide icons, Zustand
- **Backend:** Node.js ≥ 22.6, `ws` WebSocket server, `tsx` runtime
- **Shared:** framework-free TypeScript executed unchanged in Node and the browser
- **Tests:** `node:test` (no extra framework)
- **Browser APIs used:** `getUserMedia` + AudioWorklet (microphone capture only), `<audio>` playback, Web Crypto (`subtle.digest`), Web Audio. `speechSynthesis` is a last-resort fallback when the hub is unreachable.
- **Hub model runtimes:** onnxruntime (Whisper, Opus-MT) in a Python worker; sherpa-onnx-node (Piper voices)

No images, no 3D, no video. All visuals are CSS, SVG and icons.

## 8. Running Locally

```bash
npm install          # installs all three workspaces
npm run dev          # hub on :8787 and Vite on :5173, concurrently
```

Open <http://localhost:5173>.

Other scripts:

```bash
npm run build        # production client build → client/dist
npm start            # hub only; serves client/dist at :8787 when it exists
npm test             # 61 unit/integration tests across shared/
npm run typecheck    # tsc -b across shared, client, server
npm run lint         # alias of typecheck (strict TS is the lint gate in this repo)
```

**Backend-disconnected mode:** run only `npm run dev:client`, or stop the hub while the
app is open. The badge switches to *Local demo mode* and everything keeps working.

**Microphone.** The phones record raw audio in the browser and send it to the hub, where the
ITANTRA Whisper model transcribes it, so any modern browser works. Browsers only allow the
microphone on a secure origin: `http://localhost` is fine on this machine, but a phone opening
`http://<your-ip>:5173` gets no microphone. For phones on the same Wi-Fi run:

```bash
npm run dev:lan     # https with a self-signed certificate, all interfaces
```

and open `https://<your-ip>:5173` (accept the certificate warning once). Hold **PRESS TO TALK**,
speak, release; or tap once, speak, and pause. The green level bars show the microphone is being
heard; if they stay flat, the browser is using the wrong input device. The first press asks for
microphone permission. Text input is always available.

## 9. Environment Variables

Copy `.env.example` to `.env` (Vite reads `VITE_*`; the hub reads the rest).

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_WS_URL` | *(empty)* | Hub WebSocket URL. Empty = `ws://<current host>:8787/ws` |
| `VITE_DEMO_MODE` | `false` | `true` never contacts the hub and runs the engine in-tab |
| `VITE_TRANSLATION_PROVIDER` | `mymemory` | Fallback after the product's Opus-MT: `mymemory` = demo dataset → remote MT; `mock` = demo dataset only |
| `TRANSLATION_PROVIDER` | `mymemory` | Hub's own chain for packets that arrive untranslated |
| `PORT` | `8787` | Hub port |

No API keys are used or committed.

## 10. Product models (from the ITANTRA Android project)

Every model the phones use comes from the Android checkout (`ITANTRA_ANDROID_DIR`, default
`D:\Projects\ITANTRA`) and runs on the hub. The browser only records audio and plays it back:
**no browser speech-recognition, translation or on-device browser models are used.**

```
Sending phone (browser)              Hub (Node + Python worker)                     Receiving phone
 hold PRESS TO TALK                                                                   (browser)
 mic ─► AudioWorklet ─► 16 kHz PCM ─► POST /api/stt ─► Whisper (onnxruntime)
                                      text in the speaker's language
                                      POST /api/mt  ─► Opus-MT  hi→en, en→hi, en→mr
                                      packet ─► relay mesh ─► delivered text ─────►  GET /api/tts
                                                                    Piper voice ◄── (sherpa-onnx)
```

| Stage | Model | Source in the Android project |
| --- | --- | --- |
| STT | Whisper **small** multilingual INT8 (preferred) | ITANTRA `ModelCatalog.sttEnginePacks()` upgrade — `npm run stt:install` (SHA-256 verified) |
| STT (fallback) | Whisper base multilingual INT8 | `app/src/main/assets/models/stt/` (bundled in the APK) |
| MT | Opus-MT Marian INT8 packs `hi-en`, `en-hi`, `en-mr` | `model-conversion/converted_v2/` |
| TTS | Piper VITS INT8 `hi_IN-pratham`, `mr_IN-google`, `en_US-ljspeech` | `model-conversion/converted/open-tts/` or the catalog release URLs — `npm run voices:install -- en hi mr` |

Details that matter:

- **Whisper decoding is done by `server/src/models/whisper_onnx.py`, not sherpa-onnx.** sherpa-onnx
  1.13.x drops every Whisper token that holds only part of a multi-byte character, which strips most
  Devanagari letters ("मला मदत हवी आहे" came back as "मला म"). The worker runs the same ONNX graphs with
  onnxruntime and decodes the token bytes together, which is lossless.
- Decoding is forced to the speaker's selected language, exactly like the Android `SttEngine`. If
  Whisper still answers in the wrong script, the same audio is re-decoded with Whisper's own
  speech-to-English task and translated from English, with a visible notice.
- Translation pivots through English (`hi→en→mr`), exactly like the product. `mr→en` exists in the
  product's conversion folder but the product deliberately does not host it (its greedy decode emits
  unrelated text), so Marathi→English uses the curated demo dataset, then a labelled remote fallback.
- **Marathi voice input** is translated to English by Whisper's own speech-to-English task and
  then to the listener's language; this avoids the product's weak Marathi→English text pack.
  **Typed Marathi** uses the curated phrases first, then the product's unhosted `mr-en` pack only
  when its output survives a round trip back through `en-mr` (word overlap ≥ 0.45), then the
  remote fallback.
- The sender's phone shows **Heard: …** with the transcript; the Console tab's packet inspector shows
  SRC, PIVOT and RX for every message, so any model error is traceable to its stage.

Requirements on the hub machine: Python 3.10+ with `onnxruntime`, `sentencepiece`, `numpy` and
`transformers` (used only for Whisper's log-mel front-end), plus the Node packages installed by
`npm install`. Install every model the prototype needs with:

```bash
npm run models:install      # Whisper-small + Piper voices for en, hi, mr
```

**Language scope of this prototype:**

| Language | Status |
| --- | --- |
| English, Hindi, Marathi | **Prototype · live** — speech in, translation, speech out, all on ITANTRA models |
| Gujarati, Bengali, Tamil, Telugu, Kannada, Malayalam, Odia | **Future implementation** — greyed out as "future" in each phone's language list |

## 11. Network Simulation

Topology (identical in the router and on screen):

```
DEVICE A ── RELAY 01 ── RELAY 02 ── DEVICE B
                 └──────────────── DEVICE B      (1-relay alternate)
DEVICE A ────────────────────────── DEVICE B      (direct link)
```

| Mode | Hop window | Behaviour |
| --- | --- | --- |
| Direct | exactly 1 | Any degradation drops the packet |
| 1-Hop Relay | exactly 2 | DEVICE A → RELAY → DEVICE B |
| 2-Hop Mesh | 2–3, deepest first | Prefers both relays; falls back to one if RELAY 02 is lost |
| Store & Forward | any, shortest first | With no all-online route the packet is held and retried until connectivity returns |

Faults are applied to the same topology object the router searches, so an offline relay
is genuinely excluded from routing. A fault that touches the in-flight route triggers
`route:recalculating` and a fresh search.

**Not modelled:** airtime, collisions, fading, throughput, BER, battery, or any real RF
behaviour. Stage durations (`DEFAULT_TIMING`) are authored to make the pipeline visible;
the *latency* figure shown is the real wall-clock time between submit and delivery.

## 12. SOS System

- The SOS control asks for confirmation, then submits a fixed Hindi emergency sentence with
  priority `SOS` and origin `SOS`.
- `PriorityQueue` orders `SOS` (rank 0) > `HIGH` (1) > `NORMAL` (2), FIFO within a band, so an
  SOS raised behind queued traffic is dequeued first.
- Red styling, the pulsing banner and the Web Audio alarm exist only while an SOS is active.
- Out of scope: emergency calling, location sharing, regulatory behaviour.

## 13. Limitations

- Accuracy is the product models' accuracy. Whisper-small hears Hindi well and Marathi less well; Opus-MT
  sometimes paraphrases ("मला मदत करायची आहे") or drops a second sentence. The sender sees what Whisper
  heard, and the Console shows every hop, so errors are traceable rather than hidden.
- Marathi→English has no hosted product pack, so it relies on the curated dataset or the remote fallback.
- The hub needs Python with onnxruntime, sentencepiece, numpy and transformers.
- Speech recognition depends on the browser and usually on a network speech service.
- Voice availability for Indian languages depends entirely on the host OS. When the exact
  voice is missing, a same-script voice is used (a Hindi voice reads Marathi) with a notice.
- The network is a routing state machine, not a radio model.
- The SHA-256 tag is tamper evidence, not confidentiality; no encryption is performed.
- The hub keeps one shared simulation for all connected tabs (intentional for demos).

## 14. Relationship to the Android SIH Implementation

This web prototype and the Android application are separate codebases. The Android build
targets on-device (offline) neural STT, TTS and translation and real short-range radio
transports. This prototype demonstrates the **same architecture and user experience**
using browser APIs and a simulated link so it can be shown on any laptop, in any browser,
with no hardware. Nothing here should be read as a measurement of the Android system.

## 15. Future Integration

- Plug a real `TranslationEngine` (offline IndicTrans2/NLLB, or a hosted API) behind
  `TRANSLATION_PROVIDER`.
- Replace the simulated transport with a bridge to real radios (serial/BLE gateway) while
  keeping the same typed event stream.
- Add authenticated encryption (AEAD) on top of the existing canonical payload + tag.
- Multi-device sessions: the hub already broadcasts to every connected tab.
- Compression stage with measured ratios once a real payload format is fixed.

---

## Verification performed

- `npm run typecheck`, `npm run build`, `npm test` all clean.
- Hub endpoints, driven over HTTP with Piper-synthesised speech: Whisper-small transcribed
  "मुझे मदद चाहिए" as "मुछे मदद चाहीए", "मला मदत हवी आहे" as "मला मदद हवी आपे", and English exactly;
  silence and Odia return clear errors. Opus-MT: "मुझे मदद चाहिए" → "I need help" → "मला मदत करायची आहे."
- Real microphone path in Chromium (a WAV file fed as the microphone): hold PRESS TO TALK →
  LISTENING with a moving level meter → RECOGNISING → the sender shows **Heard: …** → Device B
  receives Marathi and speaks it with the Piper voice. Hindi and English utterances both delivered.
- Full browser suite on the two-phone UI (messaging in both directions, SOS, relay failure,
  store-and-forward, demo, pages, mobile layout), with the hub online and with it stopped.
- Not verifiable here: a human voice on your microphone, and audible output. The Chromium test
  proves the capture → Whisper → MT → voice chain; your speaking volume and mic choice are the
  remaining variables, which is why the level meter is on the phone.
