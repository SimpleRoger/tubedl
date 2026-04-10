import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import React, { useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { EmptyState } from "@/components/EmptyState";
import { useColors } from "@/hooks/useColors";
import {
  getListSavedVideosQueryKey,
  useListSavedVideos,
  useSaveVideo,
  useRemoveSavedVideo,
  type SavedVideoItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import type { Video } from "@workspace/api-client-react";

function parseDuration(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return "";
  const h = parseInt(m[1] ?? "0");
  const min = parseInt(m[2] ?? "0");
  const s = parseInt(m[3] ?? "0");
  if (h > 0) return `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${min}:${String(s).padStart(2, "0")}`;
}

function savedToVideo(s: SavedVideoItem): Video {
  return {
    videoId: s.videoId,
    title: s.title,
    description: s.description,
    thumbnailUrl: s.thumbnailUrl,
    publishedAt: s.publishedAt,
    viewCount: s.viewCount,
    channelId: s.channelId,
    channelName: s.channelName,
    channelThumbnailUrl: s.channelThumbnailUrl,
    duration: s.duration,
  };
}

interface AddVideoModalProps {
  visible: boolean;
  onClose: () => void;
}

function AddVideoModal({ visible, onClose }: AddVideoModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const saveVideo = useSaveVideo({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedVideosQueryKey() });
        setUrl("");
        setError(null);
        onClose();
      },
      onError: (err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : typeof err === "object" && err !== null && "error" in err
            ? String((err as { error: unknown }).error)
            : "Failed to save video";
        setError(msg);
      },
    },
  });

  const handleSave = () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please paste a YouTube URL");
      return;
    }
    setError(null);
    saveVideo.mutate({ url: trimmed });
  };

  const handleClose = () => {
    setUrl("");
    setError(null);
    onClose();
  };

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={handleClose} />
      <View style={[styles.modalSheet, { backgroundColor: colors.card, paddingBottom: insets.bottom + 20 }]}>
        <View style={styles.modalHandle} />
        <Text style={[styles.modalTitle, { color: colors.foreground }]}>Save a Video</Text>
        <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
          Paste any YouTube link to add it to your saved collection
        </Text>
        <TextInput
          style={[styles.urlInput, { backgroundColor: colors.muted, color: colors.foreground, borderColor: error ? "#EE4343" : colors.border }]}
          placeholder="https://youtube.com/watch?v=..."
          placeholderTextColor={colors.mutedForeground}
          value={url}
          onChangeText={(t) => { setUrl(t); setError(null); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="done"
          onSubmitEditing={handleSave}
          multiline={false}
        />
        {error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : null}
        <TouchableOpacity
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saveVideo.isPending ? 0.7 : 1 }]}
          onPress={handleSave}
          disabled={saveVideo.isPending}
        >
          {saveVideo.isPending ? (
            <Feather name="loader" size={16} color="#fff" />
          ) : (
            <Feather name="bookmark" size={16} color="#fff" />
          )}
          <Text style={styles.saveBtnText}>
            {saveVideo.isPending ? "Saving…" : "Save Video"}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

interface SavedCardProps {
  item: SavedVideoItem;
  onPress: (v: Video) => void;
  onDelete: (videoId: string) => void;
}

function SavedCard({ item, onPress, onDelete }: SavedCardProps) {
  const colors = useColors();
  const duration = parseDuration(item.duration);

  const confirmDelete = () => {
    if (Platform.OS === "web") {
      onDelete(item.videoId);
      return;
    }
    Alert.alert("Remove saved video?", item.title, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => onDelete(item.videoId) },
    ]);
  };

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => onPress(savedToVideo(item))}
      activeOpacity={0.85}
    >
      <View style={styles.thumbnailWrap}>
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={styles.thumbnail}
          contentFit="cover"
        />
        {duration ? (
          <View style={styles.durationBadge}>
            <Text style={styles.durationText}>{duration}</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.cardInfo}>
        <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={[styles.cardChannel, { color: colors.mutedForeground }]} numberOfLines={1}>
          {item.channelName}
        </Text>
      </View>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={confirmDelete}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      >
        <Feather name="trash-2" size={16} color={colors.mutedForeground} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function SavedScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [addVisible, setAddVisible] = useState(false);
  const [playerVideo, setPlayerVideo] = useState<Video | null>(null);

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data: saved = [], isLoading } = useListSavedVideos();

  const remove = useRemoveSavedVideo({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSavedVideosQueryKey() });
      },
    },
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: topPad, backgroundColor: colors.background }]}>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Saved</Text>
        <TouchableOpacity
          style={[styles.addBtn, { backgroundColor: colors.primary }]}
          onPress={() => setAddVisible(true)}
        >
          <Feather name="plus" size={18} color="#fff" />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <Feather name="loader" size={24} color={colors.mutedForeground} />
        </View>
      ) : saved.length === 0 ? (
        <EmptyState
          icon="bookmark"
          title="No saved videos"
          subtitle="Tap + and paste any YouTube link to save it here"
          actionLabel="Save a Video"
          onAction={() => setAddVisible(true)}
        />
      ) : (
        <FlatList
          data={saved}
          keyExtractor={(v) => v.videoId}
          renderItem={({ item }) => (
            <SavedCard
              item={item}
              onPress={setPlayerVideo}
              onDelete={(videoId) => remove.mutate({ videoId })}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: 8,
            paddingBottom: (Platform.OS === "web" ? 34 : insets.bottom) + 90,
          }}
        />
      )}

      <AddVideoModal visible={addVisible} onClose={() => setAddVisible(false)} />
      <VideoPlayerModal video={playerVideo} onClose={() => setPlayerVideo(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerTitle: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  addBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 10,
    overflow: "hidden",
    gap: 10,
    paddingRight: 10,
  },
  thumbnailWrap: {
    width: 120,
    height: 68,
    position: "relative",
    flexShrink: 0,
  },
  thumbnail: {
    width: "100%",
    height: "100%",
  },
  durationBadge: {
    position: "absolute",
    bottom: 4,
    right: 4,
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  durationText: {
    color: "#fff",
    fontSize: 10,
    fontFamily: "Inter_500Medium",
  },
  cardInfo: {
    flex: 1,
    gap: 3,
  },
  cardTitle: {
    fontSize: 13,
    fontFamily: "Inter_500Medium",
    lineHeight: 18,
  },
  cardChannel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  deleteBtn: {
    padding: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  modalSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  modalHandle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#555",
    alignSelf: "center",
    marginBottom: 4,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
  },
  modalSubtitle: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  urlInput: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
  },
  errorText: {
    color: "#EE4343",
    fontSize: 12,
    fontFamily: "Inter_400Regular",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
  },
});
