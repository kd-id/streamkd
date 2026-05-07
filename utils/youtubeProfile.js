const { OPTIMIZED_STREAMING_PROFILE } = require('./videoProcessor');

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseFrameRate(value, fallback = OPTIMIZED_STREAMING_PROFILE.fps) {
  if (!value) return fallback;
  const raw = value.toString();
  if (raw.includes('/')) {
    const [numerator, denominator] = raw.split('/').map(Number);
    if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
      return Math.round(numerator / denominator);
    }
  }

  return parsePositiveInt(raw, fallback);
}

function parseResolution(resolution) {
  const match = (resolution || '').toString().match(/^(\d+)\s*x\s*(\d+)$/i);
  if (!match) return null;
  return {
    width: parseInt(match[1], 10),
    height: parseInt(match[2], 10)
  };
}

function getYouTubeRecommendedBitrate(resolution, fps) {
  const parsed = parseResolution(resolution);
  const frameRate = parseFrameRate(fps);
  if (!parsed) return OPTIMIZED_STREAMING_PROFILE.bitrate;

  const qualityEdge = Math.min(parsed.width, parsed.height);
  if (qualityEdge >= 2160) return frameRate >= 60 ? 51000 : 35000;
  if (qualityEdge >= 1440) return frameRate >= 60 ? 18000 : 12000;
  if (qualityEdge >= 1080) return frameRate >= 60 ? 6800 : 4500;
  if (qualityEdge >= 720) return frameRate >= 60 ? 4500 : 2500;
  if (qualityEdge >= 480) return 1500;
  return 1000;
}

function getOptimizedYouTubeProfile() {
  return {
    resolution: OPTIMIZED_STREAMING_PROFILE.resolution,
    bitrate: OPTIMIZED_STREAMING_PROFILE.bitrate,
    fps: OPTIMIZED_STREAMING_PROFILE.fps
  };
}

function getStableYouTubeProfile(mediaProfileSource = null) {
  const optimized = getOptimizedYouTubeProfile();
  const sourceResolution = mediaProfileSource?.resolution || '';
  const sourceBitrate = parsePositiveInt(mediaProfileSource?.bitrate, 0);
  const sourceFps = parseFrameRate(mediaProfileSource?.fps, optimized.fps);

  if (!sourceResolution || !sourceBitrate) {
    return optimized;
  }

  const recommendedBitrate = getYouTubeRecommendedBitrate(sourceResolution, sourceFps);
  if (sourceBitrate >= recommendedBitrate) {
    return {
      resolution: sourceResolution,
      bitrate: sourceBitrate,
      fps: sourceFps
    };
  }

  return optimized;
}

module.exports = {
  getOptimizedYouTubeProfile,
  getStableYouTubeProfile,
  getYouTubeRecommendedBitrate
};
