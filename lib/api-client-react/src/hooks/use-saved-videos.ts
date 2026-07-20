import { useQueryClient } from "@tanstack/react-query";
import {
  useListSavedVideos,
  useSaveVideo,
  useRemoveSavedVideo,
  getListSavedVideosQueryKey,
} from "../generated/api";
import type { Video } from "../generated/api.schemas";

/**
 * Tracks which videos are saved and exposes a single toggleSave(video) call
 * that saves or removes depending on current state. Shared between the web
 * and mobile frontends since both consume the same generated query hooks.
 */
export function useSavedVideos() {
  const queryClient = useQueryClient();
  const savedQuery = useListSavedVideos();

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListSavedVideosQueryKey() });

  const saveMutation = useSaveVideo({ mutation: { onSuccess: invalidate } });
  const removeMutation = useRemoveSavedVideo({ mutation: { onSuccess: invalidate } });

  const savedIds = new Set((savedQuery.data ?? []).map((v) => v.videoId));

  function toggleSave(video: Video) {
    if (savedIds.has(video.videoId)) {
      removeMutation.mutate({ videoId: video.videoId });
    } else {
      saveMutation.mutate({
        data: { url: `https://www.youtube.com/watch?v=${video.videoId}` },
      });
    }
  }

  return { savedQuery, savedIds, toggleSave };
}
