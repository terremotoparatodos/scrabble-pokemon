/*
 * Configuración de la partida en la pantalla principal: los 4 asientos
 * (persona, bot o vacío; nombre y Pokémon compañero) y la cantidad de rondas.
 * Un celular que se conecta en la sala de espera completa su asiento.
 */
(function () {
  'use strict';

  const { $, el } = window.Dom;
  const BV = window.BoardView;

  const SETUP_KEY = 'scrabblePokemon.setup.v1';
  const SEATS = 4;
  const NAME_MAX = 14;
  const COLORS = ['#e5483c', '#3d8ff0', '#2fb35a', '#f0a500'];
  const AVATARS = BV.AVATARS;
  const BOT_NAMES = ['Bot Pikachu', 'Bot Bulbasaur', 'Bot Charmander', 'Bot Squirtle'];
  const MODES = [
    ['human', '👤 Persona'],
    ['bot', '🤖 Bot'],
    ['off', '— Vacío'],
  ];

  let seats = defaults();
  let rounds = 10;
  const listeners = [];

  function defaults() {
    return Array.from({ length: SEATS }, (_, i) => ({
      name: '',
      avatar: AVATARS[i],
      mode: i < 2 ? 'human' : 'off',
      color: COLORS[i],
      remote: false,
    }));
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETUP_KEY) || 'null');
      if (!saved || !Array.isArray(saved.seats)) return;
      saved.seats.slice(0, SEATS).forEach((s, i) => {
        if (typeof s.name === 'string') seats[i].name = s.name.slice(0, NAME_MAX);
        if (AVATARS.includes(s.avatar)) seats[i].avatar = s.avatar;
        if (MODES.some(([m]) => m === s.mode)) seats[i].mode = s.mode;
      });
      if (Number.isInteger(saved.rounds) && saved.rounds >= 0 && saved.rounds <= 99) rounds = saved.rounds;
    } catch (err) {
      console.warn('No se pudo leer la configuración guardada:', err);
    }
  }

  function save() {
    try {
      localStorage.setItem(SETUP_KEY, JSON.stringify({ seats: seats.map(({ name, avatar, mode }) => ({ name, avatar, mode })), rounds }));
    } catch (err) {
      console.warn('No se pudo guardar la configuración:', err);
    }
  }

  function emit() {
    save();
    render();
    listeners.forEach((fn) => fn());
  }

  const cleanName = (name) => String(name || '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);

  /** Problema con el pedido de un celular, o null si se puede ocupar el asiento. */
  function validateClaim(seat, name, avatar) {
    const clean = cleanName(name);
    if (!clean) return 'Escribe tu nombre.';
    if (!AVATARS.includes(avatar)) return 'Elige tu Pokémon compañero.';
    const taken = seats.some((s, i) => i !== seat && s.mode !== 'off' && cleanName(s.name).toLowerCase() === clean.toLowerCase());
    return taken ? 'Ese nombre ya lo usa otro jugador.' : null;
  }

  /** Un celular ocupa (data) o suelta (null) el asiento. */
  function setRemote(seat, data) {
    if (data) {
      seats[seat].name = cleanName(data.name);
      seats[seat].avatar = data.avatar;
      seats[seat].mode = 'human';
      seats[seat].remote = true;
    } else {
      seats[seat].remote = false;
    }
    emit();
  }

  /** Jugadores para empezar, o un texto con lo que falta. */
  function players() {
    const active = seats.map((s, seat) => ({ ...s, seat })).filter((s) => s.mode !== 'off');
    if (active.length < 2) return 'Hacen falta al menos 2 jugadores (personas o bots).';
    const list = active.map((s) => ({
      seat: s.seat,
      name: s.mode === 'bot' ? cleanName(s.name) || BOT_NAMES[s.seat] : cleanName(s.name) || `Jugador ${s.seat + 1}`,
      color: s.color,
      avatar: s.avatar,
      bot: s.mode === 'bot',
    }));
    const names = list.map((p) => p.name.toLowerCase());
    if (new Set(names).size !== names.length) return 'Dos jugadores tienen el mismo nombre.';
    return list;
  }

  function seatCard(s, i) {
    const locked = s.remote;
    const off = s.mode === 'off';
    return el('div', { class: `seat-card ${off ? 'off' : ''}`, style: { '--pc': s.color } }, [
      el('div', { class: 'seat-head' }, [
        el('span', { class: 'seat-dot' }),
        el('strong', { text: `Jugador ${i + 1}` }),
        locked ? el('small', { class: 'seat-remote', text: '📱 Conectado' }) : null,
      ]),
      el(
        'div',
        { class: 'seg', attrs: { role: 'radiogroup', 'aria-label': `Jugador ${i + 1}` } },
        MODES.map(([mode, label]) =>
          el('button', {
            text: label,
            attrs: { type: 'button', role: 'radio', 'aria-checked': String(s.mode === mode), disabled: locked },
            on: {
              click: () => {
                s.mode = mode;
                emit();
              },
            },
          }),
        ),
      ),
      off
        ? null
        : el('input', {
            class: 'name-input',
            attrs: { type: 'text', maxlength: NAME_MAX, value: s.name, placeholder: s.mode === 'bot' ? BOT_NAMES[i] : `Jugador ${i + 1}`, disabled: locked, 'aria-label': `Nombre del jugador ${i + 1}` },
            on: {
              change: (e) => {
                s.name = cleanName(e.target.value);
                emit();
              },
            },
          }),
      off
        ? null
        : el(
            'div',
            { class: 'avatar-grid', attrs: { role: 'radiogroup', 'aria-label': 'Pokémon compañero' } },
            AVATARS.map((id) =>
              el(
                'button',
                {
                  class: 'avatar-opt',
                  attrs: { type: 'button', role: 'radio', 'aria-label': window.ScrabbleRules.DEX[id - 1].name, 'aria-checked': String(s.avatar === id), disabled: locked },
                  on: {
                    click: () => {
                      s.avatar = id;
                      emit();
                    },
                  },
                },
                [BV.sprite(id)],
              ),
            ),
          ),
    ]);
  }

  function render() {
    $('playerSetup').replaceChildren(...seats.map(seatCard));
    $('roundsSelect').value = String(rounds);
    const list = players();
    $('setupHint').textContent = typeof list === 'string' ? list : `${list.length} jugadores listos.`;
    $('btnStart').disabled = typeof list === 'string';
  }

  load();
  document.addEventListener('DOMContentLoaded', () => {
    $('roundsSelect').addEventListener('change', (e) => {
      const input = e.target;
      if (input.value === '' || !input.checkValidity()) {
        input.value = String(rounds);
        return;
      }
      rounds = Number(input.value);
      emit();
    });
    render();
  });

  window.GameSetup = {
    SEATS,
    AVATARS,
    seats: () => seats,
    rounds: () => rounds,
    players,
    validateClaim,
    setRemote,
    render,
    onChange: (fn) => listeners.push(fn),
  };
})();
