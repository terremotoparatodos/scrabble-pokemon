/*
 * Atril (barra de abajo de la pantalla): la ficha de tipo, las fichas del
 * jugador, el estado de la jugada y los botones del turno. Lo usan la
 * pantalla principal (asientos que juegan ahí) y la página de cada jugador.
 * Solo arma la jugada y la manda como intención; quien decide es la
 * pantalla principal (ScrabbleGame), que vuelve a validar todo.
 *
 * Poner fichas: arrastrarlas al tablero (rack-drag.js), o elegir una ficha y
 * después la casilla, o hacer clic en una casilla y escribir con el teclado.
 * Arrastrar dentro del atril las reordena. Una ficha puesta vuelve al atril
 * con un clic o soltándola sobre el atril.
 */
(function () {
  'use strict';

  const R = window.ScrabbleRules;
  const { el } = window.Dom;
  const BV = window.BoardView;

  /**
   * opts.container: dónde se dibuja · opts.send(action): manda la intención
   * opts.onChange(): la jugada en armado cambió (para redibujar el tablero)
   * opts.getDropTarget(): tablero activo, para soltar fichas arrastradas
   */
  function create(opts) {
    let view = null;
    let key = '';
    let order = []; // orden visual del atril (Mezclar), índices reales
    let selected = null; // índice del atril elegido
    let pending = []; // [{ r, c, i }]
    let cursor = null; // { r, c, dir } para escribir con el teclado
    let exchange = null; // { idx:Set, type:bool } en modo cambio
    let deal = false; // atril nuevo: las fichas entran repartidas
    let chooseBlank = null;
    const blankPicker = el('dialog', { class: 'modal card blank-picker', attrs: { 'aria-labelledby': 'blankPickerTitle' } }, [
      el('h2', { text: '★ Comodín de letra', attrs: { id: 'blankPickerTitle' } }),
      el('p', { text: 'Elegí la letra que representará. Esta ficha vale 0 puntos.' }),
      el('div', { class: 'blank-letters' }, [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((l) =>
        el('button', { class: 'btn', text: l, attrs: { type: 'button', 'aria-label': `Letra ${l}` }, on: { click: () => {
          const choose = chooseBlank;
          chooseBlank = null;
          blankPicker.close();
          if (choose) choose(l);
        } } }),
      )),
      el('button', { class: 'btn', text: 'Cancelar', attrs: { type: 'button' }, on: { click: () => { chooseBlank = null; blankPicker.close(); } } }),
    ]);
    document.body.appendChild(blankPicker);
    blankPicker.addEventListener('cancel', () => { chooseBlank = null; });
    blankPicker.addEventListener('close', changed);

    const me = () => (view && view.me >= 0 ? view.players[view.me] : null);
    const myTurn = () => !!view && view.phase === 'play' && view.turn === view.me;
    const rack = () => (me() && me().rack) || [];
    const usedIdx = () => new Set(pending.map((p) => p.i));
    const pendingLetters = () => pending.map((p) => ({ r: p.r, c: p.c, l: rack()[p.i] === R.BLANK ? p.l : rack()[p.i], blank: rack()[p.i] === R.BLANK }));

    function reset() {
      chooseBlank = null;
      if (blankPicker.open) blankPicker.close();
      selected = null;
      pending = [];
      cursor = null;
      exchange = null;
      order = rack().map((_, i) => i);
    }

    function changed() {
      render();
      if (opts.onChange) opts.onChange();
    }

    function update(next) {
      view = next;
      const p = me();
      const nextKey = p ? `${view.moveNo}:${view.turn}:${(p.rack || []).join('')}` : '';
      if (nextKey !== key) {
        key = nextKey;
        reset();
        deal = true;
      }
      render();
    }

    const occupied = (r, c) => !!view.board[R.idx(r, c)] || pending.some((p) => p.r === r && p.c === c);

    function place(r, c, i, letter, afterPlace) {
      if (rack()[i] === R.BLANK && !letter) {
        const forKey = key;
        chooseBlank = (l) => {
          if (forKey !== key || !myTurn() || occupied(r, c) || usedIdx().has(i)) return;
          place(r, c, i, l);
          if (afterPlace) afterPlace();
          changed();
        };
        blankPicker.showModal();
        return false;
      }
      pending.push({ r, c, i, ...(rack()[i] === R.BLANK ? { l: letter } : {}) });
      window.GameAudio?.play('tile');
      selected = null;
      return true;
    }

    function tapCell(r, c) {
      if (!myTurn() || exchange || blankPicker.open) return;
      const at = pending.findIndex((p) => p.r === r && p.c === c);
      if (at >= 0) {
        pending.splice(at, 1);
        return changed();
      }
      if (view.board[R.idx(r, c)]) return;
      if (selected != null) {
        place(r, c, selected);
        cursor = null;
      } else if (cursor && cursor.r === r && cursor.c === c) {
        cursor.dir = cursor.dir === 'H' ? 'V' : 'H';
      } else {
        cursor = { r, c, dir: 'H' };
      }
      changed();
    }

    function tapTile(i) {
      if (blankPicker.open) return;
      if (exchange) {
        if (exchange.idx.has(i)) exchange.idx.delete(i);
        else {
          if (exchange.single) exchange.idx.clear();
          exchange.idx.add(i);
        }
        return render();
      }
      if (usedIdx().has(i)) return;
      if (cursor && myTurn()) {
        if (place(cursor.r, cursor.c, i, null, advanceCursor)) advanceCursor();
        return changed();
      }
      selected = selected === i ? null : i;
      render();
    }

    function advanceCursor() {
      let { r, c } = cursor;
      const dr = cursor.dir === 'V' ? 1 : 0;
      const dc = cursor.dir === 'H' ? 1 : 0;
      do {
        r += dr;
        c += dc;
      } while (R.inBounds(r, c) && occupied(r, c));
      cursor = R.inBounds(r, c) ? { r, c, dir: cursor.dir } : null;
    }

    /** Teclado (solo en pantallas con teclado): letras, Retroceso, Enter, Escape. */
    function onKey(e) {
      if (!view || !myTurn() || exchange || blankPicker.open || e.ctrlKey || e.metaKey || e.altKey) return false;
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return false;
      const k = e.key.length === 1 ? R.normalize(e.key) : '';
      if (k && cursor) {
        const used = usedIdx();
        let i = rack().findIndex((l, j) => l === k && !used.has(j));
        if (i < 0) i = rack().findIndex((l, j) => l === R.BLANK && !used.has(j));
        if (i < 0) return true;
        place(cursor.r, cursor.c, i, k);
        advanceCursor();
        changed();
        return true;
      }
      if (e.key === 'Backspace' && pending.length) {
        const last = pending.pop();
        cursor = { r: last.r, c: last.c, dir: cursor ? cursor.dir : 'H' };
        changed();
        return true;
      }
      if (e.key === 'Enter' && pending.length) {
        submitPlay();
        return true;
      }
      if (e.key === 'Escape') {
        reset();
        changed();
        return true;
      }
      return false;
    }

    function preview() {
      if (!pending.length || !me()) return null;
      return R.validatePlay({ board: view.board, placements: pendingLetters(), type: me().type, used: view.used });
    }

    function submitPlay() {
      const res = preview();
      if (!res || !res.ok) return;
      opts.send({ type: 'play', tiles: pending.map(({ r, c, i, l }) => ({ r, c, i, ...(l ? {l} : {}) })) });
    }

    function shuffle() {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      window.GameAudio?.play('exchange');
      render();
    }

    // ── Dibujo ──
    function button(label, onClick, cls, disabled) {
      return el('button', { class: `btn ${cls || ''}`, text: label, attrs: { type: 'button', disabled: !!disabled }, on: { click: onClick } });
    }

    function statusLine() {
      if (view.phase !== 'play') return el('p', { class: 'pp-status', text: 'La partida terminó.' });
      if (!myTurn()) {
        const p = view.players[view.turn];
        return el('p', { class: 'pp-status wait', text: `Espera: es el turno de ${p.name}.` });
      }
      if (exchange) return el('p', { class: 'pp-status', text: exchange.single ? 'Elegí 1 ficha para cambiar sin perder el turno. Disponible una vez por ronda.' : 'Elige las fichas (y/o la ficha de tipo) que vuelven a la bolsa. Cambiar usa tu turno.' });
      const res = preview();
      if (!res) {
        return el('p', { class: 'pp-status', text: `Crea cualquier Pokémon. ${me().type === R.ANY_TYPE ? 'Comodín: todos dan x2.' : `Recomendado: ${R.typeName(me().type)} (x2 puntos).`}` });
      }
      if (!res.ok) return el('p', { class: 'pp-status bad', text: `✗ ${res.error}` });
      return el('p', { class: 'pp-status good' }, [BV.sprite(res.entries[0].id, 'mini'), `✓ ${res.entries[0].name} · ${res.score} puntos${res.typeMultiplier === 2 ? ' · x2 por tipo recomendado' : ''}`]);
    }

    function render() {
      const c = opts.container;
      const p = me();
      if (!view || !p || !p.rack) {
        c.replaceChildren();
        return;
      }
      const used = usedIdx();
      const turn = myTurn();
      const res = turn && !exchange ? preview() : null;
      const tiles = order
        .filter((i) => i < p.rack.length)
        .map((i, pos) =>
          el(
            'button',
            {
              style: deal ? { '--deal-delay': `${pos * 45}ms` } : {},
              class: `rack-slot ${deal ? 'deal' : ''} ${used.has(i) ? 'used' : ''} ${selected === i ? 'selected' : ''} ${exchange && exchange.idx.has(i) ? 'marked' : ''}`,
              attrs: { type: 'button', disabled: used.has(i), 'data-i': i, 'aria-label': p.rack[i] === R.BLANK ? 'Ficha comodín de letra' : `Ficha ${p.rack[i]}`, title: p.rack[i] === R.BLANK ? 'Comodín: cualquier letra · 0 puntos' : turn ? 'Arrástrala al tablero' : '' },
              on: { click: () => tapTile(i) },
            },
            [BV.letterTile(p.rack[i])],
          ),
        );
      const typeEl = BV.typeTile(p.type, {
        selected: exchange && exchange.type,
        onClick: exchange && !exchange.single
          ? () => {
              exchange.type = !exchange.type;
              render();
            }
          : null,
      });

      const actions = exchange
        ? [
            button('🔄 Confirmar cambio', () => opts.send({ type: exchange.single ? 'swap-one' : 'exchange', indices: [...exchange.idx], swapType: exchange.type }), 'btn-primary', !exchange.idx.size && !exchange.type),
            button('Cancelar', () => {
              exchange = null;
              render();
            }),
          ]
        : [
            button('✅ Crear Pokémon', submitPlay, 'btn-primary pp-main', !turn || !res || !res.ok),
            button('↩ Recoger', () => {
              pending = [];
              cursor = null;
              changed();
            }, '', !pending.length),
            button('🔀 Mezclar', shuffle),
            button(p.singleSwapAvailable ? '🔄 Cambiar 1' : view.bagCount ? '🔄 Cambio usado' : '🔄 Bolsa vacía', () => {
              reset();
              exchange = { idx: new Set(), type: false, single: true };
              changed();
            }, '', !turn || !p.singleSwapAvailable),
            button('🔄 Cambiar', () => {
              reset();
              exchange = { idx: new Set(), type: false };
              changed();
            }, '', !turn),
            button('⏭ Pasar', () => opts.send({ type: 'pass' }), '', !turn),
            button(view.hint ? '💡 Usada' : '💡 Pista −5', () => opts.send({ type: 'hint' }), '', !turn || !!view.hint),
          ];

      const notes = [
        view.turnNote && !view.hint ? el('p', { class: 'pp-note', text: `✨ ${view.turnNote}` }) : null,
        view.hint ? el('p', { class: 'pp-hint' }, [BV.sprite(view.hint.id, 'mini'), `Pista: ${R.DEX[view.hint.id - 1].name} (marcado en el tablero)`]) : null,
      ];
      c.replaceChildren(
        el('div', { class: `play-panel ${turn ? 'my-turn' : ''}`, style: { '--pc': p.color, '--rack-size': R.RACK_SIZE } }, [
          typeEl,
          el('div', { class: 'rack' }, [
            el('div', { class: 'pp-head' }, [
              el('strong', { text: turn ? `¡Tu turno, ${p.name}!` : `Fichas de ${p.name}` }),
              el('span', { class: 'pp-bag', text: `🎒 Bolsa: ${view.bagCount}` }),
            ]),
            el('div', { class: 'rack-tiles' }, tiles),
          ]),
          el('div', { class: 'pp-side' }, [...notes, statusLine(), el('div', { class: 'pp-actions' }, actions)]),
        ]),
      );
      deal = false;
    }

    /** Reordena el atril: la ficha i pasa a la posición pos (entre las visibles). */
    function reorder(i, pos) {
      const visible = order.filter((k) => k < rack().length);
      const from = visible.indexOf(i);
      if (from < 0) return;
      visible.splice(from, 1);
      visible.splice(pos > from ? pos - 1 : pos, 0, i);
      order = visible;
      render();
      if (opts.onChange) opts.onChange();
    }

    const rackDrag = window.RackDrag.create({
      root: opts.container,
      canDrag: () => canEdit(),
      getTarget: () => (opts.getDropTarget ? opts.getDropTarget() : null),
      letterOf: (i) => rack()[i],
      onDrop: (i, cell) => placeAt(i, cell.r, cell.c),
      onReorder: reorder,
    });

    // ── Fichas puestas (arrastre en el tablero) ──
    const canEdit = () => myTurn() && !exchange && !blankPicker.open;
    const freeCell = (r, c) => R.inBounds(r, c) && !occupied(r, c);

    /** Suelta la ficha i del atril en (r, c). */
    function placeAt(i, r, c) {
      if (!canEdit() || usedIdx().has(i) || i < 0 || i >= rack().length || !freeCell(r, c)) return false;
      place(r, c, i);
      cursor = null;
      changed();
      return true;
    }

    /** Mueve una ficha ya puesta este turno a otra casilla. */
    function movePending(from, to) {
      const p = pending.find((x) => x.r === from.r && x.c === from.c);
      if (!canEdit() || !p || !freeCell(to.r, to.c)) return false;
      p.r = to.r;
      p.c = to.c;
      changed();
      return true;
    }

    /** Devuelve al atril la ficha puesta en (r, c). */
    function removeAt(r, c) {
      const at = pending.findIndex((x) => x.r === r && x.c === c);
      if (!canEdit() || at < 0) return false;
      pending.splice(at, 1);
      changed();
      return true;
    }

    /** Lo que necesita el tablero: fichas en armado, cursor, pista y el atril en su orden visual. */
    function boardExtra() {
      const used = usedIdx();
      return {
        pending: pending.map((p) => ({ r: p.r, c: p.c, l: rack()[p.i] === R.BLANK ? p.l : rack()[p.i], i: p.i, blank: rack()[p.i] === R.BLANK })),
        cursor,
        hint: view && view.hint,
        rack: order.filter((i) => i < rack().length).map((i) => ({ i, l: rack()[i], used: used.has(i), selected: selected === i })),
        editable: canEdit(),
      };
    }

    return { update, tapCell, tapTile, onKey, placeAt, movePending, removeAt, boardExtra, isOverRack: (x, y) => rackDrag.isOver(x, y) };
  }

  window.PlayPanel = { create };
})();
