import { useListVideos as useGenListVideos } from "@workspace/api-client-react";

export function useVideos(channelId?: number) {
  // If channelId is provided, pass it as a parameter, otherwise fetch all
  return useGenListVideos(
    channelId ? { channelId } : undefined,
    {
      query: {
        // Videos rarely change minute-by-minute, give it a reasonable stale time
        staleTime: 1000 * 60 * 5, 
        retry: 1,
      }
    }
  );
}
