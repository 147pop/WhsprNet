#include <SPI.h>
#include <LoRa.h>
#include "mbedtls/base64.h"   // incluido en core ESP32

// ===== Pines ESP32 ↔ RA-02 (SX1278)
#define PIN_LORA_MOSI   23
#define PIN_LORA_MISO   19
#define PIN_LORA_SCK    18
#define PIN_LORA_CS     5
#define PIN_LORA_RST    2
#define PIN_LORA_DIO0   4

// ===== Defaults radio
#define DEF_FREQ   433E6
#define DEF_SF     7
#define DEF_BW     125E3
#define DEF_CR     5         // 4/5
#define DEF_TX     17        // dBm
#define DEF_PRE    8         // símbolos
#define DEF_SYNC   0x34      // 52
#define DEF_CRC    1         // on

// ===== Confiabilidad (retries)
#define DEF_RETRIES  3
#define DEF_RETRY_MS 1500

// ===== Cola
#define MAX_QUEUE 16

// ===== Anti-duplicados
#define PEER_CACHE_N 6

// ===== Seguridad (XOR simple)
struct SecState {
  int mode;        // 0=off, 1=XOR
  String key;      // clave textual
} Sec = {0, ""};

// ===== CFG
struct RadioCfg {
  String alias;
  long   freq;
  int    sf;
  long   bw;
  int    cr4;       // 5..8  => 4/5..4/8
  int    tx;        // dBm
  int    pre;       // preámbulo
  uint8_t sync;     // 0..255
  bool   crcOn;

  int    retries;   // nº reintentos
  int    retryMs;   // ms entre intentos
} Cfg;

String nodeId;

// ===== Estado TX/ACK + COLA =====
unsigned long globalMsgCounter = 0;

struct OutMsg {
  bool used;                 // slot en uso
  unsigned long id;          // id lógico del mensaje
  String packet;             // "MSG,<id>,<alias>,<payload>"
  int retriesDone;           // reintentos ya realizados (0..Cfg.retries)
  unsigned long lastSendMs;  // timestamp último envío
};

OutMsg q[MAX_QUEUE];
int qHead = 0;   // índice del mensaje en curso (si lo hay)
int qTail = 0;   // para encolar
int qCount = 0;  // nº de elementos en cola

// Devuelve puntero al mensaje en curso (frente de cola) o nullptr
OutMsg* frontMsg() {
  if (qCount == 0) return nullptr;
  return &q[qHead];
}

// Encola un paquete listo para TX
bool enqueueMsg(const String& packet, unsigned long id) {
  if (qCount >= MAX_QUEUE) return false;
  int idx = qTail;
  q[idx].used = true;
  q[idx].id = id;
  q[idx].packet = packet;
  q[idx].retriesDone = 0;
  q[idx].lastSendMs = 0;
  qTail = (qTail + 1) % MAX_QUEUE;
  qCount++;
  return true;
}

// Desencola el frente
void popFront() {
  if (qCount == 0) return;
  q[qHead].used = false;
  q[qHead].packet = "";
  qHead = (qHead + 1) % MAX_QUEUE;
  qCount--;
}

// ===== Anti-duplicados
struct Peer { String alias; unsigned long lastId; };
Peer peers[PEER_CACHE_N];

int peerIndexOf(const String& a) {
  for (int i=0;i<PEER_CACHE_N;i++) if (peers[i].alias == a) return i;
  return -1;
}
int peerAllocSlot(const String& a) {
  for (int i=0;i<PEER_CACHE_N;i++) if (peers[i].alias.length()==0) { peers[i].alias = a; peers[i].lastId = 0; return i; }
  peers[0].alias = a; peers[0].lastId = 0; return 0;
}
bool isDuplicate(const String& sender, unsigned long id) {
  int idx = peerIndexOf(sender);
  if (idx < 0) idx = peerAllocSlot(sender);
  if (id <= peers[idx].lastId) return true;
  peers[idx].lastId = id;
  return false;
}

// ===== Helpers num
static inline long clampL(long v, long a, long b){ return v<a?a:(v>b?b:v); }
static inline int  clampI(int v, int a, int b){ return v<a?a:(v>b?b:v); }

// ===== XOR helper
static void xorInPlace(uint8_t* buf, size_t len, const String& key){
  if (key.length()==0) return;
  const size_t klen = key.length();
  for (size_t i=0;i<len;i++) buf[i] ^= (uint8_t)key[(i % klen)];
}

// ===== Base64 helpers (sin unique_ptr)
static String b64encode(const uint8_t* data, size_t len){
  size_t out_len = 0;
  size_t cap = (len*4)/3 + 8;  // margen
  unsigned char* out = (unsigned char*)malloc(cap);
  if (!out) return String();
  int rc = mbedtls_base64_encode(out, cap, &out_len, data, len);
  String res;
  if (rc == 0) {
    for (size_t i=0;i<out_len;i++) res += (char)out[i];
  }
  free(out);
  return res;
}

static bool b64decode(const String& in, uint8_t** out_buf, size_t* out_len){
  *out_buf = nullptr; *out_len = 0;
  size_t cap = (in.length()*3)/4 + 8;
  uint8_t* buf = (uint8_t*)malloc(cap);
  if (!buf) return false;
  size_t olen = 0;
  int rc = mbedtls_base64_decode(buf, cap, &olen,
                                 (const unsigned char*)in.c_str(), in.length());
  if (rc == 0) { *out_buf = buf; *out_len = olen; return true; }
  free(buf);
  return false;
}

// ===== Radio
void applyCfg() {
  LoRa.setFrequency(Cfg.freq);
  LoRa.setSpreadingFactor(Cfg.sf);
  LoRa.setSignalBandwidth(Cfg.bw);
  LoRa.setCodingRate4(Cfg.cr4);
  LoRa.setTxPower(Cfg.tx);
  LoRa.setPreambleLength(Cfg.pre);
  LoRa.setSyncWord(Cfg.sync);
  if (Cfg.crcOn) LoRa.enableCrc(); else LoRa.disableCrc();
}

void printCfg() {
  Serial.print("CFG alias="); Serial.print(Cfg.alias);
  Serial.print(";freq=");     Serial.print(Cfg.freq);
  Serial.print(";sf=");       Serial.print(Cfg.sf);
  Serial.print(";bw=");       Serial.print(Cfg.bw);
  Serial.print(";cr=");       Serial.print(Cfg.cr4);
  Serial.print(";tx=");       Serial.print(Cfg.tx);
  Serial.print(";pre=");      Serial.print(Cfg.pre);
  Serial.print(";sync=");     Serial.print((int)Cfg.sync);
  Serial.print(";crc=");      Serial.print(Cfg.crcOn?1:0);
  Serial.print(";retries=");  Serial.print(Cfg.retries);
  Serial.print(";rms=");      Serial.println(Cfg.retryMs);
}

void printSec() {
  Serial.print("SEC mode="); Serial.print(Sec.mode);
  Serial.print(";keylen=");  Serial.println((int)Sec.key.length());
}

// ===== CFG parser
bool startsWithCI(const String& s, const char* pfx) {
  int n = strlen(pfx);
  if ((int)s.length() < n) return false;
  for (int i=0;i<n;i++) if (tolower(s[i]) != tolower(pfx[i])) return false;
  return true;
}

void handleCfgSet(const String& kvs) {
  int pos = 0; int safety = 0;
  while (pos < kvs.length() && safety++ < 200) {
    int sep = kvs.indexOf(';', pos);
    String pair = (sep==-1) ? kvs.substring(pos) : kvs.substring(pos, sep);
    pair.trim();
    if (pair.length()) {
      int eq = pair.indexOf('=');
      if (eq > 0) {
        String k = pair.substring(0, eq); k.trim(); k.toLowerCase();
        String v = pair.substring(eq+1);  v.trim();
        if (k=="alias") { Cfg.alias = v; }
        else if (k=="freq") { Cfg.freq = clampL(v.toInt(), 137E6, 1020E6); }
        else if (k=="sf")   { Cfg.sf = clampI(v.toInt(), 6, 12); }
        else if (k=="bw")   {
          long bw = v.toInt();
          long allowed[] = {7800,10400,15600,20800,31250,41700,62500,125000,250000,500000};
          long best = 125000; long diffBest = 1000000000L;
          for (long a: allowed) { long d = labs(a - bw); if (d < diffBest) { diffBest = d; best = a; } }
          Cfg.bw = best;
        }
        else if (k=="cr")   { Cfg.cr4 = clampI(v.toInt(), 5, 8); }
        else if (k=="tx")   { Cfg.tx  = clampI(v.toInt(), 2, 20); }
        else if (k=="pre")  { Cfg.pre = clampI(v.toInt(), 4, 65535); }
        else if (k=="sync") {
          int val = (v.startsWith("0x")||v.startsWith("0X")) ? strtol(v.c_str(), nullptr, 16) : v.toInt();
          Cfg.sync = (uint8_t)(val & 0xFF);
        }
        else if (k=="crc")  { Cfg.crcOn = (v.toInt()!=0); }
        else if (k=="retries") { Cfg.retries = clampI(v.toInt(), 0, 10); }
        else if (k=="rms")     { Cfg.retryMs = clampI(v.toInt(), 100, 60000); }
      }
    }
    if (sep==-1) break;
    pos = sep+1;
  }
  applyCfg();
  Serial.println("OK");
  printCfg();
}

// SEC set/get
void handleSecSet(const String& kvs) {
  int pos = 0, safety = 0;
  int newMode = Sec.mode;
  String newKey = Sec.key;

  while (pos < kvs.length() && safety++ < 100) {
    int sep = kvs.indexOf(';', pos);
    String pair = (sep==-1) ? kvs.substring(pos) : kvs.substring(pos, sep);
    pair.trim();
    if (pair.length()) {
      int eq = pair.indexOf('=');
      if (eq > 0) {
        String k = pair.substring(0, eq); k.trim(); k.toLowerCase();
        String v = pair.substring(eq+1);  v.trim();
        if (k=="mode") newMode = clampI(v.toInt(), 0, 1);
        else if (k=="key") newKey = v; // front-end limpia ';'
      }
    }
    if (sep==-1) break;
    pos = sep+1;
  }

  Sec.mode = newMode;
  Sec.key  = newKey;
  Serial.println("OK");
  printSec();
}

void handleCommand(const String& line) {
  String cmd = line; cmd.trim();
  if (startsWithCI(cmd, "/cfg get")) { printCfg(); return; }
  if (startsWithCI(cmd, "/cfg set")) {
    int p = cmd.indexOf(' '); p = cmd.indexOf(' ', p+1);
    if (p < 0 || p+1 >= cmd.length()) { Serial.println("ERR syntax"); return; }
    String kvs = cmd.substring(p+1);
    handleCfgSet(kvs);
    return;
  }
  if (startsWithCI(cmd, "/alias ")) {
    Cfg.alias = cmd.substring(7); Cfg.alias.trim();
    Serial.println("OK"); printCfg(); return;
  }
  if (startsWithCI(cmd, "/sec get")) { printSec(); return; }
  if (startsWithCI(cmd, "/sec set")) {
    int p = cmd.indexOf(' '); p = cmd.indexOf(' ', p+1);
    if (p < 0 || p+1 >= cmd.length()) { Serial.println("ERR syntax"); return; }
    String kvs = cmd.substring(p+1);
    handleSecSet(kvs);
    return;
  }
  Serial.println("ERR unknown");
}

// ===== Utilidades de TX =====
void sendRaw(const String& s) { LoRa.beginPacket(); LoRa.print(s); LoRa.endPacket(); }
void sendAck(unsigned long id) { sendRaw("ACK," + String(id) + "," + Cfg.alias); }

String buildPayloadEncrypted(const String& plain) {
  // ENC1: base64(xor(plain, key))
  size_t n = plain.length();
  uint8_t* buf = (uint8_t*)malloc(n);
  if (!buf) return String("ENC1:");
  memcpy(buf, plain.c_str(), n);
  xorInPlace(buf, n, Sec.key);
  String b64 = b64encode(buf, n);
  free(buf);
  return "ENC1:" + b64;
}

// Encolado público
void queueMessage(const String& textPlain) {
  // crear id y payload/packet
  globalMsgCounter++;
  unsigned long id = globalMsgCounter;

  String payload;
  if (Sec.mode==1 && Sec.key.length()>0) payload = buildPayloadEncrypted(textPlain);
  else payload = textPlain;

  String packet = "MSG," + String(id) + "," + Cfg.alias + "," + payload;

  if (!enqueueMsg(packet, id)) {
    Serial.println("YOU: ERR queue full");
    return;
  }

  // si no hay nada enviándose, el state machine lo tomará y enviará de inmediato
}

// Intenta enviar el frente si corresponde (primera vez)
void maybeKickSendFront() {
  OutMsg* m = frontMsg();
  if (!m) return;
  if (m->lastSendMs == 0) {
    // primer envío
    sendRaw(m->packet);
    m->lastSendMs = millis();
    m->retriesDone = 0;
    Serial.print("YOU: OUT #"); Serial.println(m->id);
    // anunciar TRY 1/N (primer intento cuenta como 1)
    Serial.print("YOU: TRY #"); Serial.print(m->id);
    Serial.print(" "); Serial.print(1); Serial.print("/"); Serial.println(Cfg.retries + 1);
  }
}

// Maneja timeout y reenvío del frente
void handleFrontTimeout() {
  OutMsg* m = frontMsg();
  if (!m) return;

  unsigned long now = millis();
  if (now - m->lastSendMs >= (unsigned long)Cfg.retryMs) {
    if (m->retriesDone < Cfg.retries) {
      m->retriesDone++;
      m->lastSendMs = now;
      sendRaw(m->packet);
      // anunciar TRY (# intentos = retriesDone+1)
      Serial.print("YOU: TRY #"); Serial.print(m->id);
      Serial.print(" "); Serial.print(m->retriesDone + 1);
      Serial.print("/"); Serial.println(Cfg.retries + 1);
    } else {
      // falló → notificar y sacar de la cola
      Serial.print("YOU: FAIL #"); Serial.println(m->id);
      popFront();
      // si hay más en cola, arrancar el siguiente
      maybeKickSendFront();
    }
  }
}

// Al recibir ACK: confirmar y pasar al siguiente
void confirmAck(unsigned long id, const String& ackFrom) {
  OutMsg* m = frontMsg();
  if (!m) return;
  if (m->id == id) {
    Serial.print("YOU: ");
    Serial.print("✓ Entregado #");
    Serial.print(id);
    Serial.print(" por ");
    Serial.println(ackFrom);
    popFront();
    maybeKickSendFront(); // dispara siguiente si lo hay
  }
}

// ===== RX/Protocolo =====
bool tryDecryptInPlace(String& text) {
  if (!text.startsWith("ENC1:")) return false;
  String b64 = text.substring(5);
  uint8_t* ciph = nullptr; size_t clen = 0;
  if (!b64decode(b64, &ciph, &clen)) return false;
  if (!ciph || clen == 0) { if (ciph) free(ciph); return false; }

  if (Sec.mode != 1 || Sec.key.length()==0) {
    // sin clave/mode → dejar "ENC1:..." tal cual
    free(ciph);
    return false;
  }
  xorInPlace(ciph, clen, Sec.key);

  String plain; plain.reserve(clen);
  for (size_t i=0;i<clen;i++) plain += (char)ciph[i];
  free(ciph);

  text = plain;
  return true;
}

void handleIncoming(const String& line) {
  if (line.startsWith("MSG,")) {
    // MSG,<id>,<alias>,<texto|ENC1:...>
    int p1 = line.indexOf(',');
    int p2 = line.indexOf(',', p1+1);
    int p3 = line.indexOf(',', p2+1);
    if (p1<0 || p2<0 || p3<0) return;

    unsigned long id = line.substring(p1+1, p2).toInt();
    String sender = line.substring(p2+1, p3);
    String text   = line.substring(p3+1);

    sendAck(id);
    if (isDuplicate(sender, id)) return;

    (void) tryDecryptInPlace(text);

    Serial.print("RX: ");
    Serial.print(sender);
    Serial.print(": ");
    Serial.println(text);
  }
  else if (line.startsWith("ACK,")) {
    // ACK,<id>,<alias>
    int p1 = line.indexOf(',');
    int p2 = line.indexOf(',', p1+1);
    if (p1<0 || p2<0) return;

    unsigned long id = line.substring(p1+1, p2).toInt();
    String ackFrom   = line.substring(p2+1);

    confirmAck(id, ackFrom);
  }
}

// ===== setup/loop
void setup() {
  Serial.begin(115200);
  delay(300);

  nodeId = "Node-" + String((uint32_t)ESP.getEfuseMac(), HEX);

  Cfg.alias = nodeId;
  Cfg.freq  = DEF_FREQ; Cfg.sf = DEF_SF; Cfg.bw = DEF_BW; Cfg.cr4 = DEF_CR;
  Cfg.tx    = DEF_TX;   Cfg.pre= DEF_PRE; Cfg.sync = DEF_SYNC; Cfg.crcOn = DEF_CRC;
  Cfg.retries = DEF_RETRIES;
  Cfg.retryMs = DEF_RETRY_MS;

  for (int i=0;i<MAX_QUEUE;i++){ q[i].used=false; }
  for (int i=0;i<PEER_CACHE_N;i++){ peers[i].alias=""; peers[i].lastId=0; }

  LoRa.setPins(PIN_LORA_CS, PIN_LORA_RST, PIN_LORA_DIO0);
  LoRa.setSPIFrequency(20000000);
  if (!LoRa.begin(Cfg.freq)) {
    Serial.println("ERR: LoRa init");
    while (1) { delay(1000); }
  }
  applyCfg();
  LoRa.enableCrc();

  Serial.println("READY " + nodeId);
  printCfg();
  printSec();
}

void loop() {
  // 1) Procesar RX LoRa
  int sz = LoRa.parsePacket();
  if (sz) {
    String in;
    while (LoRa.available()) in += (char)LoRa.read();
    handleIncoming(in);
  }

  // 2) Procesar comandos/entrada por serie
  static String line;
  while (Serial.available()) {
    char c = (char)Serial.read();
    if (c == '\n' || c == '\r') {
      line.trim();
      if (line.length()) {
        if (line[0] == '/') handleCommand(line);
        else queueMessage(line);   // <-- ahora encolamos
      }
      line = "";
    } else {
      line += c;
    }
  }

  // 3) State machine de TX/ACK con cola
  //    - si no hay envío en curso, dispara el frente
  maybeKickSendFront();
  //    - si hay envío en curso, manejar reintentos por timeout
  handleFrontTimeout();
}