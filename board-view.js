/*
 * Piezas visuales compartidas por la pantalla principal y el celular:
 * tablero, fichas de letra, ficha de tipo, tarjeta de jugador y la tarjeta
 * «¡Creaste a …!». Solo dibujan lo que reciben (publicView); no deciden nada.
 */
(function () {
  'use strict';

  const R = window.ScrabbleRules;
  const { el } = window.Dom;

  // Pokémon compañeros que se pueden elegir como ficha de jugador (número de
  // Pokédex → modelo 3D de models/, los mismos de Pokémon Party).
  const AVATAR_MODELS = { 25: 'pikachu', 1: 'bulbasaur', 4: 'charmander', 7: 'squirtle', 252: 'treecko', 135: 'jolteon', 197: 'umbreon', 587: 'emolga', 714: 'noibat' };
  const AVATARS = [25, 1, 4, 7, 252, 135, 197, 587, 714];

  const PREMIUM_LABEL = { DL: ['x2', 'letra'], TL: ['x3', 'letra'], DW: ['x2', 'palabra'], TW: ['x3', 'palabra'] };

  const spriteUrl = (id) => `assets/sprites/${id}.png`;
  const typeIconUrl = (type) => `assets/types/${type}.png`;

  function sprite(id, cls) {
    return el('img', { class: `sprite ${cls || ''}`, attrs: { src: spriteUrl(id), alt: R.DEX[id - 1] ? R.DEX[id - 1].name : '', loading: 'lazy', draggable: 'false' } });
  }

  function pmdSprite(id) {
    return el('img', { class: 'sprite pmd-sprite', attrs: { src: `assets/pmd/${id}.png`, alt: R.DEX[id - 1].name, loading: 'lazy', draggable: 'false' } });
  }

  function pokeBall(cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 64 64');
    svg.setAttribute('class', cls || 'ball');
    svg.setAttribute('aria-hidden', 'true');
    const parts = [
      ['circle', { cx: 32, cy: 32, r: 29, fill: '#fff', stroke: '#1f2933', 'stroke-width': 4 }],
      ['path', { d: 'M3 32 A29 29 0 0 1 61 32 Z', fill: '#e3350d', stroke: '#1f2933', 'stroke-width': 4 }],
      ['rect', { x: 3, y: 29, width: 58, height: 6, fill: '#1f2933' }],
      ['circle', { cx: 32, cy: 32, r: 10, fill: '#fff', stroke: '#1f2933', 'stroke-width': 4 }],
    ];
    for (const [tag, attrs] of parts) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
      svg.appendChild(node);
    }
    return svg;
  }

  /** Ficha de letra (en el atril o en el tablero). */
  function letterTile(letter, opts) {
    const o = opts || {};
    return el('span', { class: `tile ${o.cls || ''}`, style: o.color ? { '--owner': o.color } : {}, attrs: { title: o.blank ? `Comodín: ${letter} · 0 puntos` : letter === R.BLANK ? 'Comodín de letra · 0 puntos' : null } }, [
      el('b', { class: 'tile-letter', text: letter === R.BLANK ? '★' : letter }),
      el('small', { class: 'tile-pts', text: o.blank ? 0 : R.LETTER_POINTS[letter] }),
    ]);
  }

  function typeChip(type, small) {
    const any = type === R.ANY_TYPE;
    return el('span', { class: `type-chip ${small ? 'sm' : ''} ${any ? 'any' : ''}`, style: any ? {} : { '--tc': R.TYPES[type].color } }, [
      any ? el('span', { class: 'type-star', text: '★' }) : el('img', { attrs: { src: typeIconUrl(type), alt: '' } }),
      el('span', { text: R.typeName(type) }),
    ]);
  }

  function recommendedTypeChip(type, small) {
    const chip = typeChip(type, small);
    chip.title = type === R.ANY_TYPE ? 'x2 para cualquier Pokémon' : `Tipo recomendado: ${R.typeName(type)} · x2 puntos si coincide`;
    chip.appendChild(el('b', { class: 'type-multiplier', text: 'x2' }));
    return chip;
  }

  /** Ficha de tipo grande del atril. */
  function typeTile(type, opts) {
    const o = opts || {};
    const any = type === R.ANY_TYPE;
    return el(
      o.onClick ? 'button' : 'div',
      {
        class: `type-tile ${any ? 'any' : ''} ${o.selected ? 'selected' : ''}`,
        style: any ? {} : { '--tc': R.TYPES[type].color },
        attrs: o.onClick ? { type: 'button', 'aria-pressed': String(!!o.selected), title: 'Tipo recomendado · x2 puntos' } : { title: 'Tipo recomendado · x2 puntos' },
        on: o.onClick ? { click: o.onClick } : {},
      },
      [
        any ? el('span', { class: 'type-star', text: '★' }) : el('img', { attrs: { src: typeIconUrl(type), alt: '' } }),
        el('strong', { text: R.typeName(type) }),
        el('small', { text: any ? 'todos · x2' : 'recomendado · x2' }),
      ],
    );
  }

  // ── Tablero ──
  /**
   * create(container, onCell) arma las 225 casillas una sola vez.
   * render(view, { pending:[{r,c,l}], hint }) actualiza su contenido.
   */
  function createBoard(container, onCell) {
    const cells = [];
    const grid = el('div', { class: 'board', attrs: { role: 'grid', 'aria-label': 'Tablero' } });
    for (let r = 0; r < R.SIZE; r++) {
      for (let c = 0; c < R.SIZE; c++) {
        const btn = el('button', {
          class: 'cell',
          attrs: { type: 'button', 'data-r': r, 'data-c': c, 'aria-label': `Fila ${r + 1}, columna ${c + 1}` },
          on: { click: () => onCell && onCell(r, c) },
        });
        cells.push(btn);
        grid.appendChild(btn);
      }
    }
    container.replaceChildren(grid);

    let lastView = null;
    let lastExtra = null;
    let dropAt = -1;

    function render(view, extra) {
      lastView = view;
      lastExtra = extra;
      const pending = new Map(((extra && extra.pending) || []).map((p) => [R.idx(p.r, p.c), p]));
      const hint = extra && extra.hint;
      const cursor = extra && extra.cursor;
      const cursorAt = cursor ? R.idx(cursor.r, cursor.c) : -1;
      const hintCells = new Set();
      if (hint) for (let k = 0; k < hint.word.length; k++) hintCells.add(R.idx(hint.r + (hint.dir === 'V' ? k : 0), hint.c + (hint.dir === 'H' ? k : 0)));
      const last = view.lastMove;
      const fresh = new Set(last ? last.placed.map((p) => R.idx(p.r, p.c)) : []);
      const colorOf = new Map(view.players.map((p) => [p.seat, p.color]));
      cells.forEach((btn, i) => {
        const cell = view.board[i];
        const prem = R.PREMIUM[i];
        const isCenter = i === R.idx(R.CENTER, R.CENTER);
        btn.className = `cell ${prem ? `prem-${prem}` : ''} ${isCenter ? 'center' : ''} ${hintCells.has(i) ? 'hinted' : ''} ${i === cursorAt ? `cursor cursor-${cursor.dir}` : ''} ${i === dropAt ? 'drop-target' : ''}`;
        if (cell) {
          btn.replaceChildren(letterTile(cell.l, { cls: fresh.has(i) ? 'fresh' : '', color: colorOf.get(cell.s), blank: cell.blank }));
        } else if (pending.has(i)) {
          btn.replaceChildren(letterTile(pending.get(i).l, { cls: 'pending', blank: pending.get(i).blank }));
        } else if (isCenter) {
          btn.replaceChildren(pokeBall('ball cell-ball'));
        } else if (prem) {
          const [mult, what] = PREMIUM_LABEL[prem];
          btn.replaceChildren(el('span', { class: 'prem-label' }, [el('b', { text: mult }), el('small', { text: what })]));
        } else {
          btn.replaceChildren();
        }
      });
    }

    /** Casilla libre bajo un punto de la pantalla (para soltar fichas del atril). */
    function previewDrop(clientX, clientY) {
      const btn = document.elementFromPoint(clientX, clientY);
      const cellEl = btn && btn.closest ? btn.closest('.cell') : null;
      let cell = null;
      if (cellEl && grid.contains(cellEl) && lastView && lastExtra && lastExtra.editable) {
        const r = Number(cellEl.dataset.r);
        const c = Number(cellEl.dataset.c);
        const busy = lastView.board[R.idx(r, c)] || (lastExtra.pending || []).some((p) => p.r === r && p.c === c);
        if (!busy) cell = { r, c };
      }
      const at = cell ? R.idx(cell.r, cell.c) : -1;
      if (at !== dropAt) {
        dropAt = at;
        if (lastView) render(lastView, lastExtra);
      }
      return cell;
    }

    function clearDrop() {
      if (dropAt === -1) return;
      dropAt = -1;
      if (lastView) render(lastView, lastExtra);
    }

    return { render, previewDrop, clearDrop, element: grid };
  }

  // ── Jugadores ──
  // Último puntaje mostrado por asiento: al cambiar, el número sube animado.
  const shownScores = new Map();

  function animateNumber(node, from, to, ms) {
    const start = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - start) / ms);
      node.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
      if (k < 1 && node.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function playerCard(p, opts) {
    const o = opts || {};
    const prev = shownScores.get(p.seat);
    shownScores.set(p.seat, p.score);
    const changed = prev != null && prev !== p.score;
    const scoreNum = el('b', { text: changed ? prev : p.score });
    if (changed) animateNumber(scoreNum, prev, p.score, 900);
    const diff = changed ? p.score - prev : 0;
    return el('article', { class: `player-card ${o.active ? 'active' : ''} ${o.winner ? 'winner' : ''} ${changed ? 'scored' : ''}`, style: { '--pc': p.color } }, [
      el('div', { class: 'pc-band' }, [
        el('small', { text: `Jugador ${p.seat + 1}${p.bot ? ' · 🤖 Bot' : ''}${o.connected ? ' · 📱' : ''}` }),
        o.active && !o.phaseOver ? el('span', { class: 'pc-turn', text: '▶ Su turno' }) : null,
        o.winner ? el('span', { class: 'pc-turn', text: '🏆 Ganador' }) : null,
      ]),
      el('div', { class: 'pc-head' }, [
        el('div', { class: 'pc-avatar' }, [sprite(p.avatar)]),
        el('div', { class: 'pc-id' }, [el('strong', { class: 'pc-name', text: p.name }), recommendedTypeChip(p.type, true)]),
        el('div', { class: 'pc-score' }, [
          scoreNum,
          el('small', { text: 'pts' }),
          changed ? el('span', { class: `pc-gain ${diff < 0 ? 'loss' : ''}`, text: diff > 0 ? `+${diff}` : String(diff) }) : null,
        ]),
      ]),
      el('div', { class: 'pc-foot' }, [
        el(
          'div',
          { class: 'pc-dex', attrs: { title: 'Pokémon creados' } },
          p.created.length ? p.created.slice(-7).map((id) => sprite(id, 'mini')) : [el('small', { class: 'muted', text: 'Todavía no creó Pokémon' })],
        ),
        el('span', { class: 'pc-count', attrs: { title: 'Fichas en el atril' }, text: `🎒 ${p.rackCount}` }),
      ]),
    ]);
  }

  /**
   * Placa compacta de jugador (debajo de su cámara o en una esquina del área
   * de juego): compañero, nombre, puntos (suben animados), ficha de tipo y
   * fichas en el atril.
   */
  function playerPlate(p, opts) {
    const o = opts || {};
    const prev = shownScores.get(p.seat);
    shownScores.set(p.seat, p.score);
    const changed = prev != null && prev !== p.score;
    const scoreNum = el('b', { text: changed ? prev : p.score });
    if (changed) animateNumber(scoreNum, prev, p.score, 900);
    const diff = changed ? p.score - prev : 0;
    return el('div', { class: `plate ${o.active ? 'active' : ''} ${o.winner ? 'winner' : ''} ${changed ? 'scored' : ''}`, style: { '--pc': p.color } }, [
      el('div', { class: 'plate-avatar' }, [sprite(p.avatar)]),
      el('div', { class: 'plate-info' }, [
        el('strong', { class: 'plate-name', text: p.name }),
        el('div', { class: 'plate-meta' }, [recommendedTypeChip(p.type, true), el('span', { class: 'plate-count', attrs: { title: 'Fichas en el atril' }, text: `🎒 ${p.rackCount}` }), o.connected ? el('span', { text: '🖥' }) : null, p.bot ? el('span', { text: '🤖' }) : null]),
      ]),
      el('div', { class: 'plate-score' }, [scoreNum, el('small', { text: 'pts' }), changed ? el('span', { class: `pc-gain ${diff < 0 ? 'loss' : ''}`, text: diff > 0 ? `+${diff}` : String(diff) }) : null]),
    ]);
  }

  /** Tarjeta grande al crear un Pokémon. */
  function revealCard(view) {
    const m = view.lastMove;
    const entry = R.DEX[m.id - 1];
    const player = view.players[m.player];
    return el('div', { class: 'reveal-card', style: { '--pc': player.color } }, [
      el('small', { text: `${player.name} creó a…` }),
      el('div', { class: 'reveal-sprite' }, [sprite(m.id, 'big')]),
      el('h2', { text: entry.name }),
      el('div', { class: 'reveal-types' }, entry.types.map((t) => typeChip(t))),
      el('p', { class: 'reveal-score', text: `+${m.score} puntos${m.typeMultiplier === 2 ? ' · x2 por tipo recomendado' : ''}${m.bonus ? ` (¡bonus de ${m.bonus} por usar ${R.BIG_PLAY_TILES}+ fichas!)` : ''}` }),
    ]);
  }

  function logLine(view, entry) {
    const p = view.players[entry.player];
    const who = el('strong', { style: { color: p.color }, text: p.name });
    switch (entry.kind) {
      case 'play':
        return el('li', { class: 'log-play' }, [sprite(entry.id, 'mini'), who, ` creó a ${R.DEX[entry.id - 1].name} `, el('b', { text: `+${entry.score}` })]);
      case 'exchange':
        return el('li', {}, ['🔄 ', who, ` cambió ${entry.count} ficha${entry.count === 1 ? '' : 's'}${entry.swapType ? ' y su ficha de tipo' : ''}`]);
      case 'swap-one':
        return el('li', {}, ['🔄 ', who, ' cambió 1 ficha sin perder el turno']);
      case 'hint':
        return el('li', {}, ['💡 ', who, ' pidió una pista (−5)']);
      default:
        return el('li', {}, ['⏭ ', who, ' pasó']);
    }
  }

  const END_REASON = {
    options: 'No quedan tres Pokémon distintos que puedan jugarse con un mismo atril.',
    rounds: 'Se jugaron todas las rondas.',
    bag: 'Se vació la bolsa de fichas.',
    passes: 'Todos pasaron dos veces seguidas.',
    board: 'No entra ningún Pokémon más en el tablero.',
  };

  window.BoardView = { AVATARS, AVATAR_MODELS, createBoard, playerPlate, letterTile, typeTile, typeChip, recommendedTypeChip, playerCard, revealCard, logLine, sprite, pmdSprite, pokeBall, END_REASON };
})();
