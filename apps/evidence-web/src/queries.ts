import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@clerk/clerk-react";

import {
  api,
  type ApiAccountProfile,
  type ApiEvidenceSummary,
  type ApiOrganization,
  type ArtifactReadUrl,
  type EvidenceArtifact,
  type FetchToken
} from "./api";
import { loadRemoteSessionArtifacts, type LoadedSession } from "./loader";

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
  evidenceArtifacts: (evidenceId: string, orgId: string | undefined) =>
    ["evidence-artifacts", evidenceId, orgId ?? null] as const,
  remoteEvidence: (key: { shareToken?: string; remoteEvidenceId?: string }) =>
    ["remote-evidence", key.shareToken ?? null, key.remoteEvidenceId ?? null] as const
};

function useAuthToken(): FetchToken {
  const auth = useAuth();
  return () => auth.getToken();
}

export function useAccountProfile() {
  const auth = useAuth();
  const getToken = useAuthToken();
  return useQuery<ApiAccountProfile>({
    queryKey: queryKeys.accountProfile(),
    queryFn: () => api.fetchAccountProfile(getToken),
    enabled: auth.isLoaded && Boolean(auth.isSignedIn)
  });
}

export function useEvidences() {
  const auth = useAuth();
  const getToken = useAuthToken();
  return useQuery<{ evidences: ApiEvidenceSummary[]; orgId: string }>({
    queryKey: queryKeys.evidences(),
    queryFn: () => api.listEvidences(getToken),
    enabled: auth.isLoaded && Boolean(auth.isSignedIn)
  });
}

export function useDeleteEvidence() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (evidenceId: string) => api.deleteEvidence(getToken, evidenceId),
    onSuccess: (_data, evidenceId) => {
      queryClient.setQueryData<{ evidences: ApiEvidenceSummary[]; orgId: string } | undefined>(
        queryKeys.evidences(),
        (previous) =>
          previous
            ? { ...previous, evidences: previous.evidences.filter((evidence) => evidence.id !== evidenceId) }
            : previous
      );
      queryClient.removeQueries({ queryKey: queryKeys.remoteEvidence({ remoteEvidenceId: evidenceId }) });
    }
  });
}

export function useSelectActiveOrganization() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => api.selectActiveOrganization(getToken, orgId),
    onSuccess: (_data, orgId) => {
      queryClient.setQueryData<ApiAccountProfile | undefined>(queryKeys.accountProfile(), (prev) =>
        prev
          ? { ...prev, organizations: prev.organizations.map((org) => ({ ...org, isActive: org.id === orgId })) }
          : prev
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.evidences() });
    }
  });
}

export function useAcceptInvitation() {
  const getToken = useAuthToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => api.acceptInvitation(getToken, token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.accountProfile() });
      queryClient.invalidateQueries({ queryKey: queryKeys.evidences() });
    }
  });
}

export type RemoteEvidenceData = {
  session: LoadedSession;
  evidenceId: string;
  orgId: string | undefined;
  recordingArtifact: EvidenceArtifact;
  archiveArtifact: EvidenceArtifact;
  videoReadUrl: ArtifactReadUrl;
  archiveReadUrl: ArtifactReadUrl;
};

export type RemoteEvidenceResult =
  | { kind: "loaded"; data: RemoteEvidenceData }
  | { kind: "restricted"; orgName: string };

async function fetchRemoteEvidence(
  getToken: FetchToken,
  locator: { shareToken?: string; remoteEvidenceId?: string }
): Promise<RemoteEvidenceResult> {
  let evidenceId: string;
  let orgId: string | undefined;
  if (locator.shareToken) {
    const resolved = await api.resolveShareLink(getToken, locator.shareToken);
    if (resolved.shareLink.access === "denied") {
      return { kind: "restricted", orgName: resolved.organization.name };
    }
    evidenceId = resolved.shareLink.evidenceId;
    orgId = resolved.shareLink.orgId;
  } else if (locator.remoteEvidenceId) {
    evidenceId = locator.remoteEvidenceId;
  } else {
    throw new Error("No evidence locator provided.");
  }

  const artifactResult = await api.listEvidenceArtifacts(getToken, evidenceId, orgId);
  const recordingArtifact = artifactResult.artifacts.find((artifact) => artifact.kind === "recording");
  const archiveArtifact = artifactResult.artifacts.find((artifact) => artifact.kind === "network-log");
  if (!recordingArtifact || !archiveArtifact) {
    throw new Error("Evidence is missing recording or archive artifacts.");
  }

  const [videoReadUrl, archiveReadUrl] = await Promise.all([
    api.createArtifactReadUrl(getToken, evidenceId, recordingArtifact.id, orgId),
    api.createArtifactReadUrl(getToken, evidenceId, archiveArtifact.id, orgId)
  ]);
  const session = await loadRemoteSessionArtifacts({
    archiveUrl: archiveReadUrl.url,
    videoUrl: videoReadUrl.url
  });

  return {
    kind: "loaded",
    data: { session, evidenceId, orgId, recordingArtifact, archiveArtifact, videoReadUrl, archiveReadUrl }
  };
}

export function useRemoteEvidence(locator: { shareToken?: string; remoteEvidenceId?: string }) {
  const auth = useAuth();
  const getToken = useAuthToken();
  const enabled =
    auth.isLoaded && Boolean(auth.isSignedIn) && Boolean(locator.shareToken || locator.remoteEvidenceId);
  return useQuery<RemoteEvidenceResult>({
    queryKey: queryKeys.remoteEvidence(locator),
    queryFn: () => fetchRemoteEvidence(getToken, locator),
    enabled,
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 0
  });
}

export type { ApiOrganization };
