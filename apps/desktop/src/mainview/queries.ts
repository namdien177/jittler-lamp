import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  api,
  type ApiAccountProfile,
  type ApiEvidenceSummary,
  type ApiShareLinkSummary,
  type CreatedShareLink,
  type FetchToken
} from "./api";
import { useDesktopAuth } from "./auth-context";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1
      }
    }
  });
}

export const queryKeys = {
  accountProfile: () => ["account-profile"] as const,
  evidences: () => ["evidences"] as const,
  shareLinks: (evidenceId: string) => ["share-links", evidenceId] as const
};

function useSignedInToken(): { enabled: boolean; getToken: FetchToken } {
  const auth = useDesktopAuth();
  return {
    enabled: auth.state.status === "signed-in",
    getToken: auth.getToken
  };
}

export function useAccountProfile() {
  const auth = useDesktopAuth();
  const { enabled, getToken } = useSignedInToken();
  const initialData = auth.state.status === "signed-in" ? auth.state.profile : undefined;
  return useQuery<ApiAccountProfile>({
    queryKey: queryKeys.accountProfile(),
    queryFn: () => api.fetchAccountProfile(getToken),
    enabled,
    ...(initialData ? { initialData } : {})
  });
}

export function useEvidences() {
  const { enabled, getToken } = useSignedInToken();
  return useQuery<{ evidences: ApiEvidenceSummary[]; orgId: string }>({
    queryKey: queryKeys.evidences(),
    queryFn: () => api.listEvidences(getToken),
    enabled
  });
}

export function useShareLinks(evidenceId: string | null) {
  const { enabled, getToken } = useSignedInToken();
  return useQuery<{ shareLinks: ApiShareLinkSummary[] }>({
    queryKey: queryKeys.shareLinks(evidenceId ?? "none"),
    queryFn: () => api.listShareLinks(getToken, evidenceId ?? ""),
    enabled: enabled && Boolean(evidenceId)
  });
}

export function useCreateShareLink() {
  const { getToken } = useSignedInToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { evidenceId: string; expiresInMs?: number }) =>
      api.createShareLink(getToken, input.evidenceId, input.expiresInMs),
    onSuccess: (_data: { shareLink: CreatedShareLink }, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shareLinks(input.evidenceId) });
    }
  });
}

export function useRevokeShareLink() {
  const { getToken } = useSignedInToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { shareLinkId: string; evidenceId: string }) =>
      api.revokeShareLink(getToken, input.shareLinkId),
    onSuccess: (_data, input) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.shareLinks(input.evidenceId) });
    }
  });
}
