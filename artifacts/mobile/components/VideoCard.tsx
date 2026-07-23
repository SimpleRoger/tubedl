import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useColors } from "@/hooks/useColors";
import type { Video } from "@workspace/api-client-react";

function parseDuration(duration?: string | null): string {
  if (!duration) return "";
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return "";
  const h = parseInt(match[1] || "0");
  const m = parseInt(match[2] || "0");
  const s = parseInt(match[3] || "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function timeAgo(dateStr: string): string {
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const d = Math.floor(diffMs / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  if (d < 365) return `${Math.floor(d / 30)}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function formatViews(views?: string | null): string {
  if (!views) return "";
  const n = parseInt(views);
  if (isNaN(n)) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M views`;
  if (n >= 1_000) return `${Math.floor(n / 1_000)}K views`;
  return `${n} views`;
}

interface VideoCardProps {
  video: Video;
  onPress?: (video: Video) => void;
  isSaved?: boolean;
  onToggleSave?: (video: Video) => void;
  mp3Ready?: boolean;
}

export function VideoCard({ video, onPress, isSaved, onToggleSave, mp3Ready }: VideoCardProps) {
  const colors = useColors();
  const duration = parseDuration(video.duration);
  const views = formatViews(video.viewCount);
  const ago = timeAgo(video.publishedAt);

  const handlePress = () => {
    onPress?.(video);
  };

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={handlePress}
      activeOpacity={0.85}
    >
      <View style={styles.thumbnailContainer}>
        <Image
          source={{ uri: video.thumbnailUrl }}
          style={styles.thumbnail}
          contentFit="cover"
          transition={200}
        />
        {duration ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{duration}</Text>
          </View>
        ) : null}
        {mp3Ready !== undefined ? (
          <View
            style={[
              styles.mp3Badge,
              { backgroundColor: mp3Ready ? colors.primary : "rgba(0,0,0,0.7)" },
            ]}
          >
            <Feather name="music" size={11} color="#fff" />
            <Text style={styles.mp3BadgeText}>{mp3Ready ? "MP3 ready" : "Not extracted"}</Text>
          </View>
        ) : null}
        {onToggleSave ? (
          <TouchableOpacity
            onPress={() => onToggleSave(video)}
            style={[
              styles.saveBadge,
              { backgroundColor: isSaved ? colors.primary : "rgba(0,0,0,0.6)" },
            ]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="bookmark" size={14} color="#fff" />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.info}>
        <View style={styles.channelRow}>
          {video.channelThumbnailUrl ? (
            <Image
              source={{ uri: video.channelThumbnailUrl }}
              style={styles.avatar}
              contentFit="cover"
            />
          ) : (
            <View style={[styles.avatar, { backgroundColor: colors.muted, alignItems: "center", justifyContent: "center" }]}>
              <Feather name="user" size={12} color={colors.mutedForeground} />
            </View>
          )}
          <Text style={[styles.channelName, { color: colors.mutedForeground }]} numberOfLines={1}>
            {video.channelName}
          </Text>
        </View>
        <Text style={[styles.title, { color: colors.foreground }]} numberOfLines={2}>
          {video.title}
        </Text>
        <Text style={[styles.meta, { color: colors.mutedForeground }]}>
          {[views, ago].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 10,
    overflow: "hidden",
    marginHorizontal: 12,
    marginBottom: 12,
  },
  thumbnailContainer: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 9,
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  durationBadge: {
    position: "absolute",
    bottom: 6,
    right: 6,
    backgroundColor: "rgba(0,0,0,0.85)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 4,
  },
  durationText: {
    color: "#fff",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  mp3Badge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 4,
  },
  mp3BadgeText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_600SemiBold",
  },
  saveBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    padding: 10,
    gap: 4,
  },
  channelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  avatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  channelName: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
    flex: 1,
  },
  title: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
    lineHeight: 20,
  },
  meta: {
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
});
