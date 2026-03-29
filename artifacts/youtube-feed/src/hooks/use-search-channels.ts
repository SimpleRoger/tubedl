import { useSearchChannels as useGenSearchChannels } from "@workspace/api-client-react";

export function useSearchChannels(query: string) {
  return useGenSearchChannels(
    { q: query },
    {
      query: {
        enabled: query.trim().length > 0,
        staleTime: 30_000,
      },
    }
  );
}
