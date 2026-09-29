import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Bluetooth,
  ChevronDown,
  Download,
  History,
  Info,
  Mic,
  Send,
  Square,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { LANGUAGES, getLanguage, isActiveLanguage, phraseById, render, type LanguageCode, type MessageRecord } from '@itantra/shared';
import { cx, formatBytes, formatClock, formatMs } from '../../lib/format.ts';
import { speaker } from '../../lib/tts.ts';
import { useRecorder, useSpeak } from '../../hooks/speech.ts';
import type { TranscriptResponse } from '../../lib/recorder.ts';
import { useStore, type ProductModels } from '../../store/useStore.ts';
import type { NeuralVoiceState } from '../../lib/neuralTts.ts';

interface DevicePanelProps {
  deviceId: string;
  side: 'A' | 'B';
  className?: string;
}

type Overlay = 'none' | 'models' | 'history' | 'info' | 'sos';

/**
 * One handset, drawn at phone aspect ratio and laid out like the Android
 * iTantra app. Designed to fit one screen without scrolling: device card,
 * language chip, push-to-talk, status, latency, received message, message
 * field and a technical footer. Every control is live.
 */
export function DevicePanel({ deviceId, side, className }: DevicePanelProps) {
  const device = useStore((s) => s.devices[deviceId]);
  const messages = useStore((s) => s.messages);
  const demo = useStore((s) => s.demo);
  const setLanguage = useStore((s) => s.setLanguage);
  const sendText = useStore((s) => s.sendText);
  const toggleMute = useStore((s) => s.toggleMute);
  const setNodeOnline = useStore((s) => s.setNodeOnline);
  const requestSos = useStore((s) => s.requestSos);
  const capabilities = useStore((s) => s.capabilities);
  const queue = useStore((s) => s.queue);
  const mode = useStore((s) => s.mode);
  const connection = useStore((s) => s.connection);
  const translationProvider = useStore((s) => s.translationProvider);
  const sos = useStore((s) => s.sos);
  const productModels = useStore((s) => s.productModels);
  const refreshProductModels = useStore((s) => s.refreshProductModels);
  const neuralVoices = useStore((s) => s.neuralVoices);
  const installNeuralVoice = useStore((s) => s.installNeuralVoice);
  const node = useStore((s) => s.topology.nodes.find((n) => n.id === deviceId));
  const peerId = side === 'A' ? 'DEV-B' : 'DEV-A';
  const peer = useStore((s) => s.devices[peerId]);
  const peerNode = useStore((s) => s.topology.nodes.find((n) => n.id === peerId));

  const [text, setText] = useState('');
  const [level, setLevel] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'listening' | 'recognising'>('idle');
  const listening = phase === 'listening';
  const pressStartedAt = useRef(0);
  const [lastTranscript, setLastTranscript] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const historyRef = useRef<HTMLOListElement>(null);
  const mountedAt = useRef(Date.now());
  const spokenRef = useRef<string | null>(null);

  const { speak, stop } = useSpeak(deviceId);
  const language = device?.language ?? 'en';

  const handleTranscript = useCallback(
    (result: TranscriptResponse) => {
      setLastTranscript(result.text);
      setText('');
      // A spoken utterance continues straight through the pipeline, exactly as typed text does.
      sendText(deviceId, result.text, {
        inputMode: 'voice',
        ...(result.language !== language ? { sourceLanguage: result.language as LanguageCode } : {}),
        ...(result.english ? { pivotText: result.english } : {}),
      });
    },
    [deviceId, language, sendText],
  );
  const autoStopRef = useRef<() => void>(() => {});
  const speech = useRecorder({
    lang: language,
    onLevel: setLevel,
    onTranscript: handleTranscript,
    onDone: () => setPhase('idle'),
    onAutoStop: () => autoStopRef.current(),
  });

  const thread = useMemo(
    () => messages.filter((m) => m.from === deviceId || m.to === deviceId).sort((a, b) => a.createdAt - b.createdAt),
    [messages, deviceId],
  );
  const inbox = thread.filter((m) => m.to === deviceId && m.status !== 'failed');
  const latestIncoming = inbox.slice(-1)[0] ?? null;
  const latestDelivered = inbox.filter((m) => m.status === 'delivered').slice(-1)[0] ?? null;
  const outgoing = thread.filter((m) => m.from === deviceId);
  const outgoingInFlight = outgoing.filter((m) => m.status !== 'delivered' && m.status !== 'failed');
  const incomingInFlight = thread.filter((m) => m.to === deviceId && m.status !== 'delivered' && m.status !== 'failed');
  const lastOutgoingFailed = outgoing.length > 0 && outgoing[outgoing.length - 1].status === 'failed';
  const lastMeasured = [...thread].reverse().find((m) => m.latencyMs !== null) ?? null;

  useEffect(() => {
    const el = historyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, overlay]);

  // Receiver auto-plays every new delivery in its own language (unless muted) — the
  // product behaviour. Only messages delivered after this screen mounted, once each.
  useEffect(() => {
    if (!latestDelivered?.deliveredText || !latestDelivered.deliveredAt) return;
    if (latestDelivered.deliveredAt < mountedAt.current) return;
    if (spokenRef.current === latestDelivered.id) return;
    spokenRef.current = latestDelivered.id;
    if (device?.muted) return;
    const timer = window.setTimeout(() => speak(latestDelivered.deliveredText), 260);
    return () => window.clearTimeout(timer);
  }, [latestDelivered, device?.muted, speak]);


  const submit = () => {
    const value = text.trim();
    if (!value) return;
    if (sendText(deviceId, value)) {
      setText('');
      setLastTranscript(null);
    }
  };

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const beginListening = async (autoStop: boolean) => {
    if (!speech.supported) {
      useStore.getState().pushNotice({ tone: 'warn', message: speech.blockedReason ?? 'Microphone unavailable. Use text input instead.' });
      return;
    }
    if (phaseRef.current !== 'idle') return;
    setPhase('listening');
    const started = await speech.start(autoStop);
    if (!started) setPhase('idle');
  };
  /** Stop capturing and send the audio to Whisper on the hub; RECOGNISING until it answers. */
  const endListening = () => {
    if (phaseRef.current !== 'listening') return;
    setPhase('recognising');
    void speech.finish();
  };
  autoStopRef.current = endListening;

  const TAP_MS = 350;
  const onTalkPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // Keep receiving pointer events even if the finger drifts off the shrinking button.
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Pointer capture is optional.
    }
    if (phase === 'listening') {
      // Second tap in tap-to-talk mode: finish.
      pressStartedAt.current = 0;
      endListening();
      return;
    }
    pressStartedAt.current = Date.now();
    // Start in tap mode (auto-stop on silence); releasing after a hold turns it into push-to-talk.
    void beginListening(true);
  };
  const onTalkPointerUp = () => {
    if (!pressStartedAt.current) return;
    const held = Date.now() - pressStartedAt.current;
    pressStartedAt.current = 0;
    // A quick tap keeps listening until you pause or tap again; a hold sends on release.
    if (held >= TAP_MS) endListening();
  };

  const highlight = (target: string) => demo.running && demo.highlight === target;
  const lower = side.toLowerCase();

  if (!device) return null;
  const info = getLanguage(language);
  const online = node?.online !== false;
  const peerOnline = peerNode?.online !== false;
  const voicePick = capabilities.speechSynthesis ? speaker.pickVoiceDetailed(language, speaker.listVoices()) : null;
  const neuralVoice = neuralVoices[language];
  const neuralReady = neuralVoice?.status === 'ready';
  const ttsOk = neuralReady || voicePick?.match === 'exact';
  const ttsFallback = !neuralReady && voicePick?.match === 'script';
  const sttOk = capabilities.speechRecognition && Boolean(productModels?.stt.model) && language !== 'or';
  const mtPairs = productModels?.mt?.pairs ?? {};
  const pairOk = (pair: string) => mtPairs[pair]?.installed === true;
  const packInstalled = language === 'en' || (pairOk(`${language}-en`) && pairOk(`en-${language}`));
  const hops = latestDelivered && latestDelivered.routeNodes.length > 1 ? latestDelivered.routeNodes.length - 1 : null;
  const sosHere = sos.active && sos.messageId === deviceId;

  const status = listening
    ? 'LISTENING'
    : phase === 'recognising'
      ? 'RECOGNISING'
      : device.busy === 'translating'
      ? 'TRANSLATING'
      : device.speaking
        ? 'SPEAKING'
        : outgoingInFlight.some((m) => m.priority === 'SOS')
          ? 'SOS'
          : outgoingInFlight.some((m) => m.status === 'stored')
            ? 'STORED'
            : outgoingInFlight.length > 0
              ? 'TRANSMITTING'
              : incomingInFlight.length > 0
                ? 'RECEIVING'
                : lastOutgoingFailed
                  ? 'FAILED'
                  : !online
                    ? 'OFFLINE'
                    : 'READY';

  const statusTone =
    status === 'LISTENING' || status === 'SOS' || status === 'FAILED'
      ? 'text-[#ff4655]'
      : status === 'READY' || status === 'SPEAKING'
        ? 'text-white'
        : status === 'OFFLINE'
          ? 'text-[#8a97a6]'
          : 'ph-accent';

  return (
    <section
      id={`device-${lower}`}
      aria-label={`Device ${side}`}
      className={cx('mx-auto flex h-full min-h-0 w-full max-w-[400px] flex-col items-center justify-center', className)}
    >
      <div
        className={cx(
          'phone relative flex flex-col overflow-hidden',
          (highlight('device-a-mic') && side === 'A') ||
            highlight(`device-${lower}-input`) ||
            highlight(`device-${lower}-inbox`)
            ? 'phone-highlight'
            : '',
          device.speaking && 'phone-speaking',
        )}
      >
        <div className="phone-notch" aria-hidden="true" />

        {/* Status bar */}
        <div className="flex items-center justify-between px-[5cqw] pt-2.5 pb-0.5 font-mono text-[max(8.5px,2.3cqw)] tracking-[0.1em] text-[#8a97a6] uppercase">
          <span className="flex items-center gap-1.5">
            <span className={cx('h-1.5 w-1.5 rounded-full', online ? 'bg-[#2ee07f]' : 'bg-[#ff4655]')} aria-hidden="true" />
            {device.name}
            <LiveClock />
          </span>
          <span>{connection === 'ONLINE' ? 'HUB' : 'LOCAL'}</span>
        </div>

        {/* Screen: flex column sized to the handset, no scrolling needed */}
        <div className="flex min-h-0 flex-1 flex-col gap-[2.4cqw] overflow-hidden px-[3.6cqw] pt-1 pb-2">
          <header className="flex items-start justify-between gap-[2.4cqw]">
            <div>
              <div className="text-[max(19px,6cqw)] leading-none font-extrabold tracking-[0.06em] text-white">
                <span className="ph-accent">i</span>TANTRA
              </div>
              <div className="ph-label mt-[1cqw] !text-[max(8.5px,2.3cqw)]">Neural transceiver · web</div>
            </div>
            <button
              type="button"
              className={cx('ph-btn relative !px-[3.6cqw] !py-[2cqw] !text-[max(10px,2.8cqw)]', !packInstalled && 'ring-1 ring-[#ffb648]/40')}
              onClick={() => setOverlay('models')}
              title="Language models on this device"
            >
              MODELS
              {!packInstalled ? (
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-[#ffb648]" aria-hidden="true" />
              ) : null}
            </button>
          </header>

          {/* This device */}
          <div className="ph-card px-[3.6cqw] py-[2.4cqw]">
            <div className="flex items-center justify-between">
              <span className="ph-label !text-[max(8.5px,2.3cqw)]">This device</span>
              <span className="font-mono text-[max(9px,2.5cqw)] tracking-[0.12em] text-[#2ee07f]">{deviceId}</span>
            </div>
            <p className="mt-[1cqw] text-[max(11px,3.2cqw)] text-white/85">
              {online ? (
                peerOnline ? (
                  <>
                    <span className="ph-accent">●</span> CONNECTED — {peer?.name ?? 'peer'}
                    {hops !== null ? ` · ${hops} hop${hops === 1 ? '' : 's'}` : ''}
                  </>
                ) : (
                  <>
                    <span className="text-[#ffb648]">●</span> ONLINE — peer unreachable
                  </>
                )
              ) : (
                <>
                  <span className="text-[#8a97a6]">●</span> OFFLINE — No peer connected
                </>
              )}
            </p>
            <div className="mt-[1.5cqw] flex items-center justify-between gap-[3cqw]">
              <span className="text-[max(10.5px,3cqw)] font-semibold tracking-[0.06em] text-[#2ee07f] uppercase">
                {online ? 'Link' : 'Connect device'}
              </span>
              <button
                type="button"
                className={cx('ph-btn !px-[3.6cqw] !py-[1.6cqw] !text-[max(10.5px,3cqw)]', online && 'ph-btn-filled')}
                onClick={() => setNodeOnline(deviceId, !online)}
                aria-pressed={online}
                title={
                  online
                    ? 'Simulated transport. Click to take this device off the mesh.'
                    : 'Simulated transport. Click to bring this device back onto the mesh.'
                }
              >
                <Bluetooth size={14} />
                AUTO · BT + Wi-Fi
              </button>
            </div>
          </div>

          {/* Language */}
          <div className="flex items-center justify-between gap-[3cqw]">
            <div>
              <div className="ph-label mb-[1cqw] !text-[max(8.5px,2.3cqw)]">My language</div>
              <label className="ph-card relative flex cursor-pointer flex-col px-[3.6cqw] py-[1.6cqw]" htmlFor={`lang-${deviceId}`}>
                <span className="flex items-center gap-[2.4cqw] text-[max(15px,4.4cqw)] leading-tight font-semibold text-white">
                  {info.nativeName}
                  <ChevronDown size={13} className="text-[#8a97a6]" aria-hidden="true" />
                </span>
                <span className="font-mono text-[max(9px,2.5cqw)] tracking-[0.08em] text-[#2ee07f]">
                  STT {sttOk ? '✓' : '✗'} · TTS {ttsOk ? '✓' : ttsFallback ? '~' : '✗'} · MT {packInstalled ? '✓' : '☁'}
                </span>
                <select
                  id={`lang-${deviceId}`}
                  className="absolute inset-0 cursor-pointer opacity-0"
                  value={language}
                  aria-label={`Language for ${device.name}`}
                  onChange={(event) => setLanguage(deviceId, event.target.value as LanguageCode)}
                >
                  <optgroup label="Prototype">
                    {LANGUAGES.filter((lang) => isActiveLanguage(lang.code)).map((lang) => (
                      <option key={lang.code} value={lang.code}>
                        {lang.name} · {lang.nativeName}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Future implementation">
                    {LANGUAGES.filter((lang) => !isActiveLanguage(lang.code)).map((lang) => (
                      <option key={lang.code} value={lang.code} disabled>
                        {lang.name} · {lang.nativeName} — future
                      </option>
                    ))}
                  </optgroup>
                </select>
              </label>
            </div>
            <button
              type="button"
              className="ph-icon-btn !h-[max(36px,11cqw)] !w-[max(36px,11cqw)]"
              onClick={() => setOverlay('history')}
              aria-label={`Conversation history for ${device.name}`}
              title="Conversation history"
            >
              <History size={17} />
            </button>
          </div>

          {/* Push to talk — takes whatever height is left */}
          <div className="flex min-h-0 flex-1 items-center justify-center py-1">
            <button
              type="button"
              className="ph-ptt flex flex-col items-center justify-center gap-1"
              data-listening={listening}
              data-phase={phase}
              disabled={!speech.supported}
              onPointerDown={onTalkPointerDown}
              onPointerUp={onTalkPointerUp}
              onPointerCancel={endListening}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                if (event.repeat || event.key !== ' ') return;
                event.preventDefault();
                void beginListening(false);
              }}
              onKeyUp={(event) => {
                if (event.key !== ' ') return;
                event.preventDefault();
                endListening();
              }}
              aria-label={listening ? `Release to stop speaking for ${device.name}` : `Hold to speak for ${device.name}`}
              title={
                speech.supported
                  ? 'Hold and speak, release to send. Or tap once, speak, and pause. (Space bar works too.)'
                  : (speech.blockedReason ?? 'Speech recognition unavailable — type below')
              }
            >
              <span className="flex items-center gap-[2.4cqw] text-[max(11px,3.2cqw)]">
                {phase === 'idle' ? <Mic size={20} /> : <Square size={16} />}
                <span className="text-left">
                  {phase === 'listening' ? 'LISTENING' : phase === 'recognising' ? 'HOLD ON' : 'PRESS TO'}
                  <br />
                  {phase === 'listening' ? 'TAP TO SEND' : phase === 'recognising' ? '…' : 'TALK'}
                </span>
              </span>
            </button>
          </div>

          {/* Status row */}
          <div className="flex items-center justify-between">
            <button type="button" className="ph-icon-btn !h-[max(36px,11cqw)] !w-[max(36px,11cqw)]" onClick={() => setOverlay('info')} aria-label="About this device">
              <Info size={17} />
            </button>
            <span className={cx('text-[max(20px,6cqw)] font-extrabold tracking-[0.2em]', statusTone)} aria-live="polite" aria-label={`Status ${status}`}>
              {status}
            </span>
            <button
              type="button"
              className={cx('ph-icon-btn !h-[max(36px,11cqw)] !w-[max(36px,11cqw)]', sosHere && 'bg-[#ff4655]/20')}
              onClick={() => setOverlay('sos')}
              aria-label={`Send SOS from ${device.name}`}
              title="Emergency — highest transmission priority"
            >
              <TriangleAlert size={17} className="text-[#ff4655]" />
            </button>
          </div>

          {/* Received / listening line */}
          <div id={`device-${lower}-inbox`} className="min-h-[14cqw]">
            <AnimatePresence initial={false} mode="wait">
              {phase !== 'idle' || device.speaking ? (
                <motion.div key="live" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ph-card px-[3.6cqw] py-[2.4cqw]">
                  <div className="flex items-center justify-between text-[max(10.5px,3cqw)] text-[#2ee07f]">
                    <span>
                      {device.speaking
                        ? `Speaking ${info.name}…`
                        : phase === 'recognising'
                          ? `Whisper is transcribing ${info.name}…`
                          : level > 0.4
                            ? 'Hearing you…'
                            : 'Listening — speak now'}
                    </span>
                    {phase === 'listening' ? <span className="ph-mono">MIC</span> : null}
                  </div>
                  {phase === 'listening' ? (
                    <div
                      className="mt-[1.4cqw] flex h-[max(10px,3cqw)] items-end gap-[0.6cqw]"
                      role="meter"
                      aria-label="Microphone level"
                      aria-valuenow={Math.round(level * 100)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      {Array.from({ length: 24 }, (_, i) => (
                        <span
                          key={i}
                          className={cx('flex-1 rounded-sm transition-[height] duration-75', i / 24 < level ? 'bg-[#2ee07f]' : 'bg-white/10')}
                          style={{ height: `${30 + ((i * 37) % 70)}%` }}
                        />
                      ))}
                    </div>
                  ) : null}
                </motion.div>
              ) : latestIncoming ? (
                <motion.div
                  key={latestIncoming.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className={cx(
                    'ph-card px-[3.6cqw] py-2',
                    latestIncoming.priority === 'SOS' && 'ring-1 ring-[#ff4655]/60',
                    demo.running && demo.highlight === `speak-${latestIncoming.id}` && 'ring-1 ring-[#2ee07f]/70',
                  )}
                >
                  <div className="flex items-center justify-between gap-[2.4cqw]">
                    <span className={cx('ph-label !text-[max(8.5px,2.3cqw)]', latestIncoming.priority === 'SOS' ? '!text-[#ff4655]' : '!text-[#2ee07f]')}>
                      {latestIncoming.priority === 'SOS' ? 'SOS · ' : ''}
                      {latestIncoming.status === 'delivered'
                        ? latestIncoming.deliveredText
                          ? `Received · ${peer?.name ?? 'peer'}`
                          : 'Decoding…'
                        : latestIncoming.status === 'stored'
                          ? 'Held at relay…'
                          : 'Incoming…'}
                    </span>
                    <span className="flex items-center gap-[2.4cqw]">
                      {latestIncoming.latencyMs !== null ? (
                        <span className="font-mono text-[max(8.5px,2.3cqw)] text-[#8a97a6]">{formatMs(latestIncoming.latencyMs)}</span>
                      ) : null}
                      {latestIncoming.status === 'delivered' ? (
                        <button
                          type="button"
                          className={cx('ph-btn !px-[2.6cqw] !py-[1cqw] !text-[max(9px,2.5cqw)]', device.speaking && 'ph-btn-filled')}
                          onClick={() => (device.speaking ? stop() : speak(latestIncoming.deliveredText))}
                          aria-label={device.speaking ? 'Stop playback' : 'Play received message'}
                        >
                          {device.speaking ? <Square size={10} /> : <Volume2 size={11} />}
                          {device.speaking ? 'STOP' : 'PLAY'}
                        </button>
                      ) : null}
                    </span>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-[max(14px,4cqw)] leading-snug text-white" lang={latestIncoming.targetLanguage}>
                    {latestIncoming.deliveredText || '…'}
                  </p>
                </motion.div>
              ) : (
                <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="ph-card px-[3.6cqw] py-[2.4cqw] text-[max(10px,2.8cqw)] text-[#8a97a6]">
                  Messages from {peer?.name ?? 'the peer'} arrive here in {info.name} and are spoken aloud.
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Your message + latency */}
          <div id={`device-${lower}-input`}>
            <div className="mb-[1cqw] flex items-center justify-between">
              <label className="ph-label !text-[max(8.5px,2.3cqw)] !text-[#2ee07f]" htmlFor={`input-${deviceId}`}>
                Your message
              </label>
              <span className="ph-mono">
                E2E latency <span className="text-white">{lastMeasured ? formatMs(lastMeasured.latencyMs) : '–'}</span>
              </span>
            </div>
            {lastTranscript ? (
              <p className="mb-[1cqw] truncate text-[max(10px,2.8cqw)] text-white/80" data-testid={`heard-${lower}`} title={lastTranscript}>
                <span className="ph-mono mr-[1.4cqw]">Heard</span>
                {lastTranscript}
              </p>
            ) : null}
            <div className="relative">
              <textarea
                id={`input-${deviceId}`}
                rows={1}
                className="ph-field !min-h-[12cqw] !py-[2.4cqw] !text-[max(12px,3.4cqw)]"
                value={text}
                placeholder={speech.supported ? 'Hold PRESS TO TALK and speak, or type' : `Type in ${info.name}`}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    submit();
                  }
                }}
              />
              <button
                type="button"
                className="ph-btn ph-btn-filled absolute top-1/2 right-1.5 !h-[max(30px,8.5cqw)] !w-[max(30px,8.5cqw)] -translate-y-1/2 !p-0"
                onClick={submit}
                disabled={!text.trim()}
                aria-label={`Send from ${device.name}`}
                title="Send (Enter)"
              >
                <Send size={13} />
              </button>
            </div>
          </div>

          {/* Technical footer */}
          <p className="ph-mono ph-card px-[3.6cqw] py-[1.6cqw] !text-[8.5px] !leading-[1.5]">
            Peers: {peerOnline && online ? 1 : 0} · Hops: {hops ?? '–'} · Transport: BT + Wi-Fi (sim) · Queue: {queue.length}
            <br />
            STT: {productModels?.stt.model?.id ?? 'hub offline'} · MT: {packInstalled ? 'Opus-MT' : translationProvider} · Security: SHA-256 tag · Mode: {mode}
            {lastTranscript ? ' · Voice input' : ''}
          </p>
        </div>

        <div className="phone-home" aria-hidden="true" />

        {/* Overlays */}
        <AnimatePresence>
          {overlay !== 'none' ? (
            <motion.div
              key={overlay}
              className="ph-overlay"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.18 }}
              role="dialog"
              aria-modal="true"
              aria-label={overlayTitle(overlay)}
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[max(13px,3.6cqw)] font-bold tracking-[0.12em] text-white uppercase">{overlayTitle(overlay)}</span>
                <button type="button" className="ph-icon-btn !h-[max(32px,9.5cqw)] !w-[max(32px,9.5cqw)]" onClick={() => setOverlay('none')} aria-label="Close">
                  <X size={16} />
                </button>
              </div>

              {overlay === 'models' ? (
                <ModelsPanel
                  language={language}
                  productModels={productModels}
                  sttOk={sttOk}
                  voicePick={voicePick}
                  muted={device.muted}
                  translationProvider={translationProvider}
                  onRefresh={() => void refreshProductModels()}
                  onToggleMute={() => toggleMute(deviceId)}
                  neuralVoice={neuralVoice ?? null}
                  onInstallVoice={() => void installNeuralVoice(language)}
                />
              ) : null}

              {overlay === 'history' ? (
                <ol ref={historyRef} className="flex min-h-0 flex-1 flex-col gap-[2.4cqw] overflow-y-auto" aria-label={`${device.name} conversation`}>
                  {thread.length === 0 ? <li className="m-auto text-center text-[max(11px,3.2cqw)] text-[#8a97a6]">No messages yet.</li> : null}
                  {thread.map((message) => (
                    <HistoryRow key={message.id} message={message} incoming={message.to === deviceId} onPlay={() => speak(message.deliveredText)} />
                  ))}
                </ol>
              ) : null}

              {overlay === 'info' ? (
                <div className="flex flex-col gap-[3cqw] text-[max(11px,3.2cqw)] leading-relaxed text-white/85">
                  <p>
                    <span className="ph-accent">{device.name}</span> speaks {info.name}. Anything you say or type is
                    recognised, translated through an English pivot, packed into a compact packet and relayed to{' '}
                    {peer?.name ?? 'the peer'}, which renders and speaks it in {peer ? getLanguage(peer.language).name : 'its language'}.
                  </p>
                  <p className="ph-mono normal-case">
                    Last delivery: {latestDelivered ? `${formatMs(latestDelivered.latencyMs)} · ${formatBytes(latestDelivered.payloadBytes)} · ${latestDelivered.packetId}` : 'none yet'}
                  </p>
                  <p className="ph-mono normal-case">
                    Latency is measured wall-clock in this browser. Transport, hops and stage timings are simulated. The
                    SHA-256 tag is real; encryption is architecture only.
                  </p>
                </div>
              ) : null}

              {overlay === 'sos' ? (
                <div className="flex flex-col gap-[3cqw]">
                  <div className="rounded-2xl border border-[#ff4655]/50 bg-[#ff4655]/10 p-4">
                    <p className="flex items-center gap-[2.4cqw] text-[max(13px,3.6cqw)] font-bold text-[#ff4655]">
                      <TriangleAlert size={16} /> SEND EMERGENCY MESSAGE?
                    </p>
                    <p className="mt-[1.5cqw] text-[max(11px,3.2cqw)] text-white/85">This message will receive the highest transmission priority.</p>
                    <p className="mt-2 text-[max(14px,4cqw)] text-white" lang={language}>
                      {render(phraseById('need-immediate-help'), language)}
                    </p>
                  </div>
                  <div className="flex gap-[2.4cqw]">
                    <button type="button" className="ph-btn flex-1 !py-3 !text-[max(10.5px,3cqw)]" onClick={() => setOverlay('none')}>
                      CANCEL
                    </button>
                    <button
                      type="button"
                      className="ph-btn flex-1 !border-transparent !bg-[#ff4655] !py-3 !text-[max(10.5px,3cqw)] !text-white"
                      onClick={() => {
                        setOverlay('none');
                        requestSos(deviceId);
                      }}
                    >
                      <TriangleAlert size={14} /> SEND SOS
                    </button>
                  </div>
                </div>
              ) : null}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </section>
  );
}

function overlayTitle(overlay: Overlay): string {
  return overlay === 'models' ? 'Models' : overlay === 'history' ? 'History' : overlay === 'info' ? 'About' : overlay === 'sos' ? 'Emergency' : '';
}

function ModelsPanel({
  language,
  productModels,
  sttOk,
  voicePick,
  muted,
  translationProvider,
  onRefresh,
  onToggleMute,
  neuralVoice,
  onInstallVoice,
}: {
  language: LanguageCode;
  productModels: ProductModels | null;
  sttOk: boolean;
  voicePick: { match: 'exact' | 'script' | 'none'; voice: SpeechSynthesisVoice | null } | null;
  muted: boolean;
  translationProvider: string;
  onRefresh: () => void;
  onToggleMute: () => void;
  neuralVoice: NeuralVoiceState | null;
  onInstallVoice: () => void;
}) {
  const info = getLanguage(language);
  const pairs = productModels?.mt?.pairs ?? {};
  const toEn = language === 'en' || pairs[`${language}-en`]?.installed === true;
  const fromEn = language === 'en' || pairs[`en-${language}`]?.installed === true;

  useEffect(() => {
    onRefresh();
    // Refresh once when the panel opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hopText = (ok: boolean, dir: string) =>
    ok
      ? `${dir}: Opus-MT`
      : `${dir}: ${language === 'mr' && dir.endsWith('EN') ? 'not hosted by the product (unreliable)' : 'no product pack'} → demo dataset / ${translationProvider}`;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[2cqw] overflow-y-auto">
      <div className="ph-label">ITANTRA product models · {info.name}</div>
      <div className="ph-card p-[3.6cqw]">
        <div className="flex items-center justify-between">
          <span className="text-[max(15px,4.4cqw)] font-semibold text-white">{info.nativeName}</span>
          <span className="ph-mono">{productModels ? 'hub connected' : 'hub offline'}</span>
        </div>

        <ModelRow
          name="STT"
          engine={productModels?.stt.model?.label ?? 'Whisper (hub offline)'}
          ok={sttOk}
          warn={Boolean(productModels?.stt.model) && !sttOk}
          detail={
            language === 'or'
              ? 'Whisper has no Odia — type instead'
              : productModels?.stt.model
                ? `${productModels.stt.model.source} · onnxruntime on the hub`
                : 'Start the hub to use speech input'
          }
        />
        <ModelRow
          name="MT"
          engine={toEn && fromEn ? 'Opus-MT (Helsinki-NLP, Apache-2.0)' : 'Opus-MT partial — fallback used'}
          ok={toEn && fromEn}
          warn={!(toEn && fromEn)}
          detail={
            language === 'en'
              ? 'English is the pivot language'
              : `${hopText(toEn, `${language.toUpperCase()}→EN`)} · ${hopText(fromEn, `EN→${language.toUpperCase()}`)}`
          }
        />
        <NeuralVoiceRow voice={neuralVoice} language={info.name} onInstall={onInstallVoice} />
        {!neuralVoice || neuralVoice.status !== 'ready' ? (
          <ModelRow
            name="TTS"
            engine="Browser voice (fallback only)"
            ok={false}
            warn={voicePick?.match === 'exact' || voicePick?.match === 'script'}
            detail={voicePick?.match === 'exact' ? `${voicePick.voice?.name ?? ''}` : `no product voice and no system ${info.name} voice`}
          />
        ) : null}
      </div>

      <div className="ph-label mt-[1cqw]">Translation packs from the Android repo</div>
      <ul className="flex flex-col gap-[1cqw]">
        {Object.entries(pairs).map(([pair, state]) => (
          <li key={pair} className="ph-card flex items-center gap-[2.4cqw] px-[3.2cqw] py-[1.6cqw]">
            <span className="w-[16cqw] font-mono text-[max(10px,2.8cqw)] text-white">{pair}</span>
            <span className="ph-mono min-w-0 flex-1 truncate normal-case">
              {state.installed ? (state.loaded ? 'installed · loaded' : 'installed') : 'missing from converted_v2'}
            </span>
            <span className={cx('font-mono', state.installed ? 'ph-accent' : 'text-[#ff7b85]')}>{state.installed ? '✓' : '✗'}</span>
          </li>
        ))}
        {Object.keys(pairs).length === 0 ? <li className="ph-mono normal-case">Hub offline — pack status unavailable.</li> : null}
      </ul>

      <p className="ph-mono mt-[1cqw] normal-case">
        Models are loaded from {productModels?.androidDir ?? 'the ITANTRA checkout'} and run on the hub with the same runtimes as
        the APK (onnxruntime for Whisper and Opus-MT, sherpa-onnx for voices). Browser speech services are not used.
      </p>
      <button type="button" className="ph-btn mt-[1cqw] !px-[3.6cqw] !py-[2.4cqw] text-[max(10.5px,3cqw)]" onClick={onToggleMute} aria-pressed={muted}>
        {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
        {muted ? 'VOICE OUTPUT MUTED' : 'VOICE OUTPUT ON'}
      </button>
    </div>
  );
}

function NeuralVoiceRow({ voice, language, onInstall }: { voice: NeuralVoiceState | null; language: string; onInstall: () => void }) {
  const status = voice?.status ?? 'offline';
  const ok = status === 'ready';
  const busy = status === 'installing';
  const installable = status === 'available' || status === 'error';
  const tone = ok ? 'ph-accent' : busy || installable ? 'text-[#ffb648]' : 'text-[#8a97a6]';
  const engine = ok
    ? `Neural voice · ${voice?.label ?? 'Piper'}`
    : busy
      ? `Installing ${voice?.label ?? 'voice'}…`
      : installable
        ? `${voice?.label ?? 'Piper voice'} · not installed`
        : status === 'none'
          ? `No open-licensed offline voice for ${language}`
          : 'Neural voice needs the hub (offline in local mode)';
  const detail = ok
    ? `sherpa-onnx on the hub · ${voice?.license ?? ''}`
    : busy
      ? `${voice?.detail ?? ''} ${Math.round((voice?.progress ?? 0) * 100)}%`
      : installable
        ? `${voice?.detail ?? ''}${voice?.sizeBytes ? ` · ${(voice.sizeBytes / 1e6).toFixed(0)} MB` : ''}`
        : (voice?.detail ?? 'browser voice is used instead');
  return (
    <div className="mt-[2cqw] flex items-center gap-[3cqw] border-t border-white/5 pt-[2cqw]">
      <span className={cx('w-8 font-mono text-[max(10px,2.8cqw)] font-bold tracking-[0.1em]', tone)}>VOICE</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[max(10.5px,3cqw)] text-white">{engine}</span>
        <span className="ph-mono block normal-case">{detail}</span>
        {busy ? (
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-[#0a0e13]">
            <motion.span className="block h-full bg-[#ffb648]" initial={false} animate={{ width: `${(voice?.progress ?? 0) * 100}%` }} transition={{ duration: 0.3 }} />
          </span>
        ) : null}
      </span>
      {installable ? (
        <button type="button" className="ph-btn ph-btn-filled shrink-0 !px-[3cqw] !py-[1.6cqw] text-[max(9px,2.5cqw)]" onClick={onInstall} aria-label={`Install ${language} neural voice`}>
          <Download size={12} /> INSTALL
        </button>
      ) : (
        <span className={cx('font-mono text-[max(10.5px,3cqw)]', tone)}>{ok ? '✓' : busy ? '…' : '✗'}</span>
      )}
    </div>
  );
}

function ModelRow({ name, engine, ok, warn, detail }: { name: string; engine: string; ok: boolean; warn?: boolean; detail: string }) {
  const tone = ok ? 'ph-accent' : warn ? 'text-[#ffb648]' : 'text-[#ff7b85]';
  return (
    <div className="mt-2 flex items-center gap-[3cqw] border-t border-white/5 pt-2">
      <span className={cx('w-8 font-mono text-[max(10px,2.8cqw)] font-bold tracking-[0.1em]', tone)}>{name}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[max(10.5px,3cqw)] text-white">{engine}</span>
        <span className="ph-mono block normal-case">{detail}</span>
      </span>
      <span className={cx('font-mono text-[max(10.5px,3cqw)]', tone)}>{ok ? '✓' : warn ? '~' : '✗'}</span>
    </div>
  );
}

function HistoryRow({ message, incoming, onPlay }: { message: MessageRecord; incoming: boolean; onPlay: () => void }) {
  const text = incoming ? message.deliveredText || '…' : message.originalText;
  return (
    <li className={cx('flex', incoming ? 'justify-start' : 'justify-end')}>
      <div
        className={cx(
          'max-w-[88%] rounded-2xl px-[3.2cqw] py-2',
          message.priority === 'SOS' ? 'bg-[#ff4655]/15' : message.status === 'failed' ? 'bg-[#ff4655]/10' : incoming ? 'bg-[#161c23]' : 'bg-[#2ee07f]/15',
        )}
      >
        <div className="ph-mono flex justify-between gap-[3cqw]">
          <span className={message.status === 'failed' ? 'text-[#ff7b85]' : undefined}>
            {message.priority === 'SOS' ? 'SOS · ' : ''}
            {incoming ? 'in' : 'out'} · {message.status === 'failed' ? 'failed — no route' : message.status}
          </span>
          <span>{formatClock(message.createdAt)}</span>
        </div>
        <p className="mt-0.5 text-[max(12px,3.4cqw)] leading-snug text-white" lang={incoming ? message.targetLanguage : message.sourceLanguage}>
          {text}
        </p>
        {incoming && message.status === 'delivered' ? (
          <button type="button" className="ph-btn mt-[1.5cqw] !px-[2.6cqw] !py-[1cqw] !text-[max(9px,2.5cqw)]" onClick={onPlay} aria-label="Play message">
            <Volume2 size={11} /> PLAY
          </button>
        ) : null}
      </div>
    </li>
  );
}

function LiveClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return <span className="ml-1 text-white">{formatClock(now).slice(0, 5)}</span>;
}
