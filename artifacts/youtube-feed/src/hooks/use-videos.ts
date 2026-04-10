import { useListVideos as useGenListVideos } from "@workspace/api-client-react";

export function useVideos(channelId?: number, order: "recent" | "popular" = "recent") {
  return useGenListVideos(
    { ...(channelId ? { channelId } : {}), order },
    {
      query: {
        staleTime: 1000 * 60 * 5,
        retry: 1,
      }
    }
  );
}
