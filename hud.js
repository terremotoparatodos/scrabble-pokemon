/*
 * Interfaz de pantalla completa (pantalla principal y página del jugador).
 *
 * - Espacio libre: la parte del área de juego que no tapan la barra de
 *   arriba, el atril de abajo ni las placas de las esquinas. El tablero (2D
 *   o 3D) se encuadra ahí, así nada se superpone con él.
 * - Pantalla completa del navegador (botón ⛶).
 * - Menú lateral (☰) que se abre dentro del área de juego.
 */
(function () {
  'use strict';

  const GAP = 10;

  /**
   * opts.area, opts.top, opts.bottom: elementos · opts.sides(): elementos al
   * costado (placas) · opts.onChange(rect): rect relativo al área.
   */
  /**
   * Caja de un elemento relativa al área, según el diseño (offsetLeft/Top):
   * no la mueven las animaciones (un atril que sube no reencuadra el tablero).
   */
  function layoutBox(area, node) {
    let x = 0;
    let y = 0;
    for (let n = node; n && n !== area; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return { left: x, top: y, right: x + node.offsetWidth, bottom: y + node.offsetHeight, width: node.offsetWidth, height: node.offsetHeight };
  }

  function watchSafeArea(opts) {
    let queued = false;

    function measure() {
      queued = false;
      const W = opts.area.clientWidth;
      const H = opts.area.clientHeight;
      if (W < 2 || H < 2) return;
      const area = { left: 0, top: 0, right: W, bottom: H, width: W, height: H };
      const topBox = layoutBox(opts.area, opts.top);
      let top = topBox.height ? topBox.bottom + GAP : GAP;
      // Las placas de las esquinas van justo debajo de la barra (que puede tener 1 o 2 filas).
      opts.area.style.setProperty('--hud-top-h', `${topBox.bottom}px`);
      const bottomBox = opts.bottom.hidden ? { height: 0 } : layoutBox(opts.area, opts.bottom);
      let bottom = bottomBox.height ? H - bottomBox.top + GAP : GAP;
      // Placas de las esquinas: pueden reservar los costados o la franja de
      // arriba; se elige lo que deja el tablero (cuadrado) más grande.
      let left = GAP;
      let right = GAP;
      let plaqueBottom = 0;
      for (const node of opts.sides ? opts.sides() : []) {
        const b = layoutBox(opts.area, node);
        if (!b.width) continue;
        plaqueBottom = Math.max(plaqueBottom, b.bottom + GAP);
        if (b.left + b.width / 2 < area.width / 2) left = Math.max(left, b.right + GAP);
        else right = Math.max(right, area.right - b.left + GAP);
      }
      top = Math.min(top, area.height * 0.25);
      bottom = Math.min(bottom, area.height * 0.45);
      const sideRect = { x: left, y: top, w: area.width - left - right, h: area.height - top - bottom };
      const topRect = { x: GAP, y: Math.max(top, plaqueBottom), w: area.width - 2 * GAP, h: area.height - Math.max(top, plaqueBottom) - bottom };
      const score = (r) => Math.min(r.w, r.h);
      const rect = plaqueBottom && score(topRect) > score(sideRect) ? topRect : sideRect;
      // Queda anotado para revisar superposiciones (ver tests/overlap-check.js).
      opts.area.dataset.safe = [rect.x, rect.y, rect.w, rect.h].map(Math.round).join(',');
      opts.onChange(rect);
    }

    function schedule() {
      if (queued) return;
      queued = true;
      requestAnimationFrame(measure);
    }

    const ro = new ResizeObserver(schedule);
    [opts.area, opts.top, opts.bottom].forEach((n) => ro.observe(n));
    window.addEventListener('resize', schedule);
    return { schedule, observe: (n) => ro.observe(n) };
  }

  /** Coloca el tablero 2D (cuadrado) centrado en el espacio libre. */
  function placeBoard2d(frame, rect) {
    const size = Math.max(200, Math.min(rect.w, rect.h) - 24); // marco incluido
    frame.style.setProperty('--bw', `${size - 24}px`);
    frame.style.left = `${rect.x + (rect.w - size) / 2}px`;
    frame.style.top = `${rect.y + (rect.h - size) / 2}px`;
  }

  function bindFullscreen(btn) {
    const sync = () => {
      const on = !!document.fullscreenElement;
      btn.textContent = on ? '🗗' : '⛶';
      btn.title = on ? 'Salir de pantalla completa' : 'Pantalla completa';
    };
    btn.addEventListener('click', () => {
      const req = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
      Promise.resolve(req).catch((err) => console.warn('No se pudo cambiar la pantalla completa:', err));
    });
    document.addEventListener('fullscreenchange', sync);
    sync();
  }

  /** Menú lateral: se abre con el botón y se cierra con ✕, Escape o al tocar afuera. */
  function bindMenu(btn, drawer, closeBtn) {
    const close = () => {
      drawer.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      drawer.hidden = !drawer.hidden;
      btn.setAttribute('aria-expanded', String(!drawer.hidden));
    });
    closeBtn.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !drawer.hidden) close();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!drawer.hidden && !drawer.contains(e.target) && e.target !== btn) close();
    });
    return { close };
  }

  /** La página del jugador y la emisión comparten la misma barra de puntajes. */
  function renderPlayerScores(container, view) {
    const { el } = window.Dom;
    const BV = window.BoardView;
    const round = view.rounds ? `Ronda ${view.round}/${view.rounds}` : `Ronda ${view.round}`;
    container.replaceChildren(el('div', { class: 'ctrl-scores' }, [
      ...view.players.map((p, i) => el('div', {
        class: `ctrl-score ${view.phase === 'play' && view.turn === i ? 'active' : ''} ${i === view.me ? 'mine' : ''}`,
        style: { '--pc': p.color },
      }, [BV.sprite(p.avatar, 'mini'), el('span', { class: 'cs-name', text: i === view.me ? `${p.name} (tú)` : p.name }), el('b', { text: p.score }), BV.recommendedTypeChip(p.type, true)])),
      el('span', { class: 'hud-meta', text: `${round}${view.lastRound ? ' · ¡última!' : ''} · 🎒 ${view.bagCount}` }),
    ]));
  }

  window.GameHud = { watchSafeArea, placeBoard2d, bindFullscreen, bindMenu, renderPlayerScores };
})();
