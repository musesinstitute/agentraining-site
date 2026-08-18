(function () {
  const params = new URLSearchParams(window.location.search);
  if (params.get('pilot') !== '1') return;

  let recorder = null;
  let stream = null;
  let chunks = [];
  let busy = false;

  function isZh() {
    const urlLang = new URLSearchParams(window.location.search).get('lang');
    const saved = sessionStorage.getItem('agentraining_lang');
    return (urlLang || saved || navigator.language || '').toLowerCase().startsWith('zh');
  }

  function setButton(state) {
    const btn = document.getElementById('mic-btn');
    if (!btn) return;
    btn.classList.toggle('recording', state === 'recording');
    btn.disabled = state === 'processing';
    if (state === 'recording') {
      btn.textContent = '🔴';
      btn.title = isZh() ? '正在錄音，點一下停止' : 'Recording — tap to stop';
    } else if (state === 'processing') {
      btn.textContent = '…';
      btn.title = isZh() ? '正在辨識語音' : 'Transcribing speech';
    } else {
      btn.textContent = '🎤';
      btn.title = isZh() ? 'OpenAI 語音輸入' : 'OpenAI voice input';
    }
  }

  function stopStream() {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
    }
  }

  async function blobToBase64(blob) {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
  }

  async function transcribe(blob) {
    if (!window.PilotCloud?.enabled) throw new Error('PilotCloud is not ready.');
    const user = await window.PilotCloud.ready();
    const token = await user.jwt();
    const audioBase64 = await blobToBase64(blob);
    const response = await fetch('/.netlify/functions/openai-transcribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        audioBase64,
        mimeType: blob.type || 'audio/webm',
        language: isZh() ? 'zh' : 'en'
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Transcription failed (${response.status}).`);
    return String(body.text || '').trim();
  }

  async function startRecording() {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      alert(isZh() ? '此瀏覽器不支援錄音功能，請使用最新版 Chrome、Safari 或 Edge。' : 'This browser does not support audio recording. Please use a current Chrome, Safari, or Edge browser.');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      chunks = [];
      const preferred = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4'
      ].find(type => MediaRecorder.isTypeSupported?.(type));
      recorder = preferred ? new MediaRecorder(stream, { mimeType: preferred }) : new MediaRecorder(stream);
      recorder.ondataavailable = event => {
        if (event.data && event.data.size) chunks.push(event.data);
      };
      recorder.onstop = async () => {
        const mimeType = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
        const blob = new Blob(chunks, { type: mimeType });
        stopStream();
        if (!blob.size) {
          setButton('idle');
          alert(isZh() ? '沒有錄到聲音，請再試一次。' : 'No audio was recorded. Please try again.');
          return;
        }
        busy = true;
        setButton('processing');
        try {
          const text = await transcribe(blob);
          const input = document.getElementById('chat-input');
          if (input && text) {
            const prefix = input.value.trim();
            input.value = prefix ? `${prefix} ${text}` : text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.focus();
          } else if (!text) {
            alert(isZh() ? '沒有辨識到清楚的語音，請再試一次。' : 'No clear speech was detected. Please try again.');
          }
        } catch (error) {
          console.error('OpenAI voice transcription failed', error);
          alert(isZh() ? `語音辨識失敗：${error.message}` : `Voice transcription failed: ${error.message}`);
        } finally {
          busy = false;
          recorder = null;
          chunks = [];
          setButton('idle');
        }
      };
      recorder.start();
      setButton('recording');
    } catch (error) {
      stopStream();
      recorder = null;
      setButton('idle');
      console.error('Microphone access failed', error);
      alert(isZh() ? '無法使用麥克風。請允許此網站使用麥克風後再試。' : 'Microphone access failed. Please allow microphone access and try again.');
    }
  }

  async function toggleMicOpenAI() {
    if (busy) return;
    if (recorder && recorder.state === 'recording') {
      recorder.stop();
      return;
    }
    await startRecording();
  }

  function install() {
    window.toggleMic = toggleMicOpenAI;
    setButton('idle');
    const hint = document.getElementById('input-hint');
    if (hint && !hint.dataset.openaiVoice) {
      hint.dataset.openaiVoice = '1';
      hint.textContent += isZh() ? ' · 🎤 OpenAI 語音辨識' : ' · 🎤 OpenAI speech recognition';
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', install, { once: true });
  } else {
    install();
  }
})();
