// Música de fondo generativa: piano suave y espaciado sobre acordes lentos con
// mucha reverberación, un ambiente tranquilo de juego de construcción. No
// reproduce ninguna pieza: las notas se eligen al azar dentro de los acordes y
// de la pentatónica de Do, la misma de los sonidos de la interfaz. La carga
// interfaz.js solo cuando se activa el sonido.

// Acordes de 8 s en Do, con séptimas y novenas, en Hz (octava 4).
const ACORDES = [
  [262, 330, 392, 494], // Do maj7
  [220, 262, 330, 392], // La m7
  [175, 220, 262, 330], // Fa maj7
  [196, 262, 294, 330], // Sol sus con sexta
];
const DURACION_ACORDE = 8;
// Volumen general de la música, por debajo de los sonidos de la interfaz.
const VOLUMEN = 0.25;
const PENTA = [262, 294, 330, 392, 440, 523, 587, 659, 784, 880, 1047];

let ctx = null;
let salida = null;
let maestro = null;
let reloj = null;
let siguiente = 0;
let indice = 5;
let acordeActual = -1;

// Reverberación sintética: ruido que decae en unos 2,5 s (más corto pesa menos en CPUs de móvil), distinto en cada canal.
function reverberacion() {
  const largo = Math.floor(ctx.sampleRate * 2.5);
  const impulso = ctx.createBuffer(2, largo, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const datos = impulso.getChannelData(c);
    for (let i = 0; i < largo; i++) datos[i] = (Math.random() * 2 - 1) * (1 - i / largo) ** 2.5;
  }
  const conv = ctx.createConvolver();
  conv.buffer = impulso;
  return conv;
}

// Nota de piano: fundamental y dos armónicos que se apagan antes, para que el
// ataque tenga cuerpo y la cola quede limpia.
function piano(f, t, vol) {
  for (const [mult, peso, caida] of [[1, 1, 3.2], [2, 0.3, 1.4], [3, 0.08, 0.7]]) {
    const osc = ctx.createOscillator();
    const gan = ctx.createGain();
    osc.frequency.value = f * mult;
    gan.gain.setValueAtTime(0, t);
    gan.gain.linearRampToValueAtTime(vol * peso, t + 0.015);
    gan.gain.setTargetAtTime(0, t + 0.015, caida / 4);
    gan.gain.setValueAtTime(0, t + caida + 0.1);
    osc.connect(gan).connect(salida);
    osc.start(t);
    osc.stop(t + caida + 0.12);
  }
}

// Colchón del acorde: entra y sale despacio, casi no se oye entrar.
function colchon(acorde, t) {
  for (const f of acorde) {
    const osc = ctx.createOscillator();
    const gan = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = f;
    osc.detune.value = (Math.random() - 0.5) * 8;
    gan.gain.setValueAtTime(0, t);
    gan.gain.linearRampToValueAtTime(0.012, t + 3);
    gan.gain.linearRampToValueAtTime(0, t + DURACION_ACORDE + 3);
    osc.connect(gan).connect(salida);
    osc.start(t);
    osc.stop(t + DURACION_ACORDE + 3.1);
  }
}

// El acorde sale del reloj real y no de cuándo se abrió la página: al cambiar
// de página la progresión sigue por donde iba.
const acordeEn = (t) => Math.floor((Date.now() / 1000 + (t - ctx.currentTime)) / DURACION_ACORDE) % ACORDES.length;

function programar() {
  const horizonte = ctx.currentTime + 1.5;
  while (siguiente < horizonte) {
    const a = acordeEn(siguiente);
    if (a !== acordeActual) {
      acordeActual = a;
      colchon(ACORDES[a], siguiente);
    }
    // Paseo por la escala con saltos cortos; a veces cae en una nota del
    // acorde una octava arriba para que la melodía se apoye en la armonía.
    indice = Math.max(2, Math.min(PENTA.length - 1, indice + Math.round((Math.random() - 0.5) * 4)));
    const f = Math.random() < 0.3 ? ACORDES[a][Math.floor(Math.random() * 4)] * 2 : PENTA[indice];
    piano(f, siguiente, 0.05 + Math.random() * 0.03);
    if (Math.random() < 0.2) piano(f * 1.5, siguiente + 0.02, 0.025);
    // Frases cortas y silencios largos: la música respira.
    siguiente += Math.random() < 0.18 ? 3 + Math.random() * 6 : 0.5 + Math.random() * 1.1;
  }
}

export function iniciar(contexto, destino) {
  if (reloj || !contexto) return;
  ctx = contexto;
  maestro = ctx.createGain();
  const filtro = ctx.createBiquadFilter();
  filtro.type = "lowpass";
  filtro.frequency.value = 2600;
  const rev = reverberacion();
  const humedo = ctx.createGain();
  humedo.gain.value = 0.9;
  filtro.connect(maestro);
  filtro.connect(rev).connect(humedo).connect(maestro);
  maestro.connect(destino ?? ctx.destination);
  maestro.gain.setValueAtTime(0.0001, ctx.currentTime);
  maestro.gain.exponentialRampToValueAtTime(VOLUMEN, ctx.currentTime + 3);
  salida = filtro;
  siguiente = ctx.currentTime + 0.8;
  acordeActual = -1;
  programar();
  reloj = setInterval(programar, 300);
}

export function parar() {
  if (!reloj) return;
  clearInterval(reloj);
  reloj = null;
  maestro.gain.cancelScheduledValues(ctx.currentTime);
  maestro.gain.setValueAtTime(maestro.gain.value, ctx.currentTime);
  maestro.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.5);
  const viejo = maestro;
  setTimeout(() => viejo.disconnect(), 1700);
}
