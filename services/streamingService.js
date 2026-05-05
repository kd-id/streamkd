const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const ffprobeInstaller = require('@ffprobe-installer/ffprobe');
const { v4: uuidv4 } = require('uuid');
const { promisify } = require('util');
const { db } = require('../db/database');
const Stream = require('../models/Stream');
const Playlist = require('../models/Playlist');
const Video = require('../models/Video');

const execFilePromise = promisify(execFile);

let ffmpegPath;
if (fs.existsSync('/usr/bin/ffmpeg')) {
  ffmpegPath = '/usr/bin/ffmpeg';
} else {
  ffmpegPath = ffmpegInstaller.path;
}

let ffprobePath;
if (fs.existsSync('/usr/bin/ffprobe')) {
  ffprobePath = '/usr/bin/ffprobe';
} else {
  ffprobePath = ffprobeInstaller.path;
}

function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function isImageFile(filepath) {
  if (!filepath) return false;
  const ext = path.extname(filepath).toLowerCase();
  return ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif'].includes(ext);
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getSlideshowFps(stream) {
  const configuredFps = parsePositiveInt(stream.fps, 30);
  const maxFps = parsePositiveInt(process.env.SLIDESHOW_MAX_FPS, 15);
  return Math.max(10, Math.min(configuredFps, maxFps));
}

function getSlideshowBitrate(stream) {
  const configuredBitrate = parsePositiveInt(stream.bitrate, 1800);
  const maxBitrate = parsePositiveInt(process.env.SLIDESHOW_MAX_BITRATE, 1800);
  return Math.max(800, Math.min(configuredBitrate, maxBitrate));
}

async function runFfmpeg(args) {
  await execFilePromise(ffmpegPath, args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
}

async function renderStaticSlideshowVideo({ streamId, videoPaths, tempDir, resolution, fps, bitrate, imageDuration }) {
  const renderConcatFile = path.join(tempDir, `slideshow_render_${streamId}.txt`);
  const outputPath = path.join(tempDir, `slideshow_render_${streamId}_${resolution}_${fps}_${bitrate}.mp4`);
  let content = '';

  for (const imagePath of videoPaths) {
    content += `file '${imagePath.replace(/\\/g, '/')}'\n`;
    content += `duration ${imageDuration}\n`;
  }
  if (videoPaths.length > 0) {
    content += `file '${videoPaths[videoPaths.length - 1].replace(/\\/g, '/')}'\n`;
  }

  fs.writeFileSync(renderConcatFile, content);

  await runFfmpeg([
    '-y',
    '-hide_banner',
    '-loglevel', 'warning',
    '-f', 'concat',
    '-safe', '0',
    '-i', renderConcatFile,
    '-an',
    '-vf', `fps=${fps}`,
    '-c:v', 'libx264',
    '-preset', 'ultrafast',
    '-tune', 'stillimage',
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p',
    '-b:v', `${bitrate}k`,
    '-maxrate', `${bitrate}k`,
    '-bufsize', `${bitrate * 2}k`,
    '-r', String(fps),
    '-g', String(fps * 2),
    '-keyint_min', String(fps),
    '-movflags', '+faststart',
    outputPath
  ]);

  return outputPath;
}

const activeStreams = new Map();
const streamLogs = new Map();
const streamRetryCount = new Map();
const manuallyStoppingStreams = new Set();
const startingStreams = new Set();

const MAX_LOG_LINES = 50;
const MAX_RETRY_ATTEMPTS = 15;
const BASE_RETRY_DELAY = 2000;
const MAX_RETRY_DELAY = 30000;
const HEALTH_CHECK_INTERVAL = 30000;
const SYNC_INTERVAL = 60000;
const STREAM_START_TIMEOUT = 15000;

const YOUTUBE_COPY_ALLOWED_VIDEO_CODECS = new Set(['h264']);
const YOUTUBE_COPY_ALLOWED_AUDIO_CODECS = new Set(['aac', 'mp3']);

let schedulerService = null;
let syncIntervalId = null;
let healthCheckIntervalId = null;
let initialized = false;

function setSchedulerService(service) {
  schedulerService = service;

  if (!initialized) {
    initialized = true;
    syncIntervalId = setInterval(syncStreamStatuses, SYNC_INTERVAL);
    healthCheckIntervalId = setInterval(healthCheckStreams, HEALTH_CHECK_INTERVAL);
  }
}

function addStreamLog(streamId, message) {
  if (!streamLogs.has(streamId)) {
    streamLogs.set(streamId, []);
  }
  const logs = streamLogs.get(streamId);
  logs.push({ timestamp: new Date().toISOString(), message });
  if (logs.length > MAX_LOG_LINES) {
    logs.shift();
  }
}

function getStreamLogs(streamId) {
  return streamLogs.get(streamId) || [];
}

function cleanupStreamData(streamId) {
  streamRetryCount.delete(streamId);
  manuallyStoppingStreams.delete(streamId);
  startingStreams.delete(streamId);
}

function getRetryDelay(retryCount) {
  const delay = Math.min(BASE_RETRY_DELAY * Math.pow(1.5, retryCount), MAX_RETRY_DELAY);
  return delay + Math.random() * 1000;
}

function getProjectRoot() {
  return path.resolve(__dirname, '..');
}

function resolvePublicFilePath(relativePath) {
  if (!relativePath) {
    throw new Error('Missing media filepath');
  }

  const relPath = relativePath.startsWith('/') ? relativePath.substring(1) : relativePath;
  return path.join(getProjectRoot(), 'public', relPath);
}

function isYouTubeDestination(stream) {
  if (stream && stream.is_youtube_api) {
    return true;
  }

  const rtmpUrl = (stream.rtmp_url || '').toLowerCase();
  return rtmpUrl.includes('youtube.com');
}

function isProgressLogLine(line) {
  return line.includes('frame=') || line.includes('time=') || line.includes('speed=');
}

function buildMediaLabel(media, index, type) {
  if (media && media.title) {
    return `${type} "${media.title}"`;
  }

  return `${type} #${index + 1}`;
}

function isSupportedYouTubePixelFormat(pixFmt) {
  const normalized = (pixFmt || '').toLowerCase();
  return normalized === 'yuv420p' || normalized === 'yuvj420p';
}

function getPrimaryStream(probeData, codecType) {
  return (probeData.streams || []).find(stream => stream.codec_type === codecType) || null;
}

function getFrameRateLabel(videoStream) {
  return videoStream && videoStream.avg_frame_rate ? videoStream.avg_frame_rate : 'unknown fps';
}

function buildCopyModeCompatibilityError(label, detail) {
  return `${label} tidak kompatibel dengan YouTube: ${detail}.`;
}

function createUnsupportedCopyModeError(message) {
  const error = new Error(message);
  error.code = 'UNSUPPORTED_COPY_MODE_MEDIA';
  return error;
}

function getRelevantStartupLog(line) {
  const trimmed = (line || '').trim();
  if (!trimmed || isProgressLogLine(trimmed)) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith('press [q]') ||
    lower.startsWith('input #') ||
    lower.startsWith('output #') ||
    lower.startsWith('metadata:') ||
    lower.startsWith('stream mapping:')
  ) {
    return null;
  }

  return trimmed;
}

function buildStartupFailureMessage(startupState, fallbackMessage = null) {
  const detail = startupState.lastErrorLine || startupState.lastLogLine || fallbackMessage;
  if (detail) {
    return `FFmpeg gagal memulai stream: ${detail}`;
  }

  return 'FFmpeg gagal memulai stream';
}

function runFFprobe(filePath) {
  return new Promise((resolve, reject) => {
    const ffprobeProcess = spawn(ffprobePath, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      filePath
    ], {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    ffprobeProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    ffprobeProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ffprobeProcess.on('error', (error) => {
      reject(error);
    });

    ffprobeProcess.on('exit', (code) => {
      if (code !== 0) {
        return reject(new Error(stderr.trim() || `ffprobe exited with code ${code}`));
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function validateYouTubeCopyVideoProbe(probeData, label, isImage = false) {
  const videoStream = getPrimaryStream(probeData, 'video');
  if (!videoStream) {
    // Check if it's an image that might not have a "video" stream in probe but we can still use it
    if (isImage) return null;
    return buildCopyModeCompatibilityError(label, 'video stream tidak ditemukan');
  }

  const videoCodec = (videoStream.codec_name || '').toLowerCase();
  // Allow mjpeg if it's an image file, as we will transcode it
  if (isImage && videoCodec === 'mjpeg') {
    return null;
  }

  if (!YOUTUBE_COPY_ALLOWED_VIDEO_CODECS.has(videoCodec)) {
    return buildCopyModeCompatibilityError(label, `codec video ${videoCodec || 'unknown'} tidak didukung`);
  }

  if (!isSupportedYouTubePixelFormat(videoStream.pix_fmt)) {
    return buildCopyModeCompatibilityError(label, `pixel format ${videoStream.pix_fmt || 'unknown'} bukan 4:2:0 standar`);
  }

  const audioStream = getPrimaryStream(probeData, 'audio');
  if (audioStream) {
    const audioCodec = (audioStream.codec_name || '').toLowerCase();
    if (!YOUTUBE_COPY_ALLOWED_AUDIO_CODECS.has(audioCodec)) {
      return buildCopyModeCompatibilityError(label, `codec audio ${audioCodec || 'unknown'} tidak didukung`);
    }
  }

  return null;
}

function validateYouTubeCopyAudioProbe(probeData, label) {
  const audioStream = getPrimaryStream(probeData, 'audio');
  if (!audioStream) {
    return buildCopyModeCompatibilityError(label, 'audio stream tidak ditemukan');
  }

  const audioCodec = (audioStream.codec_name || '').toLowerCase();
  if (!YOUTUBE_COPY_ALLOWED_AUDIO_CODECS.has(audioCodec)) {
    return buildCopyModeCompatibilityError(label, `codec audio ${audioCodec || 'unknown'} tidak didukung`);
  }

  return null;
}

function validatePlaylistCopyConsistency(referenceStream, currentStream, label) {
  const mismatches = [];

  if ((currentStream.codec_name || '').toLowerCase() !== (referenceStream.codec_name || '').toLowerCase()) {
    mismatches.push('codec video berbeda');
  }

  if (currentStream.width !== referenceStream.width || currentStream.height !== referenceStream.height) {
    mismatches.push('resolusi berbeda');
  }

  if ((currentStream.pix_fmt || '').toLowerCase() !== (referenceStream.pix_fmt || '').toLowerCase()) {
    mismatches.push('pixel format berbeda');
  }

  if (getFrameRateLabel(currentStream) !== getFrameRateLabel(referenceStream)) {
    mismatches.push('frame rate berbeda');
  }

  if (mismatches.length === 0) {
    return null;
  }

  return `${label} tidak bisa digabung aman di copy mode YouTube karena ${mismatches.join(', ')}.`;
}

async function validateCopyModeCompatibility(stream) {
  return validateCopyModeCompatibilityForInput({
    videoId: stream.video_id,
    useAdvancedSettings: stream.use_advanced_settings,
    isYouTubeApi: stream.is_youtube_api,
    rtmpUrl: stream.rtmp_url
  });
}

async function validateCopyModeCompatibilityForInput({
  videoId,
  useAdvancedSettings = false,
  isYouTubeApi = false,
  rtmpUrl = ''
}) {
  if (useAdvancedSettings || !isYouTubeDestination({ is_youtube_api: isYouTubeApi, rtmp_url: rtmpUrl })) {
    return;
  }

  const playlist = await Playlist.findByIdWithVideos(videoId);

  if (playlist) {
    if (!playlist.videos || playlist.videos.length === 0) {
      throw new Error('Playlist is empty');
    }

    let isSlideshow = true;
    for (const item of playlist.videos) {
      if (!isImageFile(item.filepath)) {
        isSlideshow = false;
        break;
      }
    }

    // If it's a slideshow, it will be automatically transcoded and scaled, so we don't need copy mode validation
    if (isSlideshow) {
      return;
    }

    let referenceVideoStream = null;

    for (let index = 0; index < playlist.videos.length; index++) {
      const video = playlist.videos[index];
      const isImg = isImageFile(video.filepath);
      const probeData = await runFFprobe(resolvePublicFilePath(video.filepath));
      const label = buildMediaLabel(video, index, 'Video');
      const compatibilityError = validateYouTubeCopyVideoProbe(probeData, label, isImg);

      if (compatibilityError) {
        throw createUnsupportedCopyModeError(compatibilityError);
      }

      const currentVideoStream = getPrimaryStream(probeData, 'video');
      if (!referenceVideoStream) {
        referenceVideoStream = currentVideoStream;
      } else {
        const consistencyError = validatePlaylistCopyConsistency(referenceVideoStream, currentVideoStream, label);
        if (consistencyError) {
          throw createUnsupportedCopyModeError(consistencyError);
        }
      }
    }

    for (let index = 0; index < (playlist.audios || []).length; index++) {
      const audio = playlist.audios[index];
      const probeData = await runFFprobe(resolvePublicFilePath(audio.filepath));
      const label = buildMediaLabel(audio, index, 'Audio');
      const compatibilityError = validateYouTubeCopyAudioProbe(probeData, label);

      if (compatibilityError) {
        throw createUnsupportedCopyModeError(compatibilityError);
      }
    }

    return;
  }

  const video = await Video.findById(videoId);
  if (!video) {
    throw new Error('Video not found');
  }

  const isImg = isImageFile(video.filepath);
  const compatibilityError = validateYouTubeCopyVideoProbe(
    await runFFprobe(resolvePublicFilePath(video.filepath)),
    buildMediaLabel(video, 0, 'Video'),
    isImg
  );

  if (compatibilityError) {
    throw createUnsupportedCopyModeError(compatibilityError);
  }
}

function waitForStreamStartup(streamId, ffmpegProcess, startupState) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finishResolve = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve();
    };

    const finishReject = (message) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(new Error(message));
    };

    const timer = setTimeout(() => {
      finishReject(buildStartupFailureMessage(
        startupState,
        `tidak ada progres FFmpeg dalam ${Math.round(STREAM_START_TIMEOUT / 1000)} detik`
      ));
    }, STREAM_START_TIMEOUT);

    startupState.resolve = finishResolve;

    startupState.reject = finishReject;
  });
}

async function buildFFmpegArgsForPlaylist(stream, playlist) {
  if (!playlist.videos || playlist.videos.length === 0) {
    throw new Error('Playlist is empty');
  }

  const projectRoot = path.resolve(__dirname, '..');
  const rtmpUrl = `${stream.rtmp_url.replace(/\/$/, '')}/${stream.stream_key}`;
  const tempDir = path.join(projectRoot, 'temp');

  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }

  const hasAudio = playlist.audios && playlist.audios.length > 0;
  
  // Detect if this is a Slideshow (Radio Mode)
  // A slideshow is a playlist where all "videos" are actually images
  let isSlideshow = true;
  for (const item of playlist.videos) {
    if (!isImageFile(item.filepath)) {
      isSlideshow = false;
      break;
    }
  }

  const resolution = stream.resolution || '1280x720';
  const normalBitrate = stream.bitrate || 2500;
  const normalFps = stream.fps || 30;
  const bitrate = isSlideshow ? getSlideshowBitrate(stream) : normalBitrate;
  const fps = isSlideshow ? getSlideshowFps(stream) : normalFps;
  const transitionType = playlist.transition_type || 'none';
  const transitionDuration = parseFloat(playlist.transition_duration) || 1.0;
  const imageDuration = 10; // Total duration per image

  let videoPaths = [];
  const videos = playlist.is_shuffle ? shuffleArray(playlist.videos) : playlist.videos;

  if (isSlideshow) {
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      const relPath = video.filepath.startsWith('/') ? video.filepath.substring(1) : video.filepath;
      const fullPath = path.join(projectRoot, 'public', relPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Media file not found: ${fullPath}`);
      }
      
      // Standardize image based on transition mode
      // All modes now use normalized .jpg images to minimize CPU load and startup time
      const normPath = path.join(tempDir, `norm_${stream.id}_${i}.jpg`);
      try {
        await runFfmpeg([
          '-y',
          '-hide_banner',
          '-loglevel', 'warning',
          '-i', fullPath,
          '-vf', `scale=${resolution}:force_original_aspect_ratio=increase,crop=${resolution.replace('x', ':')}`,
          '-frames:v', '1',
          '-c:v', 'mjpeg',
          '-q:v', '3',
          '-pix_fmt', 'yuvj420p',
          normPath
        ]);
        videoPaths.push(normPath);
      } catch (e) {
        console.error(`Failed to normalize image to JPG ${fullPath}:`, e);
        videoPaths.push(fullPath); 
      }
    }
  } else {
    for (const video of videos) {
      const relPath = video.filepath.startsWith('/') ? video.filepath.substring(1) : video.filepath;
      const fullPath = path.join(projectRoot, 'public', relPath);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Media file not found: ${fullPath}`);
      }
      videoPaths.push(fullPath);
    }
  }

  const concatFile = path.join(tempDir, `playlist_${stream.id}.txt`);
  let content = '';
  const loopCount = stream.loop_video ? 10000 : 1;

  if (isSlideshow) {
    // Image Slideshow Concat Format
    // We generate images, so we need 'duration' directives
    for (let i = 0; i < loopCount; i++) {
      for (const vp of videoPaths) {
        content += `file '${vp.replace(/\\/g, '/')}'\n`;
        content += `duration ${imageDuration}\n`;
      }
    }
    if (videoPaths.length > 0) {
      content += `file '${videoPaths[videoPaths.length - 1].replace(/\\/g, '/')}'\n`;
    }
  } else {
    // Normal Video Concat Format
    for (let i = 0; i < loopCount; i++) {
      for (const vp of videoPaths) {
        content += `file '${vp.replace(/\\/g, '/')}'\n`;
      }
    }
  }
  fs.writeFileSync(concatFile, content);

  if (isSlideshow) {
    // --- SLIDESHOW MODE (Images) ---
    // If no audio is provided, we must generate a silent audio track because YouTube RTMP requires an audio stream
    let audioInputArgs = [];
    if (hasAudio) {
      let audioPaths = [];
      const audios = playlist.is_shuffle ? shuffleArray(playlist.audios) : playlist.audios;

      for (const audio of audios) {
        const relPath = audio.filepath.startsWith('/') ? audio.filepath.substring(1) : audio.filepath;
        const fullPath = path.join(projectRoot, 'public', relPath);
        if (!fs.existsSync(fullPath)) {
          throw new Error(`Audio file not found: ${fullPath}`);
        }
        audioPaths.push(fullPath);
      }

      const audioConcatFile = path.join(tempDir, `playlist_audio_${stream.id}.txt`);
      let audioContent = '';
      for (let i = 0; i < 10000; i++) {
        for (const ap of audioPaths) {
          audioContent += `file '${ap.replace(/\\/g, '/')}'\n`;
        }
      }
      fs.writeFileSync(audioConcatFile, audioContent);
      audioInputArgs = ['-f', 'concat', '-safe', '0', '-i', audioConcatFile];
    } else {
      audioInputArgs = ['-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100'];
    }

    // For static slides without transitions, render once and stream-copy the video.
    // This keeps the live FFmpeg process light on small VPS instances.
    if (transitionType === 'none' || videoPaths.length <= 1) {
      const renderedSlideshowPath = await renderStaticSlideshowVideo({
        streamId: stream.id,
        videoPaths,
        tempDir,
        resolution,
        fps,
        bitrate,
        imageDuration
      });
      const loopArgs = stream.loop_video ? ['-stream_loop', '-1'] : [];

      return [
        '-nostdin',
        '-loglevel', 'warning',
        '-stats',
        '-re',
        ...loopArgs,
        '-i', renderedSlideshowPath,
        ...audioInputArgs,
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize',
        rtmpUrl
      ];
    }

    // --- COMPLEX XFADE MODE (Seamless Circular Loop) ---
    const maxImages = 20; 
    const limitedPaths = videoPaths.slice(0, maxImages);
    
    // To make it seamless, we add the first image to the end again
    const circularPaths = [...limitedPaths, limitedPaths[0]];
    const args = [
      '-nostdin',
      '-loglevel', 'warning',
      '-stats',
    ];

    // Add inputs
    circularPaths.forEach(path => {
      args.push('-loop', '1', '-t', imageDuration.toString(), '-framerate', fps.toString(), '-i', path);
    });

    // Add audio input (Input index will be circularPaths.length)
    args.push(...audioInputArgs);

    // Build filter complex
    let filter = '';
    // 1. Pass-through video inputs (already scaled)
    for (let i = 0; i < circularPaths.length; i++) {
      filter += `[${i}:v]copy[v${i}];`;
    }

    // 2. Chain xfade including the last-to-first transition
    let lastLabel = 'v0';
    for (let i = 0; i < circularPaths.length - 1; i++) {
      const offset = (i + 1) * (imageDuration - transitionDuration);
      const nextLabel = `xf${i}`;
      filter += `[${lastLabel}][v${i+1}]xfade=transition=${transitionType}:duration=${transitionDuration}:offset=${offset.toFixed(2)}[${nextLabel}];`;
      lastLabel = nextLabel;
    }

    // 3. Perfect Loop Calculation
    // The total duration for a seamless loop of N images is N * (imageDuration - transitionDuration)
    const loopDuration = limitedPaths.length * (imageDuration - transitionDuration);
    
    // For 1-core VPS, looping large xfade graphs causes OOM. We limit size, but user expects infinite loop.
    // We will keep loop for now but they should be warned if they use it.
    filter += `[${lastLabel}]loop=loop=-1:size=${Math.floor(loopDuration * fps)}:start=0,realtime[loopv];`;
    
    filter += `[loopv]copy[v]`;

    args.push('-filter_complex', filter);
    args.push('-map', '[v]');
    args.push('-map', `${circularPaths.length}:a:0`);
    args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-tune', 'zerolatency', '-profile:v', 'main', '-pix_fmt', 'yuv420p');
    args.push('-b:v', `${bitrate}k`, '-maxrate', `${bitrate}k`, '-bufsize', `${bitrate * 2}k`);
    args.push('-s', resolution, '-r', fps, '-g', fps * 2, '-keyint_min', fps, '-x264opts', `keyint=${fps * 2}:min-keyint=${fps}:no-scenecut`);
    args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100');
    args.push('-f', 'flv', '-flvflags', 'no_duration_filesize', rtmpUrl);

    return args;
  }

  // --- NORMAL MODE (Existing Logic) ---
  if (!hasAudio) {
    if (!stream.use_advanced_settings) {
      return [
        '-nostdin',
        '-loglevel', 'warning',
        '-stats',
        '-re',
        '-fflags', '+genpts+igndts+discardcorrupt',
        '-avoid_negative_ts', 'make_zero',
        '-f', 'concat',
        '-safe', '0',
        '-i', concatFile,
        '-c:v', 'copy',
        '-c:a', 'copy',
        '-bsf:a', 'aac_adtstoasc',
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize',
        rtmpUrl
      ];
    }

    const resolution = stream.resolution || '1280x720';
    const bitrate = stream.bitrate || 2500;
    const fps = stream.fps || 30;

    // Optimized Adaptive Logic for Playlist
    const activeCount = Array.from(activeStreams.values()).filter(s => s.streamId !== stream.id).length;
    let finalBitrate = bitrate;
    let finalResolution = resolution;

    if (activeCount > 0) {
        finalBitrate = Math.round(bitrate * (activeCount === 1 ? 0.85 : 0.7));
        if (activeCount >= 2 && (resolution.includes('1080') || resolution.includes('1920'))) {
            finalResolution = '1280x720';
        }
    }

    return [
      '-nostdin',
      '-loglevel', 'warning',
      '-stats',
      '-re',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${finalBitrate}k`,
      '-maxrate', `${finalBitrate}k`,
      '-bufsize', `${finalBitrate * 2}k`,
      '-s', finalResolution,
      '-r', fps,
      '-g', fps * 2,
      '-keyint_min', fps,
      '-x264opts', `keyint=${fps * 2}:min-keyint=${fps}:no-scenecut`,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];
  }

  let audioPaths = [];
  const audios = playlist.is_shuffle ? shuffleArray(playlist.audios) : playlist.audios;

  for (const audio of audios) {
    const relPath = audio.filepath.startsWith('/') ? audio.filepath.substring(1) : audio.filepath;
    const fullPath = path.join(projectRoot, 'public', relPath);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Audio file not found: ${fullPath}`);
    }
    audioPaths.push(fullPath);
  }

  const audioConcatFile = path.join(tempDir, `playlist_audio_${stream.id}.txt`);
  let audioContent = '';
  for (let i = 0; i < 10000; i++) {
    for (const ap of audioPaths) {
      audioContent += `file '${ap.replace(/\\/g, '/')}'\n`;
    }
  }
  fs.writeFileSync(audioConcatFile, audioContent);

  if (!stream.use_advanced_settings) {
    const resolution = stream.resolution || '1280x720';
    const bitrate = stream.bitrate || 2500;
    const fps = stream.fps || 30;

    // Optimized Adaptive Logic for Playlist with Custom Audio
    const activeCount = Array.from(activeStreams.values()).filter(s => s.streamId !== stream.id).length;
    let finalBitrate = bitrate;
    let finalResolution = resolution;

    if (activeCount > 0) {
        finalBitrate = Math.round(bitrate * (activeCount === 1 ? 0.85 : 0.7));
        if (activeCount >= 2 && (resolution.includes('1080') || resolution.includes('1920'))) {
            finalResolution = '1280x720';
        }
    }

    return [
      '-nostdin',
      '-loglevel', 'warning',
      '-stats',
      '-re',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-re',
      '-f', 'concat',
      '-safe', '0',
      '-i', audioConcatFile,
      '-map', '0:v:0',
      '-map', '1:a:0',
      '-c:v', 'libx264',
      '-preset', 'superfast',
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-pix_fmt', 'yuv420p',
      '-b:v', `${finalBitrate}k`,
      '-maxrate', `${finalBitrate}k`,
      '-bufsize', `${finalBitrate * 2}k`,
      '-s', finalResolution,
      '-r', fps,
      '-g', fps * 2,
      '-keyint_min', fps,
      '-x264opts', `keyint=${fps * 2}:min-keyint=${fps}:no-scenecut`,
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];
  }

  return [
    '-nostdin',
    '-loglevel', 'warning',
    '-stats',
    '-re',
    '-fflags', '+genpts+igndts+discardcorrupt',
    '-avoid_negative_ts', 'make_zero',
    '-f', 'concat',
    '-safe', '0',
    '-i', concatFile,
    '-re',
    '-f', 'concat',
    '-safe', '0',
    '-i', audioConcatFile,
    '-map', '0:v:0',
    '-map', '1:a:0',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-tune', 'zerolatency',
    '-profile:v', 'high',
    '-level', '4.1',
    '-b:v', `${bitrate}k`,
    '-maxrate', `${Math.round(bitrate * 1.1)}k`,
    '-bufsize', `${bitrate * 2}k`,
    '-pix_fmt', 'yuv420p',
    '-g', String(fps * 2),
    '-keyint_min', String(fps),
    '-sc_threshold', '0',
    '-s', resolution,
    '-r', String(fps),
    '-c:a', 'copy',
    '-f', 'flv',
    '-flvflags', 'no_duration_filesize',
    rtmpUrl
  ];
}

async function buildFFmpegArgs(stream) {
  const streamWithVideo = await Stream.getStreamWithVideo(stream.id);

  if (streamWithVideo && streamWithVideo.video_type === 'playlist') {
    const playlist = await Playlist.findByIdWithVideos(stream.video_id);
    if (!playlist) {
      throw new Error('Playlist not found');
    }
    return await buildFFmpegArgsForPlaylist(stream, playlist);
  }

  const video = await Video.findById(stream.video_id);
  if (!video) {
    throw new Error('Video not found');
  }

  const relPath = video.filepath.startsWith('/') ? video.filepath.substring(1) : video.filepath;
  const projectRoot = path.resolve(__dirname, '..');
  const videoPath = path.join(projectRoot, 'public', relPath);

  if (!fs.existsSync(videoPath)) {
    throw new Error(`Video file not found: ${videoPath}`);
  }

  const rtmpUrl = `${stream.rtmp_url.replace(/\/$/, '')}/${stream.stream_key}`;
  const loopValue = stream.loop_video ? '-1' : '0';
  const isImg = isImageFile(video.filepath);

  if (!stream.use_advanced_settings) {
    if (isImg) {
      // Force transcode for single image even if advanced settings are off
      const resolution = stream.resolution || '1280x720';
      const bitrate = getSlideshowBitrate(stream);
      const fps = getSlideshowFps(stream);
      
      return [
        '-nostdin',
        '-loglevel', 'warning',
        '-stats',
        '-re',
        '-loop', '1',
        '-i', videoPath,
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'stillimage',
        '-pix_fmt', 'yuv420p',
        '-b:v', `${bitrate}k`,
        '-maxrate', `${bitrate}k`,
        '-bufsize', `${bitrate * 2}k`,
        '-s', resolution,
        '-r', fps,
        '-g', fps * 2,
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '44100',
        '-t', '36000', // Long duration for image loop
        '-f', 'flv',
        '-flvflags', 'no_duration_filesize',
        rtmpUrl
      ];
    }

    return [
      '-nostdin',
      '-loglevel', 'warning',
      '-stats',
      '-re',
      '-fflags', '+genpts+igndts+discardcorrupt',
      '-avoid_negative_ts', 'make_zero',
      '-stream_loop', loopValue,
      '-i', videoPath,
      '-c:v', 'copy',
      '-c:a', 'copy',
      '-bsf:a', 'aac_adtstoasc',
      '-f', 'flv',
      '-flvflags', 'no_duration_filesize',
      rtmpUrl
    ];
  }

  const resolution = stream.resolution || '1280x720';
  const bitrate = isImg ? getSlideshowBitrate(stream) : stream.bitrate || 2500;
  const fps = isImg ? getSlideshowFps(stream) : stream.fps || 30;

  // Optimized Adaptive Logic for 1 Core VPS
  // Focuses on maintaining "Excellent" health status with minimal CPU overhead
  const activeCount = Array.from(activeStreams.values()).filter(s => s.streamId !== stream.id).length;
  let finalBitrate = bitrate;
  let finalResolution = resolution;

  if (activeCount > 0) {
      // Balance bitrate to prevent network/CPU saturation on 1 Core
      finalBitrate = Math.round(bitrate * (activeCount === 1 ? 0.85 : 0.7));
      // Only downscale if absolutely necessary (3+ streams on 1 core)
      if (activeCount >= 2 && (resolution.includes('1080') || resolution.includes('1920'))) {
          finalResolution = '1280x720';
      }
      console.log(`[StreamingService] Adaptive Tuning: ${activeCount} active. Using ${finalResolution} @ ${finalBitrate}k (CPU Optimized)`);
  }

  return [
    '-nostdin',
    '-loglevel', 'warning',
    '-stats',
    '-re',
    '-fflags', '+genpts+igndts+discardcorrupt',
    '-avoid_negative_ts', 'make_zero',
    '-stream_loop', loopValue,
    '-i', videoPath,
    '-c:v', 'libx264',
    '-preset', 'superfast', // Superfast is the sweet spot for 1 Core Excellent Quality
    '-tune', 'zerolatency',
    '-profile:v', 'main',
    '-pix_fmt', 'yuv420p', // Required for YouTube Excellent Health
    '-b:v', `${finalBitrate}k`,
    '-maxrate', `${finalBitrate}k`, // Strict CBR for YouTube
    '-bufsize', `${finalBitrate * 2}k`,
    '-s', finalResolution,
    '-r', fps,
    '-g', fps * 2, // Strict 2s Keyframe interval
    '-keyint_min', fps,
    '-x264opts', `keyint=${fps * 2}:min-keyint=${fps}:no-scenecut`, // Enforce keyframes
    '-c:a', 'aac',
    '-b:a', '128k',
    '-ar', '44100',
    '-f', 'flv',
    '-flvflags', 'no_duration_filesize',
    rtmpUrl
  ];
}


async function killFFmpegProcess(streamId, streamData) {
  return new Promise((resolve) => {
    if (!streamData || !streamData.process) {
      resolve(true);
      return;
    }

    const proc = streamData.process;

    if (proc.exitCode !== null) {
      resolve(true);
      return;
    }

    let resolved = false;
    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        resolve(true);
      }
    };

    proc.once('exit', cleanup);
    proc.once('error', cleanup);

    try {
      proc.kill('SIGTERM');
    } catch (e) { }

    setTimeout(() => {
      if (!resolved) {
        try {
          if (proc.exitCode === null) {
            proc.kill('SIGKILL');
          }
        } catch (e) { }
      }
    }, 3000);

    setTimeout(cleanup, 5000);
  });
}

async function startStream(streamId, isRetry = false, baseUrl = null) {
  if (startingStreams.has(streamId)) {
    return { success: false, error: 'Stream start is already in progress' };
  }

  startingStreams.add(streamId);

  try {
    if (!isRetry) {
      streamRetryCount.set(streamId, 0);
    }

    if (activeStreams.has(streamId)) {
      const existing = activeStreams.get(streamId);
      if (existing.process && existing.process.exitCode === null) {
        if (!isRetry) {
          return { success: false, error: 'Stream is already active' };
        }
        addStreamLog(streamId, 'Killing existing FFmpeg process before restart...');
        manuallyStoppingStreams.add(streamId);
        await killFFmpegProcess(streamId, existing);
        manuallyStoppingStreams.delete(streamId);
      }
      activeStreams.delete(streamId);
    }

    let stream = await Stream.findById(streamId);
    if (!stream) {
      return { success: false, error: 'Stream not found' };
    }

    const originalStartTime = stream.start_time;
    const originalEndTime = stream.end_time;

    try {
      await validateCopyModeCompatibility(stream);
    } catch (compatibilityError) {
      if (compatibilityError.code === 'UNSUPPORTED_COPY_MODE_MEDIA') {
        addStreamLog(streamId, `Copy mode unsupported (${compatibilityError.message}). Forcing Advanced Settings (Transcoding).`);
        stream.use_advanced_settings = true;
      } else {
        throw compatibilityError;
      }
    }


    if (stream.is_youtube_api) {
      const youtubeService = require('./youtubeService');
      const effectiveBaseUrl = baseUrl || process.env.YOUTUBE_BASE_URL || process.env.APP_BASE_URL || process.env.PUBLIC_BASE_URL || process.env.BASE_URL || 'http://localhost:7575';

      addStreamLog(streamId, 'Creating YouTube broadcast...');

      try {
        const ytResult = await youtubeService.createYouTubeBroadcast(streamId, effectiveBaseUrl);
        if (!ytResult.success) {
          addStreamLog(streamId, `YouTube broadcast failed: ${ytResult.error}`);
          return { success: false, error: ytResult.error || 'Failed to create YouTube broadcast' };
        }
        stream = await Stream.findById(streamId);
        addStreamLog(streamId, `YouTube broadcast created: ${ytResult.broadcastId}`);
      } catch (ytError) {
        addStreamLog(streamId, `YouTube API error: ${ytError.message}`);
        return { success: false, error: `YouTube API error: ${ytError.message}` };
      }
    }

    if (!stream.rtmp_url || !stream.stream_key) {
      return { success: false, error: 'Missing RTMP URL or stream key' };
    }

    const ffmpegArgs = await buildFFmpegArgs(stream);

    addStreamLog(streamId, `Starting FFmpeg process`);

    const ffmpegProcess = spawn(ffmpegPath, ffmpegArgs, {
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    const startupState = {
      lastLogLine: '',
      lastErrorLine: '',
      resolve: null,
      reject: null
    };

    const startupPromise = waitForStreamStartup(streamId, ffmpegProcess, startupState);

    let startTimeIso;
    if (isRetry && originalStartTime) {
      startTimeIso = originalStartTime;
    } else {
      startTimeIso = new Date().toISOString();
    }

    activeStreams.set(streamId, {
      process: ffmpegProcess,
      userId: stream.user_id,
      startTime: startTimeIso,
      endTime: originalEndTime,
      pid: ffmpegProcess.pid,
      lastActivity: Date.now()
    });

    ffmpegProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) {
        addStreamLog(streamId, `[OUT] ${msg}`);
        updateStreamActivity(streamId);
      }
    });

    ffmpegProcess.stderr.on('data', (data) => {
      const lines = data.toString().split(/\r?\n|\r/g);
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
          continue;
        }

        updateStreamActivity(streamId);

        if (isProgressLogLine(line)) {
          if (startupState.resolve) {
            startupState.resolve();
          }
          continue;
        }

        addStreamLog(streamId, `[FFmpeg] ${line}`);

        const relevantLog = getRelevantStartupLog(line);
        if (relevantLog) {
          startupState.lastLogLine = relevantLog;

          if (/(error|failed|invalid|unsupported|broken pipe|connection.*refused|input\/output error|could not write header)/i.test(relevantLog)) {
            startupState.lastErrorLine = relevantLog;
          }
        }
      }
    });

    ffmpegProcess.on('exit', async (code, signal) => {
      addStreamLog(streamId, `FFmpeg exited: code=${code}, signal=${signal}`);

      const wasActive = activeStreams.delete(streamId);
      const isManualStop = manuallyStoppingStreams.has(streamId);

      if (isManualStop) {
        manuallyStoppingStreams.delete(streamId);
        cleanupStreamData(streamId);
        return;
      }

      if (startupState.reject) {
        startupState.reject(buildStartupFailureMessage(
          startupState,
          `FFmpeg exited with code=${code}, signal=${signal}`
        ));
      }

      const currentStream = await Stream.findById(streamId);

      if (currentStream && currentStream.end_time) {
        const endTime = new Date(currentStream.end_time);
        const now = new Date();
        if (endTime.getTime() <= now.getTime()) {
          addStreamLog(streamId, 'Stream ended - scheduled end time reached');
          if (wasActive) {
            try {
              await Stream.updateStatus(streamId, 'offline', currentStream.user_id);
              if (schedulerService) {
                schedulerService.handleStreamStopped(streamId);
              }
            } catch (e) { }
          }
          cleanupStreamData(streamId);
          return;
        }
      }

      const shouldRetry = signal === 'SIGSEGV' || signal === 'SIGKILL' || signal === 'SIGPIPE' ||
        (code !== 0 && code !== null) || (code === null && signal === null);

      if (shouldRetry && currentStream && currentStream.status !== 'offline') {
        const retryCount = streamRetryCount.get(streamId) || 0;

        if (retryCount < MAX_RETRY_ATTEMPTS) {
          streamRetryCount.set(streamId, retryCount + 1);
          const delay = getRetryDelay(retryCount);

          addStreamLog(streamId, `Retry #${retryCount + 1} in ${Math.round(delay / 1000)}s`);

          setTimeout(async () => {
            try {
              const latestStream = await Stream.findById(streamId);
              if (latestStream && latestStream.status !== 'offline') {
                if (latestStream.end_time) {
                  const endTime = new Date(latestStream.end_time);
                  const now = new Date();
                  if (endTime.getTime() <= now.getTime()) {
                    await Stream.updateStatus(streamId, 'offline', latestStream.user_id);
                    cleanupStreamData(streamId);
                    return;
                  }
                }
                const result = await startStream(streamId, true, baseUrl);
                if (!result.success) {
                  await Stream.updateStatus(streamId, 'offline', latestStream.user_id);
                  cleanupStreamData(streamId);
                }
              } else {
                cleanupStreamData(streamId);
              }
            } catch (e) {
              cleanupStreamData(streamId);
            }
          }, delay);
          return;
        } else {
          addStreamLog(streamId, `Max retries (${MAX_RETRY_ATTEMPTS}) reached`);
        }
      }

      if (wasActive && currentStream) {
        try {
          await Stream.updateStatus(streamId, 'offline', currentStream.user_id);
          if (schedulerService) {
            schedulerService.handleStreamStopped(streamId);
          }
        } catch (e) { }
        cleanupStreamData(streamId);
      }
    });

    ffmpegProcess.on('error', async (err) => {
      addStreamLog(streamId, `Process error: ${err.message}`);
      startupState.lastErrorLine = err.message;
      if (startupState.reject) {
        startupState.reject(buildStartupFailureMessage(startupState, err.message));
      }
      activeStreams.delete(streamId);
      try {
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
      } catch (e) { }
      cleanupStreamData(streamId);
    });

    try {
      await startupPromise;
    } catch (startupError) {
      manuallyStoppingStreams.add(streamId);
      await killFFmpegProcess(streamId, activeStreams.get(streamId));
      manuallyStoppingStreams.delete(streamId);
      activeStreams.delete(streamId);
      cleanupTempFiles(streamId);
      cleanupStreamData(streamId);
      throw startupError;
    }

    if (!isRetry) {
      await Stream.updateStatus(streamId, 'live', stream.user_id, { startTimeOverride: startTimeIso });
    }

    if (schedulerService && originalEndTime) {
      if (typeof schedulerService.scheduleStreamTerminationByEndTime === 'function') {
        schedulerService.scheduleStreamTerminationByEndTime(streamId, originalEndTime, stream.user_id);
      }
    }

    return {
      success: true,
      message: 'Stream started successfully',
      isAdvancedMode: stream.use_advanced_settings
    };
  } catch (error) {
    addStreamLog(streamId, `Start failed: ${error.message}`);
    return { success: false, error: error.message, code: error.code || null };
  } finally {
    startingStreams.delete(streamId);
  }
}

function updateStreamActivity(streamId) {
  const streamData = activeStreams.get(streamId);
  if (streamData) {
    streamData.lastActivity = Date.now();
  }
}

async function stopStream(streamId) {
  try {
    const streamData = activeStreams.get(streamId);
    const stream = await Stream.findById(streamId);

    if (!streamData) {
      if (stream && stream.status === 'live') {
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
        if (schedulerService) {
          schedulerService.handleStreamStopped(streamId);
        }
        cleanupStreamData(streamId);
        return { success: true, message: 'Stream status fixed' };
      }
      return { success: false, error: 'Stream is not active' };
    }

    addStreamLog(streamId, 'Stopping stream...');
    manuallyStoppingStreams.add(streamId);

    await killFFmpegProcess(streamId, streamData);

    activeStreams.delete(streamId);
    cleanupTempFiles(streamId);

    if (stream) {
      if (stream.is_youtube_api && stream.youtube_broadcast_id) {
        try {
          const youtubeService = require('./youtubeService');
          await youtubeService.stopYouTubeBroadcast(streamId);
          await youtubeService.deleteYouTubeBroadcast(streamId);
        } catch (e) { }
      }

      await saveStreamHistory(stream);
      await Stream.updateStatus(streamId, 'offline', stream.user_id);
    }

    if (schedulerService) {
      schedulerService.handleStreamStopped(streamId);
    }

    cleanupStreamData(streamId);
    return { success: true, message: 'Stream stopped successfully' };
  } catch (error) {
    manuallyStoppingStreams.delete(streamId);
    return { success: false, error: error.message };
  }
}

function cleanupTempFiles(streamId) {
  const tempDir = path.join(__dirname, '..', 'temp');
  const files = [
    path.join(tempDir, `playlist_${streamId}.txt`),
    path.join(tempDir, `playlist_audio_${streamId}.txt`)
  ];

  for (const file of files) {
    try {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } catch (e) { }
  }
}

function isStreamActive(streamId) {
  const streamData = activeStreams.get(streamId);
  if (!streamData) return false;

  if (streamData.process && streamData.process.exitCode !== null) {
    activeStreams.delete(streamId);
    return false;
  }

  return true;
}

function isStreamStarting(streamId) {
  return startingStreams.has(streamId);
}

function getActiveStreams() {
  return Array.from(activeStreams.keys());
}

function getActiveStreamInfo(streamId) {
  const streamData = activeStreams.get(streamId);
  if (!streamData) return null;

  return {
    streamId,
    userId: streamData.userId,
    startTime: streamData.startTime,
    endTime: streamData.endTime,
    pid: streamData.pid,
    lastActivity: streamData.lastActivity,
    retryCount: streamRetryCount.get(streamId) || 0
  };
}


async function syncStreamStatuses() {
  try {
    const liveStreams = await Stream.findAll(null, 'live');

    for (const stream of liveStreams) {
      const isActive = activeStreams.has(stream.id);

      if (!isActive) {
        const retryCount = streamRetryCount.get(stream.id);
        if (retryCount !== undefined && retryCount < MAX_RETRY_ATTEMPTS) {
          continue;
        }

        if (stream.end_time) {
          const endTime = new Date(stream.end_time);
          if (endTime.getTime() <= Date.now()) {
            await Stream.updateStatus(stream.id, 'offline', stream.user_id);
            cleanupStreamData(stream.id);
            continue;
          }
        }

        await Stream.updateStatus(stream.id, 'offline', stream.user_id, { preserveEndTime: true });
        cleanupStreamData(stream.id);
      }
    }

    for (const [streamId, streamData] of activeStreams) {
      const stream = await Stream.findById(streamId);

      if (!stream) {
        const proc = streamData.process;
        if (proc && typeof proc.kill === 'function') {
          try {
            proc.kill('SIGTERM');
          } catch (e) { }
        }
        activeStreams.delete(streamId);
        cleanupStreamData(streamId);
        continue;
      }

      if (stream.status !== 'live') {
        await Stream.updateStatus(streamId, 'live', stream.user_id);
      }

      if (streamData.process && streamData.process.exitCode !== null) {
        activeStreams.delete(streamId);
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
        cleanupStreamData(streamId);
      }
    }
  } catch (error) { }
}

async function healthCheckStreams() {
  try {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000;

    for (const [streamId, streamData] of activeStreams) {
      if (streamData.process && streamData.process.exitCode !== null) {
        activeStreams.delete(streamId);
        const stream = await Stream.findById(streamId);
        if (stream && stream.status === 'live') {
          if (stream.end_time) {
            const endTime = new Date(stream.end_time);
            if (endTime.getTime() <= Date.now()) {
              await Stream.updateStatus(streamId, 'offline', stream.user_id);
              cleanupStreamData(streamId);
              continue;
            }
          }
          await Stream.updateStatus(streamId, 'offline', stream.user_id, { preserveEndTime: true });
        }
        cleanupStreamData(streamId);
        continue;
      }

      if (streamData.lastActivity && (now - streamData.lastActivity) > staleThreshold) {
        addStreamLog(streamId, 'Stream appears stale, restarting...');

        const stream = await Stream.findById(streamId);
        if (stream && stream.status === 'live') {
          if (stream.end_time) {
            const endTime = new Date(stream.end_time);
            if (endTime.getTime() <= Date.now()) {
              manuallyStoppingStreams.add(streamId);
              await killFFmpegProcess(streamId, streamData);
              activeStreams.delete(streamId);
              manuallyStoppingStreams.delete(streamId);
              await Stream.updateStatus(streamId, 'offline', stream.user_id);
              cleanupStreamData(streamId);
              continue;
            }
          }

          manuallyStoppingStreams.add(streamId);
          await killFFmpegProcess(streamId, streamData);
          activeStreams.delete(streamId);
          manuallyStoppingStreams.delete(streamId);

          setTimeout(async () => {
            try {
              const currentStream = await Stream.findById(streamId);
              if (currentStream && currentStream.status === 'live') {
                await startStream(streamId, true);
              }
            } catch (e) { }
          }, 3000);
        }
      }
    }
  } catch (error) { }
}

async function saveStreamHistory(stream) {
  try {
    if (!stream.start_time) {
      return false;
    }

    const startTime = new Date(stream.start_time);
    const endTime = new Date();
    const durationSeconds = Math.floor((endTime - startTime) / 1000);

    if (durationSeconds < 10) {
      return false;
    }

    const videoDetails = stream.video_id ? await Video.findById(stream.video_id) : null;

    const historyData = {
      id: uuidv4(),
      stream_id: stream.id,
      title: stream.title,
      platform: stream.platform || 'Custom',
      platform_icon: stream.platform_icon,
      video_id: stream.video_id,
      video_title: videoDetails ? videoDetails.title : null,
      resolution: stream.resolution,
      bitrate: stream.bitrate,
      fps: stream.fps,
      start_time: stream.start_time,
      end_time: endTime.toISOString(),
      duration: durationSeconds,
      use_advanced_settings: stream.use_advanced_settings ? 1 : 0,
      user_id: stream.user_id
    };

    return new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO stream_history (
          id, stream_id, title, platform, platform_icon, video_id, video_title,
          resolution, bitrate, fps, start_time, end_time, duration, use_advanced_settings, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          historyData.id, historyData.stream_id, historyData.title,
          historyData.platform, historyData.platform_icon, historyData.video_id, historyData.video_title,
          historyData.resolution, historyData.bitrate, historyData.fps,
          historyData.start_time, historyData.end_time, historyData.duration,
          historyData.use_advanced_settings, historyData.user_id
        ],
        function (err) {
          if (err) {
            return reject(err);
          }
          resolve(historyData);
        }
      );
    });
  } catch (error) {
    return false;
  }
}

async function gracefulShutdown() {
  if (syncIntervalId) {
    clearInterval(syncIntervalId);
    syncIntervalId = null;
  }
  if (healthCheckIntervalId) {
    clearInterval(healthCheckIntervalId);
    healthCheckIntervalId = null;
  }

  const streamIds = Array.from(activeStreams.keys());

  for (const streamId of streamIds) {
    try {
      const streamData = activeStreams.get(streamId);

      manuallyStoppingStreams.add(streamId);
      await killFFmpegProcess(streamId, streamData);

      const stream = await Stream.findById(streamId);
      if (stream) {
        await Stream.updateStatus(streamId, 'offline', stream.user_id);
      }

      activeStreams.delete(streamId);
      cleanupStreamData(streamId);
    } catch (e) { }
  }
}

process.on('SIGTERM', async () => {
  await gracefulShutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await gracefulShutdown();
  process.exit(0);
});

module.exports = {
  startStream,
  stopStream,
  validateCopyModeCompatibilityForInput,
  isStreamActive,
  isStreamStarting,
  getActiveStreams,
  getActiveStreamInfo,
  getStreamLogs,
  syncStreamStatuses,
  healthCheckStreams,
  saveStreamHistory,
  gracefulShutdown,
  setSchedulerService
};
