/* PR #75 guided-tour narration: accessible, optional, browser-local. */
(() => {
  const root = document.querySelector('[data-narration]');
  if (!root) return;
  const lines = [...root.querySelectorAll('[data-caption-line]')];
  const play = document.querySelector('#tourRead');
  const stop = document.querySelector('#tourStop');
  const status = document.querySelector('#tourVoiceStatus');
  const synth = window.speechSynthesis;
  let active = false;
  let index = 0;
  let token = 0;
  let utterance = null;
  const supported = !!(synth && window.SpeechSynthesisUtterance);
  const mark = i => lines.forEach((el, n) => {
    if (n === i) el.setAttribute('data-speaking', 'true');
    else el.removeAttribute('data-speaking');
  });
  const reset = (message) => {
    active = false;
    utterance = null;
    mark(-1);
    play.disabled = !supported;
    play.textContent = '▶ Listen to this page';
    stop.hidden = true;
    status.textContent = message;
  };
  const halt = (message = 'Narration stopped. The full captions remain visible.') => {
    token++;
    if (supported) synth.cancel();
    reset(message);
  };
  const speakNext = (id) => {
    if (!active || id !== token) return;
    if (index >= lines.length) { reset('Narration completed.'); return; }
    const current = index++;
    const speech = new SpeechSynthesisUtterance(lines[current].textContent.trim());
    utterance = speech;
    speech.lang = 'en-US';
    speech.rate = 0.91;
    speech.onstart = () => {
      if (active && id === token) {
        mark(current);
        // Keep each spoken caption in view, including on narrow phones with a sticky footer.
        lines[current].scrollIntoView({ block: 'center', behavior: 'auto' });
        status.textContent = 'Reading caption ' + (current + 1) + ' of ' + lines.length;
      }
    };
    speech.onend = () => {
      if (!active || id !== token) return;
      speakNext(id);
    };
    speech.onerror = () => {
      if (active && id === token) reset('Audio was interrupted or is unavailable. Read the captions below.');
    };
    try { synth.speak(speech); }
    catch (_) { reset('Audio is unavailable in this browser. Read the captions below.'); }
  };
  if (!supported) {
    play.disabled = true;
    status.textContent = 'Audio narration is not available in this browser. The captions are always available.';
  }
  play.addEventListener('click', () => {
    if (!supported) return;
    halt('');
    active = true;
    index = 0;
    const id = token;
    play.disabled = true;
    stop.hidden = false;
    status.textContent = 'Preparing narration…';
    speakNext(id);
  });
  stop.addEventListener('click', () => halt());
  window.addEventListener('pagehide', () => halt(''));
  document.querySelectorAll('.footer .nav a').forEach(link =>
    link.addEventListener('click', () => halt('')));
})();
