import { Feather } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import { VideoCard } from "@/components/VideoCard";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { useSavedVideos } from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";

export default function SavedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [playerVideo, setPlayerVideo] = useState<Video | null>(null);
  const { savedQuery, savedIds, toggleSave } = useSavedVideos();
  const videos = savedQuery.data ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={[styles.title, { color: colors.foreground }]}>Saved</Text>
      </View>

      {savedQuery.isLoading && (
        <View style={styles.empty}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}

      {savedQuery.isError && (
        <View style={styles.empty}>
          <Feather name="alert-circle" size={32} color={colors.destructive ?? "#ef4444"} />
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground, marginTop: 12 }]}>
            Failed to load saved videos.
          </Text>
        </View>
      )}

      {!savedQuery.isLoading && !savedQuery.isError && videos.length === 0 && (
        <View style={styles.empty}>
          <Feather name="bookmark" size={40} color={colors.mutedForeground} style={styles.icon} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No saved videos yet</Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
            Tap the bookmark icon on any video to save it here.
          </Text>
        </View>
      )}

      {!savedQuery.isLoading && videos.length > 0 && (
        <FlatList
          data={videos}
          keyExtractor={(v) => v.videoId}
          renderItem={({ item }) => (
            <VideoCard
              video={item}
              onPress={setPlayerVideo}
              isSaved={savedIds.has(item.videoId)}
              onToggleSave={toggleSave}
              mp3Ready={item.mp3Ready}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 12, paddingBottom: insets.bottom + 90 }}
        />
      )}

      <VideoPlayerModal
        video={playerVideo}
        onClose={() => setPlayerVideo(null)}
        isSaved={playerVideo ? savedIds.has(playerVideo.videoId) : false}
        onToggleSave={toggleSave}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  title: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.3,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  icon: { marginBottom: 16 },
  emptyTitle: {
    fontSize: 18,
    fontFamily: "Inter_600SemiBold",
    marginBottom: 8,
    textAlign: "center",
  },
  emptySubtitle: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 22,
  },
});
