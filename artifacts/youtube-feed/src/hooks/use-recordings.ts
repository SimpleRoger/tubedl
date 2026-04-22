import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { listRecordings, deleteRecording, requestUploadUrl, createRecording } from "@workspace/api-client-react";
import type { CreateRecordingBody } from "@workspace/api-client-react";

export function useRecordings() {
  return useQuery({
    queryKey: ["recordings"],
    queryFn: () => listRecordings(),
    staleTime: 0,
  });
}

export function useDeleteRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteRecording({ id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recordings"] }),
  });
}

interface UploadRecordingArgs {
  blob: Blob;
  mime: string;
  meta: CreateRecordingBody;
  takeNumber?: number;
}

export function useUploadRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ blob, mime, meta, takeNumber = 1 }: UploadRecordingArgs) => {
      // Step 1: get presigned upload URL
      const { uploadURL, objectPath } = await requestUploadUrl({
        name: `${meta.beatTitle}-take-${takeNumber}`,
        size: blob.size,
        contentType: mime,
      });

      // Step 2: upload blob directly to GCS
      const putRes = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": mime },
        body: blob,
      });
      if (!putRes.ok) throw new Error("Upload to cloud failed");

      // Step 3: save metadata record
      return createRecording({ ...meta, objectPath });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["recordings"] }),
  });
}
