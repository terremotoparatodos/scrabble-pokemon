/* Vista de la jugada en preparación. Nunca modifica el estado de la partida. */
(function (root) {
  'use strict';
  const R = root.ScrabbleRules;
  const finite = (n, min, max) => typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max;
  const cell = (p) => p && Number.isInteger(p.r) && Number.isInteger(p.c) && R.inBounds(p.r, p.c);

  function cameraSeat(view, followingSeat) {
    if (view.players.length === 2) return 0;
    return view.me >= 0 ? view.players[view.me].seat : followingSeat ?? null;
  }

  function pack(view, extra, view3d, camera) {
    return { key: view.liveKey, pending: extra.pending || [], cursor: extra.cursor || null, rack: extra.rack || null, exchange: extra.exchange || null, choosingBlank: !!extra.choosingBlank, shuffleNo: extra.shuffleNo || 0, view3d: !!view3d, camera: camera || null };
  }

  function clean(state, seat, input, key) {
    const p = state.players[state.turn];
    if (state.phase !== 'play' || !p || p.bot || p.seat !== seat || !input || input.key !== key) return null;
    if (!Array.isArray(input.pending) || input.pending.length > R.RACK_SIZE || typeof input.view3d !== 'boolean') return null;
    const cells = new Set();
    const indices = new Set();
    const pending = [];
    for (const t of input.pending) {
      if (!cell(t) || !Number.isInteger(t.i) || t.i < 0 || t.i >= p.rack.length) return null;
      const at = R.idx(t.r, t.c);
      if (state.board[at] || cells.has(at) || indices.has(t.i)) return null;
      const blank = p.rack[t.i] === R.BLANK;
      const letter = blank ? t.l : p.rack[t.i];
      if (!/^[A-Z]$/.test(letter) || t.l !== letter) return null;
      cells.add(at);
      indices.add(t.i);
      pending.push({ r: t.r, c: t.c, i: t.i, l: letter, blank });
    }
    const cursor = input.cursor;
    if (cursor && (!cell(cursor) || !['H', 'V'].includes(cursor.dir))) return null;
    const camera = input.camera;
    if (camera && (typeof camera.alt !== 'boolean' || !finite(camera.yaw, -Math.PI, Math.PI) || !finite(camera.pitch, -1.2, 1.2) || !finite(camera.zoom, 0.45, 1.7) || !camera.pan || !finite(camera.pan.x, -8, 8) || !finite(camera.pan.z, -8, 8))) return null;
    const order = input.rack || p.rack.map((_, i) => ({ i }));
    if (!Array.isArray(order) || order.length !== p.rack.length || new Set(order.map((t) => t?.i)).size !== p.rack.length || order.some((t) => !t || !Number.isInteger(t.i) || t.i < 0 || t.i >= p.rack.length)) return null;
    const exchange = input.exchange;
    const shuffleNo = input.shuffleNo ?? 0;
    if (!Number.isSafeInteger(shuffleNo) || shuffleNo < 0) return null;
    if (exchange && (!Array.isArray(exchange.indices) || exchange.indices.length > p.rack.length || new Set(exchange.indices).size !== exchange.indices.length || exchange.indices.some((i) => !Number.isInteger(i) || i < 0 || i >= p.rack.length) || typeof exchange.single !== 'boolean' || typeof exchange.type !== 'boolean' || (exchange.single && (exchange.indices.length > 1 || exchange.type)))) return null;
    return {
      key, seat, pending,
      rack: order.map((t) => ({ i: t.i, l: p.rack[t.i], used: indices.has(t.i), selected: !!t.selected })),
      exchange: exchange ? { indices: [...exchange.indices], single: exchange.single, type: exchange.type } : null,
      choosingBlank: !!input.choosingBlank,
      shuffleNo,
      cursor: cursor ? { r: cursor.r, c: cursor.c, dir: cursor.dir } : null,
      view3d: input.view3d,
      camera: camera ? { alt: camera.alt, yaw: camera.yaw, pitch: camera.pitch, zoom: camera.zoom, pan: { x: camera.pan.x, z: camera.pan.z } } : null,
    };
  }
  root.LiveView = { cameraSeat, pack, clean };
})(typeof window !== 'undefined' ? window : globalThis);
