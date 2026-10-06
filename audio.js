/* Efectos originales sintetizados: no requieren archivos ni conexión. */
(function () {
  'use strict';
  const KEY = document.body.classList.contains('spectator') ? 'scrabblePokemon.spectator.sound.v1' : 'scrabblePokemon.sound.v1';
  let enabled = true;
  try { enabled = localStorage.getItem(KEY) !== 'off'; } catch { /* Preferencia opcional. */ }
  let context = null;
  let master = null;
  let previous = null;

  function unlock() {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!enabled || !Audio) return;
    try {
      if (!context) {
        context = new Audio();
        master = context.createGain();
        master.gain.value = 0.22;
        master.connect(context.destination);
        context.addEventListener('statechange', () => window.dispatchEvent(new Event('game-audio-state')));
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* El juego también funciona sin audio. */ }
  }

  // Los navegadores permiten el audio a partir del primer gesto del jugador.
  document.addEventListener('pointerdown', unlock, { capture: true });
  document.addEventListener('keydown', unlock, { capture: true });

  function tone(frequency, delay, duration, type = 'sine', endFrequency = frequency, volume = 0.5) {
    const at = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, at);
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, at + duration);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(volume, at + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(at);
    oscillator.stop(at + duration + 0.02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function melody(notes, step = 0.1, duration = 0.22, type = 'triangle') {
    notes.forEach((frequency, i) => tone(frequency, i * step, duration, type));
  }

  function play(effect) {
    if (!enabled || !context || context.state !== 'running') return;
    switch (effect) {
      case 'tile': tone(700, 0, 0.065, 'triangle', 420, 0.3); break;
      case 'start': melody([523, 659, 784, 1047], 0.1); break;
      case 'turn': melody([659, 880], 0.09, 0.16); break;
      case 'throw': tone(230, 0, 0.38, 'sine', 1100, 0.35); break;
      case 'open': tone(140, 0, 0.16, 'triangle', 700); tone(1200, 0.08, 0.2, 'sine', 1800, 0.3); break;
      case 'capture': melody([523, 659, 784, 1047, 1319], 0.085, 0.32); break;
      case 'hint': melody([784, 1047], 0.12, 0.25, 'sine'); break;
      case 'swap-one':
      case 'exchange': melody([440, 554, 659], 0.075, 0.15); break;
      case 'pass': melody([440, 330], 0.09, 0.15); break;
      case 'win': melody([523, 659, 784, 1047, 784, 1047], 0.14, 0.4); break;
    }
  }

  function observe(view) {
    if (!view) { previous = null; return; }
    const entry = view.log[0];
    const signature = entry ? `${entry.n}:${entry.kind}:${entry.player}` : '';
    if (previous && view.moveNo >= previous.moveNo) {
      if (signature !== previous.signature && entry) play(entry.kind);
      if (view.phase === 'over' && previous.phase !== 'over') play('win');
    }
    previous = { signature, phase: view.phase, moveNo: view.moveNo };
  }

  const control = document.getElementById('soundEnabled');
  function setEnabled(value) {
    enabled = !!value;
    if (master) master.gain.value = enabled ? 0.22 : 0;
    if (control) control.checked = enabled;
    try { localStorage.setItem(KEY, enabled ? 'on' : 'off'); } catch { /* Preferencia opcional. */ }
    if (enabled) unlock();
    window.dispatchEvent(new Event('game-audio-state'));
  }
  if (control) {
    control.checked = enabled;
    control.addEventListener('change', () => {
      setEnabled(control.checked);
      if (enabled) play('tile');
    });
  }
  window.GameAudio = { play, observe, unlock, setEnabled, isReady: () => enabled && context?.state === 'running' };
})();
