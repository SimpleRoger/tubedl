import { useQueryClient } from "@tanstack/react-query";
import { 
  useListChannels as useGenListChannels, 
  useAddChannel as useGenAddChannel, 
  useRemoveChannel as useGenRemoveChannel,
  getListChannelsQueryKey,
  getListVideosQueryKey
} from "@workspace/api-client-react";

export function useChannels() {
  return useGenListChannels();
}

export function useAddChannel() {
  const queryClient = useQueryClient();
  
  return useGenAddChannel({
    mutation: {
      onSuccess: () => {
        // Invalidate channels list to show new channel
        queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
        // Invalidate videos feed to fetch videos from the newly added channel
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
      }
    }
  });
}

export function useRemoveChannel() {
  const queryClient = useQueryClient();
  
  return useGenRemoveChannel({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListChannelsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListVideosQueryKey() });
      }
    }
  });
}
