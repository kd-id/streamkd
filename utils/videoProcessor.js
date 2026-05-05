const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const { getVideoDurationInSeconds } = require('get-video-duration');
const fs = require('fs');
const path = require('path');
const { getUniqueFilename, paths } = require('./storage');
ffmpeg.setFfmpegPath(ffmpegPath);
const OPTIMIZED_STREAMING_PROFILE = {
  resolution: '1280x720',
  bitrate: 2500,
  fps: 30,
  audioBitrate: 128,
  audioSampleRate: 44100
};

const getVideoInfo = async (filepath) => {
  try {
    const duration = await getVideoDurationInSeconds(filepath);
    const stats = fs.statSync(filepath);
    const fileSizeInBytes = stats.size;
    return {
      duration,
      fileSize: fileSizeInBytes
    };
  } catch (error) {
    console.error('Error getting video info:', error);
    throw error;
  }
};
const generateThumbnail = (videoPath, thumbnailName) => {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(paths.thumbnails, thumbnailName);
    ffmpeg(videoPath)
      .screenshots({
        count: 1,
        folder: paths.thumbnails,
        filename: thumbnailName,
        size: '320x180'
      })
      .on('end', () => {
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error('Error generating thumbnail:', err);
        reject(err);
      });
  });
};

const generateImageThumbnail = (imagePath, thumbnailName) => {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(paths.thumbnails, thumbnailName);
    ffmpeg(imagePath)
      .outputOptions([
        '-vf', 'scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2'
      ])
      .output(thumbnailPath)
      .on('end', () => {
        resolve(thumbnailPath);
      })
      .on('error', (err) => {
        console.error('Error generating image thumbnail:', err);
        reject(err);
      })
      .run();
  });
};

const optimizeVideo = (videoPath, outputPath) => {
  return new Promise((resolve, reject) => {
    const keyframeInterval = OPTIMIZED_STREAMING_PROFILE.fps * 2;

    ffmpeg(videoPath)
      .outputOptions([
        '-vf scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30',
        '-c:v libx264',
        '-preset superfast',
        '-tune zerolatency',
        '-b:v 2500k',
        '-profile:v main',
        '-level 4.1',
        '-pix_fmt yuv420p',
        '-maxrate 2500k',
        '-minrate 2500k',
        '-bufsize 5000k',
        `-g ${keyframeInterval}`,
        `-keyint_min ${keyframeInterval}`,
        `-x264opts keyint=${keyframeInterval}:min-keyint=${keyframeInterval}:no-scenecut`,
        '-sc_threshold 0',
        '-force_key_frames expr:gte(t,n_forced*2)',
        '-r 30',
        '-vsync cfr',
        '-c:a aac',
        '-b:a 128k',
        '-ar 44100',
        '-shortest',
        '-movflags +faststart',
        '-threads 1' // Keep it low priority
      ])
      .output(outputPath)
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        console.error('Error optimizing video:', err);
        reject(err);
      })
      .run();
  });
};

module.exports = {
  getVideoInfo,
  generateThumbnail,
  generateImageThumbnail,
  optimizeVideo,
  OPTIMIZED_STREAMING_PROFILE
};
