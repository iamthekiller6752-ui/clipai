// ЗАМЕНИТЕ на URL вашего Worker'а после Шага 4
const WORKER_URL = 'ЗАМЕНИТЕ_НА_URL_ВАШЕГО_WORKER';

// --- Вкладки ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

// --- Обработка видео ---
const videoInput = document.getElementById('video-input');
const uploadArea = document.getElementById('upload-area');
const processingArea = document.getElementById('processing-area');
const statusText = document.getElementById('status-text');
const progressBar = document.getElementById('progress-bar');
const clipsGrid = document.getElementById('clips-grid');

videoInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  uploadArea.classList.add('hidden');
  processingArea.classList.remove('hidden');

  try {
    updateStatus('Извлечение кадров из видео...', 15);
    const { frames, duration } = await extractFrames(file, 8);

    updateStatus('Отправка в Gemini для анализа...', 40);
    const result = await analyzeVideo(frames, duration, file.name);

    updateStatus('Готово!', 100);
    renderClips(result.clips || [], file);

    setTimeout(() => {
      processingArea.classList.add('hidden');
      uploadArea.classList.remove('hidden');
      document.querySelector('[data-tab="my-clips"]').click();
    }, 800);
  } catch (err) {
    console.error(err);
    updateStatus('Ошибка: ' + err.message, 0);
  }
});

function updateStatus(text, progress) {
  statusText.textContent = text;
  progressBar.style.width = progress + '%';
}

// Извлекаем кадры из видео через <canvas>
async function extractFrames(file, count) {
  const video = document.createElement('video');
  video.src = URL.createObjectURL(file);
  video.muted = true;
  await new Promise((res, rej) => {
    video.onloadedmetadata = () => res();
    video.onerror = () => rej(new Error('Не удалось прочитать видео'));
  });

  const duration = video.duration;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(512 * video.videoHeight / video.videoWidth);
  const ctx = canvas.getContext('2d');

  const frames = [];
  for (let i = 0; i < count; i++) {
    const t = (duration / count) * i + (duration / count) / 2;
    video.currentTime = Math.min(t, duration - 0.1);
    await new Promise(r => { video.onseeked = () => r(); });
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    frames.push({
      time: Math.round(t),
      data: canvas.toDataURL('image/jpeg', 0.7).split(',')[1]
    });
  }
  return { frames, duration: Math.round(duration) };
}

async function analyzeVideo(frames, duration, filename) {
  const res = await fetch(`${WORKER_URL}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ frames, duration, filename })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}

function renderClips(clips, file) {
  if (!clips.length) {
    clipsGrid.innerHTML = '<p>Не удалось найти моменты. Попробуйте другое видео.</p>';
    return;
  }
  clipsGrid.innerHTML = clips.map((c, i) => `
    <div class="clip-card">
      ${c.thumbnail ? `<img src="${c.thumbnail}" alt="">` : ''}
      <h3>${escapeHtml(c.title || 'Клип ' + (i+1))}</h3>
      <div class="meta">
        ⏱ ${formatTime(c.start)} – ${formatTime(c.end)}<br>
        ${escapeHtml(c.reason || '')}
      </div>
      <p class="hint">Нарезка файла — следующий этап (FFmpeg).</p>
    </div>
  `).join('');
}

function formatTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.round(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
