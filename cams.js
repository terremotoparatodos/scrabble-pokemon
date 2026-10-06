/*
 * Cámaras de la pantalla principal (como en Pokémon Party): columnas a los
 * costados del área de juego con 0, 2, 3 o 4 espacios para superponer video
 * en el stream o la edición. Debajo de cada cámara, la placa de su jugador.
 *
 * - 1v1: cámaras arriba y las capturas debajo, una columna por lado.
 * - 2 cámaras: una por lado · 3: dos a la izquierda y una a la derecha ·
 *   4: dos por lado. Las columnas miden lo mismo, así el juego queda al centro.
 * - Los jugadores sin cámara tienen su placa en una esquina del área de juego.
 * - Interior neutro o verde croma (para recortar en edición).
 *
 * Solo dibuja; no cambia la partida.
 */
(function () {
  'use strict';

  const { $, el } = window.Dom;
  const BV = window.BoardView;

  const PREF_KEY = 'scrabblePokemon.cams.v1';
  const COUNTS = [0, 2, 3, 4];

  function readPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      return { count: COUNTS.includes(p.count) ? p.count : null, chroma: !!p.chroma };
    } catch (err) {
      console.warn('No se pudieron leer las preferencias de cámaras:', err);
      return { count: null, chroma: false };
    }
  }

  const prefs = readPrefs();
  const listeners = [];

  function save() {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
    } catch (err) {
      console.warn('No se pudieron guardar las preferencias de cámaras:', err);
    }
  }

  /** Cámaras a mostrar: la elegida, o tantas como jugadores (2 a 4). */
  function countFor(players) {
    return prefs.count != null ? prefs.count : Math.max(2, Math.min(4, players));
  }

  const seenCaptures = new Map();

  function collection(p) {
    const captures = p.captures || [];
    const previous = seenCaptures.get(p.seat);
    seenCaptures.set(p.seat, captures.length);
    return el('section', { class: 'cam-collection', attrs: { 'aria-label': `Pokémon creados por ${p.name}` } }, [
      el('div', { class: 'collection-head' }, [el('strong', { text: 'Pokémon creados' }), el('span', { text: captures.length })]),
      captures.length
        ? el('ol', { class: 'capture-list' }, [...captures].reverse().map((capture, i) => {
          const entry = window.ScrabbleRules.DEX[capture.id - 1];
          const fresh = previous != null && captures.length > previous && i < captures.length - previous;
          return el('li', { class: `capture-card${fresh ? ' capture-in' : ''}` }, [
            BV.pmdSprite(capture.id),
            el('div', { class: 'capture-info' }, [
              el('strong', { text: entry.name }),
              el('div', { class: 'capture-types' }, entry.types.map((type) => BV.typeChip(type, true))),
            ]),
            el('b', { class: 'capture-score', text: capture.score == null ? '— pts' : `+${capture.score} pts` }),
          ]);
        }))
        : el('p', { class: 'collection-empty', text: 'Tus Pokémon aparecerán acá.' }),
    ]);
  }

  function slot(p, opts) {
    return el('div', { class: 'cam-player', style: { '--pc': p ? p.color : '#adb5bd' } }, [
      el('div', { class: `cam-slot ${opts.active ? 'turn' : ''} ${opts.winner ? 'winner' : ''}` }, [
        el('div', { class: 'cam-frame' }, [el('span', { class: 'cam-hint', text: 'Cámara' })]),
        p ? BV.playerPlate(p, opts) : el('div', { class: 'plate empty' }, [el('small', { text: 'Sin jugador' })]),
      ]),
      p && opts.spectator ? el('section', { class: 'spectator-rack rack', style: { '--rack-type-color': window.ScrabbleRules.TYPES[p.type]?.color || '#ffcb05' }, attrs: { 'aria-label': `Fichas de ${p.name}`, 'data-seat': p.seat } }, [
        el('strong', { text: `Fichas de ${p.name}` }),
        el('div', { class: 'spectator-tiles' }, (p.rack || []).map((l) => el('span', { class: 'spectator-tile' }, [BV.letterTile(l)]))),
      ]) : null,
      p ? collection(p) : null,
    ]);
  }

  /**
   * view: vista pública · isRemote(seat): ¿juega desde otra pantalla?
   * Devuelve los jugadores que quedaron sin cámara (van en las esquinas).
   */
  function render(view, isRemote, options = {}) {
    const layout = $('stageLayout');
    const players = [...view.players].sort((a, b) => a.seat - b.seat);
    const count = options.spectator ? players.length : countFor(players.length);
    layout.dataset.cams = String(count);
    layout.classList.toggle('duel', players.length === 2 && count === 2);
    layout.classList.toggle('chroma', !options.spectator && prefs.chroma);
    const optsFor = (p) => {
      const i = view.players.indexOf(p);
      return {
        active: view.phase === 'play' && view.turn === i,
        winner: !!(view.winners && view.winners.includes(i)),
        connected: isRemote(p.seat),
        spectator: !!options.spectator,
      };
    };
    const withCam = players.slice(0, count);
    const slots = Array.from({ length: count }, (_, k) => slot(withCam[k], withCam[k] ? optsFor(withCam[k]) : {}));
    const leftN = Math.ceil(count / 2);
    $('camLeft').replaceChildren(...slots.slice(0, leftN));
    $('camRight').replaceChildren(...slots.slice(leftN));

    const rest = players.slice(count);
    $('hudPlaques').replaceChildren(...rest.map((p) => el('div', { class: 'corner-plate' }, [BV.playerPlate(p, optsFor(p))])));
    return rest;
  }

  /** Controles del menú: cantidad de cámaras y fondo. */
  function renderControls(container, players) {
    const current = countFor(players);
    container.replaceChildren(
      el(
        'div',
        { class: 'seg', attrs: { role: 'radiogroup', 'aria-label': 'Cámaras' } },
        COUNTS.map((n) =>
          el('button', {
            text: n === 0 ? 'Ninguna' : `${n}`,
            attrs: { type: 'button', role: 'radio', 'aria-checked': String(current === n) },
            on: {
              click: () => {
                prefs.count = n;
                save();
                listeners.forEach((fn) => fn());
              },
            },
          }),
        ),
      ),
      el('label', { class: 'menu-check' }, [
        el('input', {
          attrs: { type: 'checkbox', checked: prefs.chroma },
          on: {
            change: (e) => {
              prefs.chroma = e.target.checked;
              save();
              listeners.forEach((fn) => fn());
            },
          },
        }),
        ' Fondo verde croma',
      ]),
    );
  }

  window.GameCams = { render, renderControls, onChange: (fn) => listeners.push(fn) };
})();
