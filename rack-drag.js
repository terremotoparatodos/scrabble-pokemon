/*
 * Arrastrar fichas del atril HTML al tablero (2D o 3D) y reordenar el atril.
 *
 * Se escucha en un contenedor fijo (el panel se vuelve a dibujar seguido, así
 * que no se atan eventos a cada ficha). Mientras se arrastra, una copia de la
 * ficha sigue al mouse y el tablero muestra dónde caería (previewDrop). Un
 * clic sin mover sigue siendo «elegir ficha» (el click normal del botón).
 */
(function () {
  'use strict';

  const MOVE_PX = 4;

  /**
   * opts.root: contenedor del panel · opts.canDrag(): ¿se puede jugar?
   * opts.getTarget(): tablero activo ({ previewDrop(x, y, letter), clearDrop() })
   * opts.letterOf(i) · opts.onDrop(i, cell) · opts.onReorder(i, pos)
   */
  function create(opts) {
    let press = null; // { i, x, y, slot }
    let ghost = null;
    let suppressClick = false;

    const rackRow = () => opts.root.querySelector('.rack-tiles');

    /** Posición de inserción en el atril según la x del mouse (o null si no está encima). */
    function rackPosition(x, y) {
      const row = rackRow();
      if (!row) return null;
      const box = row.getBoundingClientRect();
      if (y < box.top - 20 || y > box.bottom + 20 || x < box.left - 30 || x > box.right + 30) return null;
      const slots = [...row.querySelectorAll('.rack-slot')];
      let pos = slots.length;
      for (let k = 0; k < slots.length; k++) {
        const b = slots[k].getBoundingClientRect();
        if (x < b.left + b.width / 2) {
          pos = k;
          break;
        }
      }
      return pos;
    }

    function markInsert(pos) {
      const row = rackRow();
      if (!row) return;
      row.querySelectorAll('.rack-slot').forEach((s, k) => {
        s.classList.toggle('insert-before', k === pos);
        s.classList.toggle('insert-after', pos != null && k === pos - 1 && pos === row.children.length);
      });
    }

    function startGhost() {
      const tile = press.slot.querySelector('.tile');
      ghost = tile.cloneNode(true);
      ghost.classList.add('drag-ghost');
      const box = tile.getBoundingClientRect();
      ghost.style.width = `${box.width}px`;
      ghost.style.height = `${box.height}px`;
      ghost.style.setProperty('--cell', getComputedStyle(tile).getPropertyValue('--cell'));
      document.body.appendChild(ghost);
      press.slot.classList.add('dragging');
      document.body.classList.add('is-dragging');
    }

    function moveGhost(x, y) {
      ghost.style.transform = `translate(${x}px, ${y}px) translate(-50%, -60%) rotate(-4deg) scale(1.12)`;
    }

    /** La copia vuelve volando a su ficha del atril y desaparece. */
    function flyBack(node, slot) {
      const to = slot.getBoundingClientRect();
      node.style.transition = 'transform 0.22s ease-in';
      node.style.transform = `translate(${to.left + to.width / 2}px, ${to.top + to.height / 2}px) translate(-50%, -50%)`;
      setTimeout(() => node.remove(), 240);
    }

    function finish(back) {
      if (ghost && back && press && press.slot.isConnected) flyBack(ghost, press.slot);
      else if (ghost) ghost.remove();
      ghost = null;
      if (press && press.slot) press.slot.classList.remove('dragging');
      document.body.classList.remove('is-dragging');
      markInsert(null);
      const target = opts.getTarget();
      if (target && target.clearDrop) target.clearDrop();
      press = null;
    }

    opts.root.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      const slot = ev.target.closest('.rack-slot');
      if (!slot || slot.disabled || !slot.dataset.i) return;
      press = { i: Number(slot.dataset.i), x: ev.clientX, y: ev.clientY, slot };
    });

    window.addEventListener('pointermove', (ev) => {
      if (!press) return;
      if (!ghost) {
        if (Math.hypot(ev.clientX - press.x, ev.clientY - press.y) < MOVE_PX) return;
        startGhost();
      }
      moveGhost(ev.clientX, ev.clientY);
      const pos = rackPosition(ev.clientX, ev.clientY);
      markInsert(pos);
      const target = opts.getTarget();
      if (!target || !target.previewDrop) return;
      if (pos != null || !opts.canDrag()) target.clearDrop();
      else target.previewDrop(ev.clientX, ev.clientY, opts.letterOf(press.i));
    });

    window.addEventListener('pointerup', (ev) => {
      if (!press) return;
      if (!ghost) {
        press = null; // fue un clic: lo maneja el botón
        return;
      }
      suppressClick = true;
      // Sólo bloquea el clic generado por este arrastre, no el siguiente clic
      // del jugador (por ejemplo, después de elegir la letra de un comodín).
      setTimeout(() => { suppressClick = false; }, 0);
      const { i } = press;
      const pos = rackPosition(ev.clientX, ev.clientY);
      const target = opts.getTarget();
      const cell = pos == null && opts.canDrag() && target && target.previewDrop ? target.previewDrop(ev.clientX, ev.clientY, opts.letterOf(i)) : null;
      finish(pos == null && !cell);
      if (pos != null) opts.onReorder(i, pos);
      else if (cell) opts.onDrop(i, cell);
    });

    window.addEventListener('pointercancel', () => finish(true));

    // El clic que sigue a un arrastre no debe «elegir» la ficha.
    opts.root.addEventListener(
      'click',
      (ev) => {
        if (!suppressClick) return;
        suppressClick = false;
        ev.stopPropagation();
        ev.preventDefault();
      },
      true,
    );

    return {
      /** ¿El punto está sobre el atril? (para devolver fichas desde el tablero) */
      isOver(x, y) {
        const row = rackRow();
        if (!row) return false;
        const b = opts.root.getBoundingClientRect();
        return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
      },
    };
  }

  window.RackDrag = { create };
})();
