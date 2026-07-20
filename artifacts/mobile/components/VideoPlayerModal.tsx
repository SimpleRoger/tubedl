import { Feather } from "@expo/vector-icons";
import React from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColors } from "@/hooks/useColors";
import type { Video } from "@workspace/api-client-react";

interface VideoPlayerModalProps {
  video: Video | null;
  onClose: () => void;
  isSaved?: boolean;
  onToggleSave?: (video: Video) => void;
}

function YoutubeEmbed({ videoId }: { videoId: string }) {
  const embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&playsinline=1&rel=0`;

  if (Platform.OS === "web") {
    return React.createElement("iframe", {
      src: embedUrl,
      style: { width: "100%", height: "100%", border: "none" },
      allow:
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
      allowFullScreen: true,
    });
  }

  const WebView = require("react-native-webview").default;
  const html = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0"><style>*{margin:0;padding:0;box-sizing:border-box}body{background:#000;width:100%;height:100%}iframe{width:100%;height:100%;border:none}</style></head><body><iframe src="${embedUrl}" allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" allowfullscreen></iframe></body></html>`;

  return (
    <WebView
      source={{ html }}
      style={{ flex: 1, backgroundColor: "#000" }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo
      javaScriptEnabled
      domStorageEnabled
      scrollEnabled={false}
      bounces={false}
    />
  );
}

export function VideoPlayerModal({ video, onClose, isSaved, onToggleSave }: VideoPlayerModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();

  if (!video) return null;

  const topPad = Platform.OS === "web" ? 24 : insets.top;

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View
          style={[
            styles.header,
            {
              paddingTop: topPad + 10,
              backgroundColor: colors.card,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeBtn}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Feather name="chevron-down" size={24} color={colors.foreground} />
          </TouchableOpacity>
          <View style={styles.headerInfo}>
            <Text
              style={[styles.headerChannel, { color: colors.mutedForeground }]}
              numberOfLines={1}
            >
              {video.channelName}
            </Text>
            <Text
              style={[styles.headerTitle, { color: colors.foreground }]}
              numberOfLines={1}
            >
              {video.title}
            </Text>
          </View>
          {onToggleSave ? (
            <TouchableOpacity
              onPress={() => onToggleSave(video)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Feather
                name="bookmark"
                size={22}
                color={isSaved ? colors.primary : colors.foreground}
              />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.playerContainer}>
          <YoutubeEmbed videoId={video.videoId} />
        </View>

        <View
          style={[
            styles.detailsContainer,
            { borderTopColor: colors.border },
          ]}
        >
          <Text
            style={[styles.detailsTitle, { color: colors.foreground }]}
            numberOfLines={3}
          >
            {video.title}
          </Text>
          <Text style={[styles.detailsChannel, { color: colors.mutedForeground }]}>
            {video.channelName}
          </Text>
          {video.description ? (
            <Text
              style={[styles.detailsDesc, { color: colors.mutedForeground }]}
              numberOfLines={4}
            >
              {video.description}
            </Text>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  closeBtn: { padding: 4 },
  headerInfo: { flex: 1 },
  headerChannel: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
  headerTitle: {
    fontSize: 14,
    fontFamily: "Inter_500Medium",
  },
  playerContainer: {
    width: "100%",
    aspectRatio: 16 / 9,
    backgroundColor: "#000",
  },
  detailsContainer: {
    flex: 1,
    padding: 16,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  detailsTitle: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    lineHeight: 22,
  },
  detailsChannel: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
  },
  detailsDesc: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 20,
    marginTop: 4,
  },
});
