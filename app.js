// ЗАМЕНИТЕ на URL вашего Worker'а (например, https://clipai-api.ваш-субдомен.workers.dev)
const WORKER_URL = 'https://clipai.iamthekiller6752-6a7.workers.dev/';

const { FFmpeg } = FFmpegWASM;
const { fetchFile } = FFmpegUtil;
let ffmpeg = null;

// --- Вкладки ---
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

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
    // 1. Анализ Gemini
    updateStatus('Извлечение кадров...', 10);
    const { frames, duration } = await extractFrames(file, 5);

    updateStatus('Gemini ищет лучшие моменты...', 30);
    const result = await analyzeVideo(frames, duration, file.name);
    const clipsMeta = result.clips || [];

    if (clipsMeta.length === 0) throw new Error('Интересные моменты не найдены.');

    // 2. Нарезка через FFmpeg
    updateStatus('Загрузка движка FFmpeg (может занять 10-20 сек)...', 40);
    if (!ffmpeg) {
      ffmpeg = new FFmpeg();
      await ffmpeg.load({
        coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
        wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
      });
    }

    updateStatus('Подготовка видеофайла...', 50);
    const inputName = 'input.mp4';
    await ffmpeg.writeFile(inputName, await fetchFile(file));

    const finalClips = [];

    // Проходимся по каждому найденному моменту
    for (let i = 0; i < clipsMeta.length; i++) {
      const clip = clipsMeta[i];
      const progress = 50 + Math.round((i / clipsMeta.length) * 45);
      updateStatus(`Нарезка клипа ${i + 1} из ${clipsMeta.length}...`, progress);

      const outputName = `clip_${i}.mp4`;
      const start = clip.start;
      const clipDuration = clip.end - clip.start;

      // Команда FFmpeg: обрезаем по времени и кадрируем в 9:16 по центру
      await ffmpeg.exec([
        '-ss', start.toString(),
        '-i', inputName,
        '-t', clipDuration.toString(),
        '-vf', 'crop=ih*(9/16):ih', // Кадрирование в 9:16
        '-c:a', 'copy',
        outputName
      ]);

      const data = await ffmpeg.readFile(outputName);
      const blob = new Blob([data.buffer], { type: 'video/mp4' });
      const url = URL.createObjectURL(blob);

      finalClips.push({
        ...clip,
        url: url,
        filename: `clipai_${i+1}.mp4`,
        thumbnail: frames[clip.frame_index] ? `data:image/jpeg;base64,${frames[clip.frame_index].data}` : null
      });
    }

    updateStatus('Готово!', 100);
    renderClips(finalClips);

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

function renderClips(clips) {
  clipsGrid.innerHTML = clips.map((c, i) => `
    <div class="clip-card" style="border: 1px solid #8b5cf6; padding: 10px; border-radius: 8px; margin-bottom: 10px;">
      ${c.thumbnail ? `<img src="${c.thumbnail}" style="width:100%; border-radius:4px;">` : ''}
      <h3>${escapeHtml(c.title || 'Клип ' + (i+1))}</h3>
      <p style="color:#94a3b8; font-size:0.9rem;">${escapeHtml(c.reason || '')}</p>
      <video src="${c.url}" controls style="width:100%; max-height: 400px; border-radius:4px; margin-top:10px;"></video>
      <br>
      <a href="${c.url}" download="${c.filename}" style="display:inline-block; background:#8b5cf6; color:white; padding:10px 20px; text-decoration:none; border-radius:5px; margin-top:10px;">Скачать ${c.filename}</a>
    </div>
  `).join('');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
