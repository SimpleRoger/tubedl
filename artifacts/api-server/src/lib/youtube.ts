import { logger } from "./logger";

const YOUTUBE_API_BASE = "https://www.googleapis.com/youtube/v3";

function getApiKey(): string {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("YOUTUBE_API_KEY environment variable is not set");
  }
  return key;
}

export interface YouTubeChannelInfo {
  id: string;
  name: string;
  thumbnailUrl: string | null;
}

export interface YouTubeVideo {
  videoId: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  publishedAt: Date;
  viewCount: string | null;
  channelId: string;
  channelName: string;
  channelThumbnailUrl: string | null;
  duration: string | null;
}

export async function resolveChannelInfo(
  channelIdOrHandle: string
): Promise<YouTubeChannelInfo> {
  const apiKey = getApiKey();

  let url: string;

  if (channelIdOrHandle.startsWith("UC")) {
    url = `${YOUTUBE_API_BASE}/channels?part=snippet&id=${encodeURIComponent(channelIdOrHandle)}&key=${apiKey}`;
  } else {
    const handle = channelIdOrHandle.startsWith("@")
      ? channelIdOrHandle.slice(1)
      : channelIdOrHandle;
    url = `${YOUTUBE_API_BASE}/channels?part=snippet&forHandle=${encodeURIComponent(handle)}&key=${apiKey}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    logger.error({ status: response.status, body }, "YouTube API error fetching channel");
    throw new Error(`YouTube API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        thumbnails?: { default?: { url: string } };
      };
    }>;
  };

  if (!data.items || data.items.length === 0) {
    throw new Error(`Channel not found: ${channelIdOrHandle}`);
  }

  const item = data.items[0];
  return {
    id: item.id,
    name: item.snippet.title,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
  };
}

export interface YouTubeChannelSearchResult {
  youtubeChannelId: string;
  name: string;
  description: string;
  thumbnailUrl: string | null;
  subscriberCount: string | null;
}

export async function searchChannels(query: string): Promise<YouTubeChannelSearchResult[]> {
  const apiKey = getApiKey();

  const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&type=channel&q=${encodeURIComponent(query)}&maxResults=8&key=${apiKey}`;
  const searchResp = await fetch(searchUrl);

  if (!searchResp.ok) {
    const body = await searchResp.text();
    logger.error({ status: searchResp.status, body }, "YouTube channel search API error");
    throw new Error(`YouTube API error: ${searchResp.status}`);
  }

  const searchData = (await searchResp.json()) as {
    items?: Array<{
      id: { channelId: string };
      snippet: {
        title: string;
        description: string;
        thumbnails?: { default?: { url: string } };
      };
    }>;
  };

  if (!searchData.items || searchData.items.length === 0) {
    return [];
  }

  // Fetch subscriber counts for the found channels
  const channelIds = searchData.items.map((i) => i.id.channelId).join(",");
  const statsUrl = `${YOUTUBE_API_BASE}/channels?part=statistics&id=${encodeURIComponent(channelIds)}&key=${apiKey}`;
  const statsResp = await fetch(statsUrl);

  const subsMap = new Map<string, string>();
  if (statsResp.ok) {
    const statsData = (await statsResp.json()) as {
      items?: Array<{ id: string; statistics?: { subscriberCount?: string } }>;
    };
    for (const item of statsData.items ?? []) {
      if (item.statistics?.subscriberCount) {
        subsMap.set(item.id, item.statistics.subscriberCount);
      }
    }
  }

  return searchData.items.map((item) => ({
    youtubeChannelId: item.id.channelId,
    name: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl: item.snippet.thumbnails?.default?.url ?? null,
    subscriberCount: subsMap.get(item.id.channelId) ?? null,
  }));
}

export async function fetchVideoById(videoId: string): Promise<YouTubeVideo | null> {
  const apiKey = getApiKey();

  const url = `${YOUTUBE_API_BASE}/videos?part=snippet,statistics,contentDetails&id=${encodeURIComponent(videoId)}&key=${apiKey}`;
  const resp = await fetch(url);
  if (!resp.ok) {
    const body = await resp.text();
    logger.error({ status: resp.status, body, videoId }, "YouTube fetchVideoById error");
    throw new Error(`YouTube API error: ${resp.status}`);
  }

  const data = (await resp.json()) as {
    items?: Array<{
      id: string;
      snippet: {
        title: string;
        description: string;
        publishedAt: string;
        channelId: string;
        channelTitle: string;
        thumbnails?: { medium?: { url: string }; default?: { url: string } };
      };
      statistics?: { viewCount?: string };
      contentDetails?: { duration?: string };
    }>;
  };

  if (!data.items || data.items.length === 0) return null;

  const item = data.items[0];
  const thumbnail =
    item.snippet.thumbnails?.medium?.url ??
    item.snippet.thumbnails?.default?.url ??
    `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

  return {
    videoId: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl: thumbnail,
    publishedAt: new Date(item.snippet.publishedAt),
    viewCount: item.statistics?.viewCount ?? null,
    channelId: item.snippet.channelId,
    channelName: item.snippet.channelTitle,
    channelThumbnailUrl: null,
    duration: item.contentDetails?.duration ?? null,
  };
}

export async function fetchPopularVideos(
  channelId: string,
  channelName: string,
  channelThumbnailUrl: string | null
): Promise<YouTubeVideo[]> {
  const apiKey = getApiKey();

  const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=viewCount&maxResults=25&key=${apiKey}`;

  const searchResp = await fetch(searchUrl);
  if (!searchResp.ok) {
    const body = await searchResp.text();
    logger.error({ status: searchResp.status, body, channelId }, "YouTube popular videos API error");
    throw new Error(`YouTube API error: ${searchResp.status}`);
  }

  const searchData = (await searchResp.json()) as {
    items?: Array<{
      id: { videoId: string };
      snippet: {
        title: string;
        description: string;
        publishedAt: string;
        thumbnails?: {
          medium?: { url: string };
          default?: { url: string };
        };
      };
    }>;
  };

  if (!searchData.items || searchData.items.length === 0) {
    return [];
  }

  const videoIds = searchData.items.map((i) => i.id.videoId).join(",");

  const videosUrl = `${YOUTUBE_API_BASE}/videos?part=statistics,contentDetails&id=${encodeURIComponent(videoIds)}&key=${apiKey}`;
  const videosResp = await fetch(videosUrl);

  let statsMap: Map<string, { viewCount?: string; duration?: string }> = new Map();

  if (videosResp.ok) {
    const videosData = (await videosResp.json()) as {
      items?: Array<{
        id: string;
        statistics?: { viewCount?: string };
        contentDetails?: { duration?: string };
      }>;
    };
    for (const item of videosData.items ?? []) {
      statsMap.set(item.id, {
        viewCount: item.statistics?.viewCount,
        duration: item.contentDetails?.duration,
      });
    }
  }

  return searchData.items.map((item) => {
    const videoId = item.id.videoId;
    const stats = statsMap.get(videoId) ?? {};
    const thumbnail =
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    return {
      videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: thumbnail,
      publishedAt: new Date(item.snippet.publishedAt),
      viewCount: stats.viewCount ?? null,
      channelId,
      channelName,
      channelThumbnailUrl,
      duration: stats.duration ?? null,
    };
  });
}

export async function fetchRecentVideos(
  channelId: string,
  channelName: string,
  channelThumbnailUrl: string | null
): Promise<YouTubeVideo[]> {
  const apiKey = getApiKey();

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const publishedAfter = threeMonthsAgo.toISOString();

  const searchUrl = `${YOUTUBE_API_BASE}/search?part=snippet&channelId=${encodeURIComponent(channelId)}&type=video&order=date&publishedAfter=${encodeURIComponent(publishedAfter)}&maxResults=25&key=${apiKey}`;

  const searchResp = await fetch(searchUrl);
  if (!searchResp.ok) {
    const body = await searchResp.text();
    logger.error({ status: searchResp.status, body, channelId }, "YouTube search API error");
    throw new Error(`YouTube API error: ${searchResp.status}`);
  }

  const searchData = (await searchResp.json()) as {
    items?: Array<{
      id: { videoId: string };
      snippet: {
        title: string;
        description: string;
        publishedAt: string;
        thumbnails?: {
          medium?: { url: string };
          default?: { url: string };
        };
      };
    }>;
  };

  if (!searchData.items || searchData.items.length === 0) {
    return [];
  }

  const videoIds = searchData.items.map((i) => i.id.videoId).join(",");

  const videosUrl = `${YOUTUBE_API_BASE}/videos?part=statistics,contentDetails&id=${encodeURIComponent(videoIds)}&key=${apiKey}`;
  const videosResp = await fetch(videosUrl);

  let statsMap: Map<string, { viewCount?: string; duration?: string }> = new Map();

  if (videosResp.ok) {
    const videosData = (await videosResp.json()) as {
      items?: Array<{
        id: string;
        statistics?: { viewCount?: string };
        contentDetails?: { duration?: string };
      }>;
    };
    for (const item of videosData.items ?? []) {
      statsMap.set(item.id, {
        viewCount: item.statistics?.viewCount,
        duration: item.contentDetails?.duration,
      });
    }
  }

  return searchData.items.map((item) => {
    const videoId = item.id.videoId;
    const stats = statsMap.get(videoId) ?? {};
    const thumbnail =
      item.snippet.thumbnails?.medium?.url ??
      item.snippet.thumbnails?.default?.url ??
      `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;

    return {
      videoId,
      title: item.snippet.title,
      description: item.snippet.description,
      thumbnailUrl: thumbnail,
      publishedAt: new Date(item.snippet.publishedAt),
      viewCount: stats.viewCount ?? null,
      channelId,
      channelName,
      channelThumbnailUrl,
      duration: stats.duration ?? null,
    };
  });
}
