/*
 * Protocolo entre la pantalla principal (anfitrión) y los celulares, igual
 * que en Pokémon Party: PeerJS (WebRTC); el servidor público de PeerJS solo
 * presenta a los dispositivos, los mensajes viajan entre ellos.
 *
 * Autoridad: la pantalla principal guarda la partida y decide todo. Los
 * celulares solo envían intenciones y muestran lo que reciben.
 *
 * Celular → anfitrión
 *   { t:'join', seat, token, name, avatar }   ocupar o recuperar un asiento
 *   { t:'leave' }                             liberar el asiento
 *   { t:'act', a:'play', tiles:[{r,c,i,l?}] } crear un Pokémon (l: letra del comodín)
 *   { t:'act', a:'swap-one', indices:[i] }   cambiar una ficha sin perder el turno
 *   { t:'act', a:'exchange', indices, swapType }
 *   { t:'act', a:'pass' } · { t:'act', a:'hint' }
 *   { t:'act', a:'clue', slot, detail }      dato gratuito: generation | types | initial
 *   { t:'ping' }                              latido (cada PING_MS)
 *   { t:'spectate' }                          vista OBS sin asiento, sigue el atril del turno
 *   { t:'preview', preview }                 jugada en preparación y cámara del jugador en turno
 *   { t:'sound', effect:'shuffle' }          sonido de Mezclar, también fuera del turno
 *
 * Anfitrión → celular
 *   { t:'state', room, you, lobby, game }     foto tras cada cambio; `game` solo
 *                                             incluye el atril de ese asiento
 *   { t:'joined', seat } · { t:'kicked' } · { t:'error', msg } · { t:'pong' }
 *   { t:'preview', preview }                 solo a OBS: borrador, orden y selección del atril validados
 *   { t:'sound', seat, effect:'shuffle' }    solo a OBS: efecto de un jugador conectado
 */
(function () {
  'use strict';

  const ROOM_PREFIX = 'scrabble-pokemon-v1-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L
  const CODE_LENGTH = 5;
  const MAX_DEVICE_CHARS = 4000;
  const MAX_STATE_CHARS = 200000;
  const PING_MS = 2000;
  const DEAD_MS = 8000;

  function randomInts(n) {
    const arr = new Uint32Array(n);
    crypto.getRandomValues(arr);
    return Array.from(arr);
  }

  function newRoomCode() {
    return randomInts(CODE_LENGTH)
      .map((v) => CODE_CHARS[v % CODE_CHARS.length])
      .join('');
  }

  function normalizeCode(text) {
    const clean = String(text || '')
      .toUpperCase()
      .split('')
      .filter((ch) => CODE_CHARS.includes(ch))
      .join('');
    return clean.length === CODE_LENGTH ? clean : null;
  }

  /** Identificador secreto del dispositivo para recuperar su asiento. */
  function newToken() {
    return randomInts(4)
      .map((v) => v.toString(36).padStart(7, '0'))
      .join('');
  }

  function isMessage(msg, fromHost) {
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return false;
    try {
      return JSON.stringify(msg).length <= (fromHost ? MAX_STATE_CHARS : MAX_DEVICE_CHARS);
    } catch {
      return false;
    }
  }

  function controlUrl(code) {
    const url = new URL('control.html', window.location.href);
    url.search = `?sala=${code}`;
    url.hash = '';
    return url.toString();
  }

  function spectatorUrl(code) {
    const url = new URL('spectator.html', window.location.href);
    url.search = `?sala=${code}`;
    url.hash = '';
    return url.toString();
  }

  window.NetProtocol = { ROOM_PREFIX, CODE_LENGTH, PING_MS, DEAD_MS, newRoomCode, normalizeCode, newToken, isMessage, controlUrl, spectatorUrl };
})();
