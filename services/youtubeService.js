const { google } = require('googleapis');
const { encrypt, decrypt } = require('../utils/encryption');
const User = require('../models/User');
const Stream = require('../models/Stream');
const YoutubeChannel = require('../models/YoutubeChannel');
const fs = require('fs');
const path = require('path');

const loggedAlreadyHasBroadcast = new Set();
const DEFAULT_YOUTUBE_INGEST_TIMEOUT_MS = 120000;
const DEFAULT_YOUTUBE_INGEST_POLL_INTERVAL_MS = 3000;
const DEFAULT_YOUTUBE_INGEST_STABLE_MS = 12000;

function getYouTubeOAuth2Client(clientId, clientSecret, redirectUri) {
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getRedirectUri(baseUrl) {
  const fallbackBaseUrl =
    baseUrl ||
    process.env.YOUTUBE_BASE_URL ||
    process.env.APP_BASE_URL ||
    process.env.PUBLIC_BASE_URL ||
    process.env.BASE_URL ||
    'http://localhost:7575';

  return process.env.YOUTUBE_REDIRECT_URI || `${fallbackBaseUrl.replace(/\/$/, '')}/auth/youtube/callback`;
}

function getGoogleApiErrorReason(error) {
  return (
    error?.errors?.[0]?.reason ||
    error?.response?.data?.error?.errors?.[0]?.reason ||
    error?.response?.data?.error?.status ||
    null
  );
}

function getGoogleApiErrorMessage(error) {
  return error?.response?.data?.error?.message || error?.message || 'Unknown YouTube API error';
}

async function getAuthorizedYouTubeClientForStream(streamOrId, baseUrl = null) {
  const stream = typeof streamOrId === 'object' && streamOrId !== null
    ? streamOrId
    : await Stream.findById(streamOrId);

  if (!stream) {
    throw new Error('Stream not found');
  }

  const user = await User.findById(stream.user_id);
  if (!user || !user.youtube_client_id || !user.youtube_client_secret) {
    throw new Error('YouTube API credentials not configured');
  }

  let selectedChannel = null;
  if (stream.youtube_channel_id) {
    selectedChannel = await YoutubeChannel.findById(stream.youtube_channel_id);
  }

  if (!selectedChannel) {
    selectedChannel = await YoutubeChannel.findDefault(stream.user_id);
  }

  if (!selectedChannel) {
    const channels = await YoutubeChannel.findAll(stream.user_id);
    selectedChannel = channels[0];
  }

  if (!selectedChannel || !selectedChannel.access_token || !selectedChannel.refresh_token) {
    throw new Error('YouTube channel not found or not connected');
  }

  const clientSecret = decrypt(user.youtube_client_secret);
  const accessToken = decrypt(selectedChannel.access_token);
  const refreshToken = decrypt(selectedChannel.refresh_token);

  if (!clientSecret || !accessToken) {
    throw new Error('Failed to decrypt YouTube credentials');
  }

  const oauth2Client = getYouTubeOAuth2Client(
    user.youtube_client_id,
    clientSecret,
    getRedirectUri(baseUrl)
  );

  oauth2Client.setCredentials({
    access_token: accessToken,
    refresh_token: refreshToken
  });

  oauth2Client.on('tokens', async (tokens) => {
    if (tokens.access_token) {
      await YoutubeChannel.update(selectedChannel.id, {
        access_token: encrypt(tokens.access_token)
      });
    }
    if (tokens.refresh_token) {
      await YoutubeChannel.update(selectedChannel.id, {
        refresh_token: encrypt(tokens.refresh_token)
      });
    }
  });

  return {
    youtube: google.youtube({ version: 'v3', auth: oauth2Client }),
    stream,
    selectedChannel
  };
}

function summarizeIngestStatus(liveStream) {
  const status = liveStream?.status || {};
  const healthStatus = status.healthStatus || {};
  const issues = (healthStatus.configurationIssues || [])
    .map(issue => issue.description || issue.type)
    .filter(Boolean);

  return {
    streamStatus: status.streamStatus || 'unknown',
    healthStatus: healthStatus.status || null,
    issues
  };
}

function formatIngestStatus(statusInfo) {
  const parts = [`streamStatus=${statusInfo.streamStatus}`];
  if (statusInfo.healthStatus) {
    parts.push(`health=${statusInfo.healthStatus}`);
  }
  if (statusInfo.issues && statusInfo.issues.length > 0) {
    parts.push(`issue=${statusInfo.issues[0]}`);
  }
  return parts.join(', ');
}

async function inspectExistingYouTubeBroadcast(youtube, stream) {
  if (!stream.youtube_broadcast_id || !stream.youtube_stream_id) {
    return { reusable: false, reason: 'YouTube broadcast/stream ID tidak lengkap' };
  }

  const broadcastResponse = await youtube.liveBroadcasts.list({
    part: 'status,contentDetails',
    id: stream.youtube_broadcast_id
  });
  const broadcast = broadcastResponse.data.items?.[0];
  if (!broadcast) {
    return { reusable: false, reason: 'broadcast lama tidak ditemukan di YouTube' };
  }

  const lifecycleStatus = broadcast.status?.lifeCycleStatus || 'unknown';
  if (['complete', 'revoked'].includes(lifecycleStatus)) {
    return { reusable: false, reason: `broadcast lama sudah ${lifecycleStatus}` };
  }

  const liveStreamResponse = await youtube.liveStreams.list({
    part: 'status',
    id: stream.youtube_stream_id
  });
  const liveStream = liveStreamResponse.data.items?.[0];
  if (!liveStream) {
    return { reusable: false, reason: 'live stream lama tidak ditemukan di YouTube' };
  }

  const ingestStatus = summarizeIngestStatus(liveStream);
  if (ingestStatus.streamStatus === 'error') {
    return { reusable: false, reason: `live stream lama error: ${formatIngestStatus(ingestStatus)}` };
  }

  return {
    reusable: true,
    lifecycleStatus,
    ingestStatus
  };
}

function omitUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  );
}

function mapToYoutubeResolution(resolution) {
  if (!resolution) return '720p';
  const res = resolution.toString();
  if (res.includes('3840') || res.includes('2160')) return '2160p';
  if (res.includes('2560') || res.includes('1440')) return '1440p';
  if (res.includes('1920') || res.includes('1080')) return '1080p';
  if (res.includes('1280') || res.includes('720')) return '720p';
  if (res.includes('854') || res.includes('480')) return '480p';
  if (res.includes('640') || res.includes('360')) return '360p';
  if (res.includes('426') || res.includes('240')) return '240p';
  return '720p';
}

function mapToYoutubeFPS(fps) {
  const fpsNum = parseInt(fps);
  if (isNaN(fpsNum)) return '30fps';
  return fpsNum >= 60 ? '60fps' : '30fps';
}

async function syncBroadcastMonetization(youtube, broadcastId, enabled) {
  const broadcastResponse = await youtube.liveBroadcasts.list({
    part: 'id,snippet,contentDetails,status,monetizationDetails',
    id: broadcastId
  });

  const currentBroadcast = broadcastResponse.data.items?.[0];
  if (!currentBroadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const currentSnippet = currentBroadcast.snippet || {};
  const currentContentDetails = currentBroadcast.contentDetails || {};
  const currentStatus = currentBroadcast.status || {};
  const currentMonitorStream = currentContentDetails.monitorStream || {};
  const monitorStream = omitUndefined({
    enableMonitorStream: currentMonitorStream.enableMonitorStream,
    broadcastStreamDelayMs:
      currentMonitorStream.enableMonitorStream !== undefined
        ? currentMonitorStream.broadcastStreamDelayMs ?? 0
        : undefined
  });

  const requestBody = {
    id: broadcastId,
    snippet: omitUndefined({
      title: currentSnippet.title,
      description: currentSnippet.description || '',
      scheduledStartTime: currentSnippet.scheduledStartTime,
      scheduledEndTime: currentSnippet.scheduledEndTime
    }),
    contentDetails: omitUndefined({
      boundStreamId: currentContentDetails.boundStreamId,
      enableAutoStart: currentContentDetails.enableAutoStart,
      enableAutoStop: currentContentDetails.enableAutoStop,
      enableClosedCaptions: currentContentDetails.enableClosedCaptions,
      enableContentEncryption: currentContentDetails.enableContentEncryption,
      enableDvr: currentContentDetails.enableDvr,
      enableEmbed: currentContentDetails.enableEmbed,
      latencyPreference: currentContentDetails.latencyPreference,
      projection: currentContentDetails.projection,
      recordFromStart: currentContentDetails.recordFromStart,
      startWithSlate: currentContentDetails.startWithSlate,
      monitorStream: Object.keys(monitorStream).length > 0 ? monitorStream : undefined
    }),
    status: omitUndefined({
      privacyStatus: currentStatus.privacyStatus,
      selfDeclaredMadeForKids: currentStatus.selfDeclaredMadeForKids
    }),
    monetizationDetails: enabled
      ? {
          adsMonetizationStatus: 'ON',
          cuepointSchedule: {
            enabled: true,
            ytOptimizedCuepointConfig: 'MEDIUM'
          }
        }
      : {
          adsMonetizationStatus: 'OFF'
        }
  };

  await youtube.liveBroadcasts.update({
    part: 'id,snippet,contentDetails,status,monetizationDetails',
    requestBody
  });
}

async function createYouTubeBroadcast(streamId, baseUrl) {
  const stream = await Stream.findById(streamId);
  if (!stream) {
    throw new Error('Stream not found');
  }

  if (!stream.is_youtube_api) {
    return { success: true, message: 'Not a YouTube API stream' };
  }

  const { youtube } = await getAuthorizedYouTubeClientForStream(stream, baseUrl);

  if (stream.youtube_broadcast_id && stream.rtmp_url && stream.stream_key) {
    let existingBroadcast = null;
    try {
      existingBroadcast = await inspectExistingYouTubeBroadcast(youtube, stream);
    } catch (inspectError) {
      existingBroadcast = {
        reusable: false,
        reason: getGoogleApiErrorMessage(inspectError)
      };
    }

    if (existingBroadcast.reusable) {
      if (!loggedAlreadyHasBroadcast.has(streamId)) {
        console.log(`[YouTubeService] Stream ${streamId} already has reusable YouTube broadcast (${existingBroadcast.lifecycleStatus}), skipping creation`);
        loggedAlreadyHasBroadcast.add(streamId);
      }
      return {
        success: true,
        rtmpUrl: stream.rtmp_url,
        streamKey: stream.stream_key,
        broadcastId: stream.youtube_broadcast_id,
        streamId: stream.youtube_stream_id
      };
    }

    console.log(`[YouTubeService] Existing YouTube broadcast is not reusable for stream ${streamId}: ${existingBroadcast.reason}. Creating a new one.`);
    loggedAlreadyHasBroadcast.delete(streamId);
    await Stream.update(streamId, {
      youtube_broadcast_id: null,
      youtube_stream_id: null,
      rtmp_url: '',
      stream_key: ''
    });
  }

  const tagsArray = stream.youtube_tags ? stream.youtube_tags.split(',').map(t => t.trim()).filter(t => t) : [];

  let scheduledStartTime = new Date().toISOString();
  if (stream.schedule_time) {
    const scheduleDate = new Date(stream.schedule_time);
    if (scheduleDate.getTime() > Date.now()) {
      scheduledStartTime = scheduleDate.toISOString();
    }
  }

  const broadcastSnippet = {
    title: stream.title,
    description: stream.youtube_description || '',
    scheduledStartTime
  };

  console.log(`[YouTubeService] Creating YouTube broadcast for stream ${streamId}`);

  let broadcastResponse;
  const broadcastData = {
    snippet: broadcastSnippet,
    contentDetails: {
      enableAutoStart: true,
      enableAutoStop: true,
      monitorStream: {
        enableMonitorStream: false
      }
    },
    status: {
      privacyStatus: stream.youtube_privacy || 'unlisted',
      selfDeclaredMadeForKids: false
    }
  };

  broadcastResponse = await youtube.liveBroadcasts.insert({
    part: 'snippet,contentDetails,status',
    requestBody: broadcastData
  });

  const broadcast = broadcastResponse.data;
  console.log(`[YouTubeService] Created broadcast: ${broadcast.id}`);

  if (stream.youtube_monetization) {
    try {
      await syncBroadcastMonetization(youtube, broadcast.id, true);
      console.log(`[YouTubeService] Enabled monetization for broadcast ${broadcast.id}`);
    } catch (monetizationError) {
      console.warn(`[YouTubeService] Failed to enable monetization for broadcast ${broadcast.id}. Continuing without monetization. Error: ${monetizationError.message}`);
      await Stream.update(streamId, { youtube_monetization: false });
    }
  }

  if (tagsArray.length > 0 || stream.youtube_category) {
    try {
      const videoResponse = await youtube.videos.list({
        part: 'snippet',
        id: broadcast.id
      });

      if (videoResponse.data.items && videoResponse.data.items.length > 0) {
        const currentSnippet = videoResponse.data.items[0].snippet;
        await youtube.videos.update({
          part: 'snippet',
          requestBody: {
            id: broadcast.id,
            snippet: {
              title: stream.title,
              description: stream.youtube_description || '',
              categoryId: stream.youtube_category || '22',
              tags: tagsArray.length > 0 ? tagsArray : currentSnippet.tags,
              defaultLanguage: currentSnippet.defaultLanguage,
              defaultAudioLanguage: currentSnippet.defaultAudioLanguage
            }
          }
        });
      }
    } catch (updateError) {
      console.log('[YouTubeService] Note: Could not update video metadata:', updateError.message);
    }
  }

  if (stream.youtube_thumbnail) {
    try {
      const projectRoot = path.resolve(__dirname, '..');
      const thumbnailPath = path.join(projectRoot, 'public', stream.youtube_thumbnail);
      if (fs.existsSync(thumbnailPath)) {
        const thumbnailStream = fs.createReadStream(thumbnailPath);
        await youtube.thumbnails.set({
          videoId: broadcast.id,
          media: {
            mimeType: 'image/jpeg',
            body: thumbnailStream
          }
        });
        console.log(`[YouTubeService] Uploaded thumbnail for broadcast ${broadcast.id}`);
      }
    } catch (thumbError) {
      console.log('[YouTubeService] Note: Could not upload thumbnail:', thumbError.message);
    }
  }

  const streamResponse = await youtube.liveStreams.insert({
    part: 'snippet,cdn,contentDetails,status',
    requestBody: {
      snippet: {
        title: `${stream.title} - Stream`
      },
      cdn: {
        frameRate: mapToYoutubeFPS(stream.fps),
        ingestionType: 'rtmp',
        resolution: mapToYoutubeResolution(stream.resolution)
      },
      contentDetails: {
        isReusable: false
      }
    }
  });

  const liveStream = streamResponse.data;
  console.log(`[YouTubeService] Created live stream: ${liveStream.id}`);

  await youtube.liveBroadcasts.bind({
    part: 'id,contentDetails',
    id: broadcast.id,
    streamId: liveStream.id
  });

  const rtmpUrl = liveStream.cdn.ingestionInfo.ingestionAddress;
  const streamKey = liveStream.cdn.ingestionInfo.streamName;

  await Stream.update(streamId, {
    youtube_broadcast_id: broadcast.id,
    youtube_stream_id: liveStream.id,
    rtmp_url: rtmpUrl,
    stream_key: streamKey
  });

  console.log(`[YouTubeService] YouTube broadcast created successfully for stream ${streamId}`);

  return {
    success: true,
    broadcastId: broadcast.id,
    streamId: liveStream.id,
    rtmpUrl: rtmpUrl,
    streamKey: streamKey
  };
}

async function getYouTubeIngestStatus(streamId, baseUrl = null) {
  const { youtube, stream } = await getAuthorizedYouTubeClientForStream(streamId, baseUrl);

  if (!stream.youtube_stream_id) {
    throw new Error('YouTube live stream ID not found');
  }

  const response = await youtube.liveStreams.list({
    part: 'status',
    id: stream.youtube_stream_id
  });

  const liveStream = response.data.items?.[0];
  if (!liveStream) {
    throw new Error(`YouTube live stream ${stream.youtube_stream_id} not found`);
  }

  return summarizeIngestStatus(liveStream);
}

async function waitForYouTubeStreamActive(streamId, baseUrl = null, options = {}) {
  const timeoutMs = parsePositiveInt(
    options.timeoutMs || process.env.YOUTUBE_INGEST_TIMEOUT_MS,
    DEFAULT_YOUTUBE_INGEST_TIMEOUT_MS
  );
  const intervalMs = parsePositiveInt(
    options.intervalMs || process.env.YOUTUBE_INGEST_POLL_INTERVAL_MS,
    DEFAULT_YOUTUBE_INGEST_POLL_INTERVAL_MS
  );
  const configuredStableMs = options.stableMs ?? process.env.YOUTUBE_INGEST_STABLE_MS;
  const parsedStableMs = parseInt(configuredStableMs, 10);
  const stableMs = Number.isFinite(parsedStableMs) && parsedStableMs >= 0
    ? parsedStableMs
    : DEFAULT_YOUTUBE_INGEST_STABLE_MS;
  const startedAt = Date.now();
  let lastStatus = null;
  let lastError = null;
  let activeSince = null;

  while ((Date.now() - startedAt) <= timeoutMs) {
    try {
      lastStatus = await getYouTubeIngestStatus(streamId, baseUrl);
      lastError = null;

      if (lastStatus.streamStatus === 'active') {
        if (!activeSince) {
          activeSince = Date.now();
        }

        if (stableMs === 0 || Date.now() - activeSince >= stableMs) {
          return {
            success: true,
            stableMs,
            ...lastStatus
          };
        }
      } else {
        activeSince = null;
      }

      if (lastStatus.streamStatus === 'error') {
        const ingestError = new Error(`YouTube ingest error: ${formatIngestStatus(lastStatus)}`);
        ingestError.permanent = true;
        throw ingestError;
      }
    } catch (error) {
      lastError = error;
      if (error.permanent) {
        throw error;
      }
      const reason = getGoogleApiErrorReason(error);
      if (reason && !['backendError', 'internalError', 'rateLimitExceeded'].includes(reason)) {
        throw error;
      }
    }

    await sleep(intervalMs);
  }

  const detail = lastStatus
    ? `Status terakhir: ${formatIngestStatus(lastStatus)}.`
    : lastError
      ? `Error terakhir: ${getGoogleApiErrorMessage(lastError)}.`
      : '';

  throw new Error(`YouTube Studio masih "No Data"; YouTube belum menerima data encoder dalam ${Math.round(timeoutMs / 1000)} detik. ${detail}`.trim());
}

async function transitionYouTubeBroadcastToLive(streamId, baseUrl = null) {
  const { youtube, stream } = await getAuthorizedYouTubeClientForStream(streamId, baseUrl);

  if (!stream.youtube_broadcast_id) {
    throw new Error('YouTube broadcast ID not found');
  }

  const getBroadcastStatus = async () => {
    const response = await youtube.liveBroadcasts.list({
      part: 'status',
      id: stream.youtube_broadcast_id
    });
    const broadcast = response.data.items?.[0];
    if (!broadcast) {
      throw new Error(`YouTube broadcast ${stream.youtube_broadcast_id} not found`);
    }
    return broadcast.status?.lifeCycleStatus || 'unknown';
  };

  const currentStatus = await getBroadcastStatus();
  if (currentStatus === 'live' || currentStatus === 'liveStarting') {
    return { success: true, lifecycleStatus: currentStatus };
  }
  if (currentStatus === 'complete') {
    throw new Error('YouTube broadcast sudah complete dan tidak bisa dijalankan lagi');
  }

  try {
    const response = await youtube.liveBroadcasts.transition({
      part: 'status',
      id: stream.youtube_broadcast_id,
      broadcastStatus: 'live'
    });

    return {
      success: true,
      lifecycleStatus: response.data.status?.lifeCycleStatus || 'live'
    };
  } catch (error) {
    const reason = getGoogleApiErrorReason(error);
    if (reason === 'redundantTransition') {
      return { success: true, lifecycleStatus: 'live' };
    }

    try {
      const refreshedStatus = await getBroadcastStatus();
      if (refreshedStatus === 'live' || refreshedStatus === 'liveStarting') {
        return { success: true, lifecycleStatus: refreshedStatus };
      }
    } catch (_) {
      // Keep the original transition error below.
    }

    throw new Error(`YouTube gagal transition ke live: ${getGoogleApiErrorMessage(error)}`);
  }
}

async function stopYouTubeBroadcast(streamId, baseUrl = null) {
  try {
    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) {
      return { success: true };
    }

    const { youtube } = await getAuthorizedYouTubeClientForStream(stream, baseUrl);

    await youtube.liveBroadcasts.transition({
      part: 'id,status',
      id: stream.youtube_broadcast_id,
      broadcastStatus: 'complete'
    });

    console.log(`[YouTubeService] Transitioned broadcast ${stream.youtube_broadcast_id} to complete`);
    return { success: true };
  } catch (error) {
    console.error('[YouTubeService] Error stopping YouTube broadcast:', error.message);
    return { success: false, error: error.message };
  }
}

async function deleteYouTubeBroadcast(streamId) {
  try {
    loggedAlreadyHasBroadcast.delete(streamId);
    
    const stream = await Stream.findById(streamId);
    if (!stream || !stream.is_youtube_api || !stream.youtube_broadcast_id) {
      return { success: true, message: 'No YouTube broadcast to clean up' };
    }

    await Stream.update(streamId, {
      rtmp_url: '',
      stream_key: ''
    });

    console.log(`[YouTubeService] Cleared RTMP credentials for stream ${streamId} (broadcast ID kept for YouTube Studio access)`);

    return { success: true };
  } catch (error) {
    console.error('[YouTubeService] Error clearing YouTube broadcast data:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  createYouTubeBroadcast,
  deleteYouTubeBroadcast,
  getYouTubeIngestStatus,
  waitForYouTubeStreamActive,
  transitionYouTubeBroadcastToLive,
  stopYouTubeBroadcast,
  getYouTubeOAuth2Client,
  syncBroadcastMonetization,
  mapToYoutubeResolution,
  mapToYoutubeFPS
};
