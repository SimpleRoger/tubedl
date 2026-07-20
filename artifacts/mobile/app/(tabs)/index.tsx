import { Feather } from "@expo/vector-icons";
import React, { useState, useRef, useCallback } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { VideoCard } from "@/components/VideoCard";
import { VideoPlayerModal } from "@/components/VideoPlayerModal";
import { useSavedVideos } from "@workspace/api-client-react";
import type { Video } from "@workspace/api-client-react";
import { useColors } from "@/hooks/useColors";

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "";

async function searchVideos(q: string): Promise<Video[]> {
  const resp = await fetch(`${BASE_URL}/api/videos/search?q=${encodeURIComponent(q)}&maxResults=20`);
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error((data as any).error ?? `Search failed (${resp.status})`);
  }
  return resp.json();
}

export default function SearchScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Video[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [playerVideo, setPlayerVideo] = useState<Video | null>(null);
  const inputRef = useRef<TextInput>(null);
  const { savedIds, toggleSave } = useSavedVideos();

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setIsSearching(true);
    setSearchError(null);
    setHasSearched(true);
    setResults([]);
    try {
      const data = await searchVideos(q);
      setResults(data);
    } catch (err: any) {
      setSearchError(err.message ?? "Search failed");
    } finally {
      setIsSearching(false);
    }
  }, [query]);

  const topPad = Platform.OS === "web" ? 16 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad, backgroundColor: colors.background }]}>
        <Text style={[styles.logo, { color: colors.foreground }]}>
          Tube<Text style={{ color: colors.primary }}>DL</Text>
        </Text>
      </View>

      {/* Search bar */}
      <View style={[styles.searchRow, { borderBottomColor: colors.border }]}>
        <View style={[styles.searchBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Feather name="search" size={16} color={colors.mutedForeground} style={styles.searchIcon} />
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
            placeholder="Search YouTube videos…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCorrect={false}
            autoCapitalize="none"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => { setQuery(""); setResults([]); setHasSearched(false); }}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>
        <TouchableOpacity
          style={[styles.searchBtn, { backgroundColor: colors.primary, opacity: !query.trim() || isSearching ? 0.5 : 1 }]}
          onPress={handleSearch}
          disabled={!query.trim() || isSearching}
        >
          <Text style={styles.searchBtnText}>Search</Text>
        </TouchableOpacity>
      </View>

      {/* States */}
      {isSearching && (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      )}

      {!isSearching && searchError && (
        <View style={styles.centered}>
          <Feather name="alert-circle" size={32} color={colors.destructive ?? "#ef4444"} />
          <Text style={[styles.errorText, { color: colors.mutedForeground }]}>{searchError}</Text>
        </View>
      )}

      {!isSearching && !hasSearched && (
        <View style={styles.centered}>
          <Feather name="search" size={40} color={colors.mutedForeground} style={{ marginBottom: 16 }} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Search for videos</Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
            Find any YouTube video, then download it as MP4 or MP3.
          </Text>
        </View>
      )}

      {!isSearching && hasSearched && results.length === 0 && !searchError && (
        <View style={styles.centered}>
          <Feather name="video-off" size={32} color={colors.mutedForeground} style={{ marginBottom: 12 }} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No results</Text>
          <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>Try a different search term.</Text>
        </View>
      )}

      {!isSearching && results.length > 0 && (
        <FlatList
          data={results}
          keyExtractor={(v) => v.videoId}
          renderItem={({ item }) => (
            <VideoCard
              video={item}
              onPress={setPlayerVideo}
              isSaved={savedIds.has(item.videoId)}
              onToggleSave={toggleSave}
            />
          )}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingTop: 12,
            paddingBottom: bottomPad + 90,
          }}
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
    paddingBottom: 12,
  },
  logo: {
    fontSize: 22,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchBox: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    height: 40,
    gap: 6,
  },
  searchIcon: { flexShrink: 0 },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    height: 40,
  },
  searchBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  searchBtnText: {
    color: "#fff",
    fontSize: 14,
    fontFamily: "Inter_600SemiBold",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
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
  errorText: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    marginTop: 10,
    lineHeight: 22,
  },
});
