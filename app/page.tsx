'use client';

import { useEffect, useRef, useState } from 'react';

type Writer = WritableStreamDefaultWriter<string> | null;

type Cfg = {
  alias: string;
  freq: number;
  sf: number;
  bw: number;
  cr: number;
  tx: number;
  pre: number;
  sync: number; // 0..255
  crc: number;  // 0/1
  retries: number;
  retryMs: number;
};

type ChatMsg = {
  id: number;
  from: string;
  text: string;
  outgoing: boolean;
  delivered?: boolean;
  failed?: boolean;
  tryNo?: number;
  tryTotal?: number;
  espId?: number;
};

type SecCfg = {
  mode: 0 | 1;   // 0=off, 1=XOR
  key: string;   // clave textual
  reported?: string; // línea SEC reportada por el ESP (si la hay)
};

type WebSerialPortInfo = {
  usbVendorId?: number;
  usbProductId?: number;
};

type WebSerialPort = {
  open: (options: { baudRate: number }) => Promise<void>;
  readable: ReadableStream<BufferSource>;
  writable: WritableStream<Uint8Array>;
  getInfo?: () => WebSerialPortInfo;
};

type WebSerialNavigator = Navigator & {
  serial?: {
    requestPort: () => Promise<WebSerialPort>;
  };
};

const DEF: Cfg = {
  alias: '',
  freq: 433000000,
  sf: 7,
  bw: 125000,
  cr: 5,
  tx: 17,
  pre: 8,
  sync: 52,
  crc: 1,
  retries: 3,
  retryMs: 1500,
};

let localMsgSeq = 1;

// ====== Helpers numeric inputs
const sNum = (n: number) => (Number.isFinite(n) ? String(n) : '');
const toIntOrPrev = (val: string, prev: number) => {
  if (val === '' || val === undefined) return prev;
  const n = parseInt(val, 10);
  return Number.isFinite(n) ? n : prev;
};

/* ============================
   THEME
============================ */
type Theme = 'light' | 'dark';
type StyleMap = {
  page: React.CSSProperties;
  headerRow: React.CSSProperties;
  title: React.CSSProperties;
  badge: React.CSSProperties;
  btnPrimary: React.CSSProperties;
  btnGhost: React.CSSProperties;
  btnSoft: React.CSSProperties;
  infoStrip: React.CSSProperties;
  card: React.CSSProperties;
  cardHeader: React.CSSProperties;
  cardTitle: React.CSSProperties;
  fieldset: React.CSSProperties;
  legend: React.CSSProperties;
  grid: React.CSSProperties;
  input: React.CSSProperties;
  chatWrap: React.CSSProperties;
  chatList: React.CSSProperties;
  bubble: React.CSSProperties;
  from: React.CSSProperties;
  meta: React.CSSProperties;
  console: React.CSSProperties;
  muted: React.CSSProperties;
  collapseBtn: React.CSSProperties;
  colors: {
    bubbleOutBg: string;
    bubbleOutBorder: string;
    bubbleInBg: string;
    bubbleInBorder: string;
  };
};

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

function getStyles(theme: Theme): StyleMap {
  const light = {
    pageBg: '#f8fafc', text: '#0f172a', cardBg: '#ffffff', cardBorder: '#e5e7eb', cardHeaderBg: '#f8fafc',
    chipOk: '#16a34a', chipOff: '#9ca3af',
    btnPrimaryBg: '#10b981', btnPrimaryBorder: '#059669', btnPrimaryText: '#fff',
    btnGhostBg: '#fff', btnGhostBorder: '#e5e7eb', btnGhostText: '#111827',
    btnSoftBg: '#f9fafb', btnSoftBorder: '#e5e7eb',
    infoStripBg: '#ffffff', infoStripBorder: '#e5e7eb',
    inputBg: '#fff', inputBorder: '#e5e7eb', inputText: '#0f172a',
    chatSurface: '#f9fafb', bubbleOutBg: '#DCF8C6', bubbleOutBorder: '#a3e2a8',
    bubbleInBg: '#f3f4f6', bubbleInBorder: '#e5e7eb', bubbleText: '#111827',
    fromText: '#334155', metaText: '#475569',
    consoleBg: '#0b1220', consoleText: '#abf7b1', muted: '#64748b',
  };

  const dark = {
    pageBg: '#0f0f0f', text: '#eaeaea', cardBg: '#111', cardBorder: '#1e1e1e', cardHeaderBg: '#121212',
    chipOk: '#22c55e', chipOff: '#6b7280',
    btnPrimaryBg: '#0fb18f', btnPrimaryBorder: '#106a61', btnPrimaryText: '#fff',
    btnGhostBg: '#1a1a1a', btnGhostBorder: '#2a2a2a', btnGhostText: '#ddd',
    btnSoftBg: '#1a1a1a', btnSoftBorder: '#2a2a2a',
    infoStripBg: '#111', infoStripBorder: '#1e1e1e',
    inputBg: '#141414', inputBorder: '#2a2a2a', inputText: '#eaeaea',
    chatSurface: '#151515', bubbleOutBg: '#0c6f63', bubbleOutBorder: '#0b5d54',
    bubbleInBg: '#262626', bubbleInBorder: '#2f2f2f', bubbleText: '#fff',
    fromText: '#cbd5e1', metaText: '#cbd5e1',
    consoleBg: '#000', consoleText: '#76ff7a', muted: '#9ca3af',
  };

  const t = theme === 'light' ? light : dark;

  return {
    page: { padding: 20, minHeight: '100vh', background: t.pageBg, color: t.text, fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial' },
    headerRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    title: { margin: 0, fontSize: 26, letterSpacing: .2, fontWeight: 700 },
    badge: { padding: '8px 10px', borderRadius: 999, fontSize: 12 },
    btnPrimary: { padding: '10px 14px', borderRadius: 10, border: `1px solid ${t.btnPrimaryBorder}`, background: t.btnPrimaryBg, color: t.btnPrimaryText, cursor: 'pointer' },
    btnGhost: { padding: '10px 14px', borderRadius: 10, border: `1px solid ${t.btnGhostBorder}`, background: t.btnGhostBg, color: t.btnGhostText, cursor: 'pointer' },
    btnSoft: { padding: '8px 12px', borderRadius: 10, border: `1px solid ${t.btnSoftBorder}`, background: t.btnSoftBg, color: t.text, cursor: 'pointer', fontSize: 13 },
    infoStrip: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, background: t.infoStripBg, border: `1px solid ${t.infoStripBorder}`, borderRadius: 12, padding: 12, marginBottom: 12 },
    card: { border: `1px solid ${t.cardBorder}`, background: t.cardBg, borderRadius: 12, overflow: 'hidden', marginBottom: 14,
      boxShadow: theme === 'light' ? '0 2px 10px rgba(15,23,42,0.06)' : '0 6px 24px rgba(0,0,0,.35)' },
    cardHeader: { padding: 12, borderBottom: `1px solid ${t.cardBorder}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: t.cardHeaderBg },
    cardTitle: { fontWeight: 700, fontSize: 15 },
    fieldset: { border: 'none', margin: 0, padding: 12 },
    legend: { fontSize: 12, opacity: .75, marginBottom: 8 },
    grid: { display: 'grid', gridTemplateColumns: '180px 1fr 180px 1fr', gap: 10 },
    input: { padding: '10px 12px', borderRadius: 10, border: `1px solid ${t.inputBorder}`, background: t.inputBg, color: t.inputText, outline: 'none' },
    chatWrap: { padding: 12 },
    chatList: { height: 360, overflow: 'auto', padding: 4, display: 'flex', flexDirection: 'column', gap: 8, background: t.chatSurface, border: `1px solid ${t.cardBorder}`, borderRadius: 10, marginBottom: 10 },
    bubble: { maxWidth: '70%', padding: '10px 12px', borderRadius: 14, color: t.bubbleText, boxShadow: theme === 'light' ? '0 1px 4px rgba(15,23,42,0.06)' : '0 2px 10px rgba(0,0,0,.25)', whiteSpace: 'pre-wrap' },
    from: { fontSize: 11, color: t.fromText, marginBottom: 4 },
    meta: { fontSize: 11, color: t.metaText, marginTop: 6, textAlign: 'right' },
    console: { height: 160, overflow: 'auto', padding: 12, background: t.consoleBg, color: t.consoleText, fontSize: 12, lineHeight: 1.35 },
    muted: { fontSize: 12, color: t.muted },
    collapseBtn: { padding: '8px 12px', borderRadius: 10, border: `1px solid ${t.cardBorder}`, background: t.btnGhostBg, color: t.btnGhostText, cursor: 'pointer', fontSize: 13 },
    colors: {
      bubbleOutBg: t.bubbleOutBg,
      bubbleOutBorder: t.bubbleOutBorder,
      bubbleInBg: t.bubbleInBg,
      bubbleInBorder: t.bubbleInBorder,
    },
  };
}

/* ============================
   PAGE
============================ */
export default function Page() {
  const [connected, setConnected] = useState(false);
  const [cfg, setCfg] = useState<Cfg>(DEF);
  const [env, setEnv] = useState<string>('—');
  const [portInfo, setPortInfo] = useState<string>('—');
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [sys, setSys] = useState<string[]>([]);
  const [theme, setTheme] = useState<Theme>('light');

  // Collapsibles
  const [openCfg, setOpenCfg] = useState(true);
  const [openSec, setOpenSec] = useState(true);

  // Encryption UI state
  const [sec, setSec] = useState<SecCfg>({ mode: 0, key: '' });

  const writerRef = useRef<Writer>(null);
  const espIdToIndexRef = useRef<Map<number, number>>(new Map());
  const appendSys = (s: string) => setSys(prev => [...prev, s].slice(-200));

  // theme persistence
  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem('lora_theme') as Theme | null : null;
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem('lora_theme', theme);
  }, [theme]);

  const s = getStyles(theme);

  useEffect(() => {
    const ok = typeof navigator !== 'undefined' && 'serial' in navigator;
    setEnv(`WebSerial: ${ok ? 'OK' : 'NO'} | ${navigator.userAgent}`);
  }, []);

  function parseCfgLine(line: string) {
    const out: Cfg = { ...DEF, ...cfg };
    const setInt = (v: string, prev: number) => {
      const n = parseInt(v, 10);
      return Number.isFinite(n) ? n : prev;
    };
    const body = line.slice(4);
    body.split(';').forEach(pair => {
      const [kRaw, vRaw] = pair.split('=');
      if (!kRaw || vRaw === undefined) return;
      const k = kRaw.trim(); const v = vRaw.trim();
      if (k === 'alias') out.alias = v;
      else if (k === 'freq') out.freq = setInt(v, out.freq);
      else if (k === 'sf')   out.sf   = setInt(v, out.sf);
      else if (k === 'bw')   out.bw   = setInt(v, out.bw);
      else if (k === 'cr')   out.cr   = setInt(v, out.cr);
      else if (k === 'tx')   out.tx   = setInt(v, out.tx);
      else if (k === 'pre')  out.pre  = setInt(v, out.pre);
      else if (k === 'sync') out.sync = setInt(v, out.sync);
      else if (k === 'crc')  out.crc  = setInt(v, out.crc);
      else if (k === 'retries') out.retries = setInt(v, out.retries);
      else if (k === 'rms')     out.retryMs = setInt(v, out.retryMs);
    });
    setCfg(out);
  }

  // Optional: parse SEC line from firmware if it prints "SEC mode=...;key=..."
  function parseSecLine(line: string) {
    const body = line.slice(4); // remove 'SEC '
    setSec(prev => ({ ...prev, reported: body }));
  }

  async function connect() {
    try {
      const serial = (navigator as WebSerialNavigator).serial;
      if (!serial) {
        appendSys('Web Serial no disponible en este navegador.');
        return;
      }

      const port = await serial.requestPort();
      await port.open({ baudRate: 115200 });

      const dec = new TextDecoderStream();
      const enc = new TextEncoderStream();
      port.readable.pipeTo(dec.writable);
      enc.readable.pipeTo(port.writable);

      const reader = dec.readable.getReader();
      const writer = enc.writable.getWriter();
      writerRef.current = writer;

      const info = port.getInfo ? port.getInfo() : {};
      setPortInfo(JSON.stringify(info));

      setConnected(true);
      appendSys('Conectado. Si no ves READY, pulsa EN (reset).');

      let buf = '';

      const flushLine = (raw: string) => {
        const line = raw.trim();
        if (!line) return;
        if (/^(rst:|ets |load:|entry |clk|de:DIO|,len:)/i.test(line) || line === '00') return;

        if (line.startsWith('CFG ')) { parseCfgLine(line); return; }
        if (line.startsWith('SEC ')) { parseSecLine(line); appendSys(line); return; }
        if (line.startsWith('READY ')) { appendSys(line); return; }

        // YOU: OUT #id
        {
          const m = line.match(/^YOU:\s*OUT\s*#(\d+)/);
          if (m) {
            const outId = parseInt(m[1], 10);
            setMsgs(prev => {
              const out = [...prev];
              for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].outgoing && out[i].espId === undefined) {
                  out[i] = { ...out[i], espId: outId, tryNo: out[i].tryNo ?? 1, tryTotal: out[i].tryTotal ?? (cfg.retries + 1) };
                  (espIdToIndexRef.current).set(outId, i);
                  break;
                }
              }
              return out;
            });
            return;
          }
        }

        // YOU: TRY #id i/N
        {
          const m = line.match(/^YOU:\s*TRY\s*#(\d+)\s+(\d+)\s*\/\s*(\d+)/);
          if (m) {
            const id = parseInt(m[1], 10);
            const cur = parseInt(m[2], 10);
            const tot = parseInt(m[3], 10);
            setMsgs(prev => {
              const out = [...prev];
              const idx = espIdToIndexRef.current.get(id);
              if (idx !== undefined && out[idx]) out[idx] = { ...out[idx], tryNo: cur, tryTotal: tot };
              return out;
            });
            return;
          }
        }

        // YOU: ✓ Entregado #id
        {
          const m = line.match(/^YOU:\s*✓\s*Entregado\s*#(\d+)/);
          if (m) {
            const id = parseInt(m[1], 10);
            setMsgs(prev => {
              const out = [...prev];
              const idx = espIdToIndexRef.current.get(id);
              if (idx !== undefined && out[idx]) {
                out[idx] = { ...out[idx], delivered: true };
                espIdToIndexRef.current.delete(id);
              } else {
                for (let i = out.length - 1; i >= 0; i--) {
                  if (out[i].outgoing && out[i].espId === id) { out[i] = { ...out[i], delivered: true }; break; }
                }
              }
              return out;
            });
            return;
          }
        }

        // YOU: FAIL #id
        {
          const m = line.match(/^YOU:\s*FAIL\s*#(\d+)/);
          if (m) {
            const id = parseInt(m[1], 10);
            setMsgs(prev => {
              const out = [...prev];
              const idx = espIdToIndexRef.current.get(id);
              if (idx !== undefined && out[idx]) {
                out[idx] = { ...out[idx], failed: true };
                espIdToIndexRef.current.delete(id);
              }
              return out;
            });
            return;
          }
        }

        // RX: alias: texto
        if (line.startsWith('RX: ')) {
          const payload = line.slice(4).trim();
          const sep = payload.indexOf(':');
          let from = '??';
          let text = payload;
          if (sep >= 0) { from = payload.slice(0, sep).trim(); text = payload.slice(sep + 1).trim(); }
          const msg: ChatMsg = { id: localMsgSeq++, from, text, outgoing: false, delivered: true };
          setMsgs(prev => [...prev, msg].slice(-500));
          return;
        }

        appendSys(line);
      };

      (async () => {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            if (value === undefined) continue;

            buf += value;
            buf = buf.replace(/\r\n/g, '\n');
            let cut = -1;
            while (true) {
              const lf = buf.indexOf('\n');
              const cr = buf.indexOf('\r');
              if (lf < 0 && cr < 0) break;
              cut = (lf >= 0 && cr >= 0) ? Math.min(lf, cr) : (lf >= 0 ? lf : cr);
              const rawLine = buf.slice(0, cut);
              buf = buf.slice(cut + 1);
              flushLine(rawLine);
            }
          }
        } catch (error: unknown) {
          appendSys('ERR read: ' + getErrorMessage(error));
        } finally {
          reader.releaseLock();
          setConnected(false);
          setCfg(DEF);
          writerRef.current = null;
          espIdToIndexRef.current.clear();
          appendSys('Desconectado (reader cerrado).');
        }
      })();

      setTimeout(() => writerRef.current?.write(`/cfg get\n`), 150);
      setTimeout(() => writerRef.current?.write(`/sec get\n`), 200); // por si el firmware lo soporta
    } catch (error: unknown) {
      appendSys('No se pudo abrir el puerto: ' + getErrorMessage(error));
    }
  }

  async function disconnect() {
    try {
      writerRef.current?.releaseLock();
      writerRef.current = null;
      setConnected(false);
      setCfg(DEF);
      espIdToIndexRef.current.clear();
      appendSys('Desconectado.');
    } catch (error: unknown) {
      appendSys('ERR disconnect: ' + getErrorMessage(error));
    }
  }

  // Enviar
  async function send(text: string) {
    const msgText = text.trim();
    if (!msgText) return;
    if (!writerRef.current) return appendSys('No conectado.');
    await writerRef.current.write(msgText + '\n');
    const myMsg: ChatMsg = {
      id: localMsgSeq++, from: cfg.alias || 'YOU', text: msgText,
      outgoing: true, delivered: false, failed: false, tryNo: 1, tryTotal: cfg.retries + 1,
    };
    setMsgs(prev => [...prev, myMsg].slice(-500));
  }

  // Aplicar configuración radio
  async function applyCfg() {
    if (!writerRef.current) return appendSys('No conectado.');
    const cmd = `/cfg set alias=${cfg.alias};freq=${cfg.freq};sf=${cfg.sf};bw=${cfg.bw};cr=${cfg.cr};tx=${cfg.tx};pre=${cfg.pre};sync=${cfg.sync};crc=${cfg.crc};retries=${cfg.retries};rms=${cfg.retryMs}\n`;
    await writerRef.current.write(cmd);
    setTimeout(() => writerRef.current?.write(`/cfg get\n`), 120);
  }

  // Aplicar encriptación
  async function applySec() {
    if (!writerRef.current) return appendSys('No conectado.');
    const safeKey = sec.key.replace(/;/g, '').trim(); // evitar romper el parser
    const cmd = `/sec set mode=${sec.mode};key=${safeKey}\n`;
    await writerRef.current.write(cmd);
    setTimeout(() => writerRef.current?.write(`/sec get\n`), 120);
  }

  // UI utils
  const clearChat = () => setMsgs([]);
  const clearConsole = () => setSys([]);
  const toggleTheme = () => setTheme(prev => (prev === 'light' ? 'dark' : 'light'));

  return (
    <main style={s.page}>
      {/* Header */}
      <div style={s.headerRow}>
        <h1 style={s.title}>WhsprNet</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button onClick={toggleTheme} style={s.btnGhost}>
            Tema: {theme === 'light' ? 'Claro' : 'Oscuro'}
          </button>
          <span style={{
            ...s.badge,
            backgroundColor: connected ? (theme==='light'?'#16a34a':'#22c55e') : (theme==='light'?'#9ca3af':'#6b7280'),
            color: '#fff'
          }}>
            {connected ? 'Conectado' : 'Desconectado'}
          </span>
          <button onClick={connect} disabled={connected} style={s.btnPrimary}>Conectar</button>
          <button onClick={disconnect} disabled={!connected} style={s.btnGhost}>Desconectar</button>
        </div>
      </div>

      {/* Info ambiente */}
      <div style={s.infoStrip}>
        <div>Entorno: <b>{env}</b></div>
        <div>Port info: <b>{portInfo}</b></div>
      </div>

      {/* Configuración (colapsable) */}
      <section style={s.card}>
        <div style={s.cardHeader}>
          <div style={s.cardTitle}>Configuración</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOpenCfg(v => !v)} style={s.collapseBtn}>{openCfg ? 'Ocultar' : 'Mostrar'}</button>
            <button onClick={applyCfg} disabled={!connected} style={s.btnPrimary}>Aplicar configuración</button>
          </div>
        </div>
        {openCfg && <Settings cfg={cfg} setCfg={setCfg} disabled={!connected} s={s} />}
      </section>

      {/* Encriptación (colapsable) */}
      <section style={s.card}>
        <div style={s.cardHeader}>
          <div style={s.cardTitle}>Encriptación</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setOpenSec(v => !v)} style={s.collapseBtn}>{openSec ? 'Ocultar' : 'Mostrar'}</button>
            <button onClick={applySec} disabled={!connected} style={s.btnPrimary}>Aplicar encriptación</button>
          </div>
        </div>
        {openSec && <EncryptionPanel sec={sec} setSec={setSec} s={s} />}
      </section>

      {/* Chat */}
      <section style={s.card}>
        <div style={s.cardHeader}>
          <div style={s.cardTitle}>Chat</div>
          <button onClick={clearChat} style={s.btnSoft}>Limpiar chat</button>
        </div>
        <ChatView msgs={msgs} onSend={send} disabled={!connected} s={s} />
      </section>

      {/* Consola */}
      <section style={s.card}>
        <div style={s.cardHeader}>
          <div style={s.cardTitle}>Consola</div>
          <button onClick={clearConsole} style={s.btnSoft}>Limpiar consola</button>
        </div>
        <pre style={s.console}>{sys.join('\n')}</pre>
      </section>
    </main>
  );
}

/* ============================
   SETTINGS
============================ */
function Settings({ cfg, setCfg, disabled, s }:
  { cfg: Cfg; setCfg: (c: Cfg)=>void; disabled: boolean; s: StyleMap }) {

  return (
    <fieldset style={s.fieldset}>
      <legend style={s.legend}>Parámetros</legend>
      <div style={s.grid}>
        <label>Alias</label>
        <input value={cfg.alias} onChange={e=>setCfg({ ...cfg, alias:e.target.value })} disabled={disabled} style={s.input} />

        <label>Frecuencia (Hz)</label>
        <input inputMode="numeric" value={sNum(cfg.freq)}
          onChange={e=>setCfg({ ...cfg, freq: toIntOrPrev(e.target.value, cfg.freq) })} disabled={disabled} style={s.input} />

        <label>Spreading Factor</label>
        <select value={sNum(cfg.sf)}
          onChange={e=>setCfg({ ...cfg, sf: toIntOrPrev(e.target.value, cfg.sf) })} disabled={disabled} style={s.input}>
          {[6,7,8,9,10,11,12].map(n=><option key={n} value={n}>{n}</option>)}
        </select>

        <label>Bandwidth (Hz)</label>
        <select value={sNum(cfg.bw)}
          onChange={e=>setCfg({ ...cfg, bw: toIntOrPrev(e.target.value, cfg.bw) })} disabled={disabled} style={s.input}>
          {[7800,10400,15600,20800,31250,41700,62500,125000,250000,500000].map(n=><option key={n} value={n}>{n}</option>)}
        </select>

        <label>Coding Rate (4/x)</label>
        <select value={sNum(cfg.cr)}
          onChange={e=>setCfg({ ...cfg, cr: toIntOrPrev(e.target.value, cfg.cr) })} disabled={disabled} style={s.input}>
          {[5,6,7,8].map(n=><option key={n} value={n}>{n}</option>)}
        </select>

        <label>CRC</label>
        <select value={sNum(cfg.crc)}
          onChange={e=>setCfg({ ...cfg, crc: toIntOrPrev(e.target.value, cfg.crc) })} disabled={disabled} style={s.input}>
          <option value={1}>On</option>
          <option value={0}>Off</option>
        </select>

        <label>Reintentos</label>
        <input inputMode="numeric" value={sNum(cfg.retries)}
          onChange={e=>setCfg({ ...cfg, retries: toIntOrPrev(e.target.value, cfg.retries) })} disabled={disabled} style={s.input} />

        <label>Intervalo reintento (ms)</label>
        <input inputMode="numeric" value={sNum(cfg.retryMs)}
          onChange={e=>setCfg({ ...cfg, retryMs: toIntOrPrev(e.target.value, cfg.retryMs) })} disabled={disabled} style={s.input} />
      </div>
    </fieldset>
  );
}

/* ============================
   ENCRYPTION PANEL (UI)
============================ */
function EncryptionPanel({ sec, setSec, s }: { sec: SecCfg; setSec: (v: SecCfg)=>void; s: StyleMap }) {
  return (
    <fieldset style={{ padding: 12, border: 'none' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 180px 1fr', gap: 10 }}>
        <label>Modo</label>
        <select
          value={sec.mode}
          onChange={e => setSec({ ...sec, mode: Number(e.target.value) as 0|1 })}
          style={s.input}
        >
          <option value={0}>Sin encriptar</option>
          <option value={1}>XOR con clave (simple)</option>
        </select>

        <label>Clave</label>
        <input
          style={s.input}
          placeholder="e.g. mi-clave-secreta"
          value={sec.key}
          onChange={e => setSec({ ...sec, key: e.target.value })}
        />
      </div>

      <p style={{ marginTop: 8, ...s.muted }}>
        • Este panel envía <code>/sec set mode=...;key=...</code> (si tu firmware lo soporta).<br/>
        • XOR es liviano y suficiente para pruebas; para producción, migrar a AES-CTR/ChaCha20-Poly1305.
      </p>

      {sec.reported && (
        <div style={{ marginTop: 6, fontSize: 12 }}>
          <b>Estado del ESP:</b> <code>SEC {sec.reported}</code>
        </div>
      )}
    </fieldset>
  );
}

/* ============================
   CHAT
============================ */
function ChatView({ msgs, onSend, disabled, s }:
  { msgs: ChatMsg[]; onSend: (t: string)=>void; disabled: boolean; s: StyleMap }) {

  const [text, setText] = useState('');

  const sendNow = () => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText('');
  };

  const statusText = (m: ChatMsg) => {
    if (m.failed) return '✗ sin entrega';
    if (m.delivered) return '✔ entregado';
    const i = m.tryNo ?? 1;
    const n = m.tryTotal ?? 1;
    return `⏳ entregando (${i}/${n})`;
  };

  return (
    <div style={s.chatWrap}>
      <div style={s.chatList}>
        {msgs.map(m => (
          <div key={m.id} style={{ display: 'flex', justifyContent: m.outgoing ? 'flex-end' : 'flex-start' }}>
            <div style={{
              ...s.bubble,
              background: m.outgoing ? s.colors.bubbleOutBg : s.colors.bubbleInBg,
              border: `1px solid ${m.outgoing ? s.colors.bubbleOutBorder : s.colors.bubbleInBorder}`
            }}>
              {!m.outgoing && <div style={s.from}>{m.from}</div>}
              <div>{m.text}</div>
              {m.outgoing && <div style={s.meta}>{statusText(m)}</div>}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          style={s.input}
          placeholder="Escribe un mensaje…"
          value={text}
          disabled={disabled}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') sendNow(); }}
        />
        <button onClick={sendNow} disabled={disabled || !text.trim()} style={s.btnPrimary}>Enviar</button>
      </div>
    </div>
  );
}
