import { apiOrigin } from "./env";

export type FetchToken = () => Promise<string | null>;

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? fallback;
}

async function authedFetch<T>(getToken: FetchToken, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("Sign in is required.");

  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiOrigin}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(await readApiError(response, `Request failed (${response.status}).`));
  }
  return (await response.json()) as T;
}

export type AcceptInvitationResponse = {
  organizationId: string;
  role: "owner" | "member";
  invitationId: string;
};

export type EvidenceArtifact = {
  id: string;
  evidenceId: string;
  kind: string;
  mimeType: string;
  bytes: number;
  checksum: string;
  uploadStatus: string;
  createdAt: number;
  updatedAt: number;
};

export type ArtifactReadUrl = {
  url: string;
  expiresAt: number;
  renewAfterMs: number;
};

export type ResolveShareLinkResponse = {
  shareLink: {
    id: string;
    evidenceId: string;
    orgId: string;
    expiresAt: number;
    access: "granted" | "denied";
  };
  organization: {
    id: string;
    name: string;
  };
};

export const api = {
  resolveShareLink: (getToken: FetchToken, token: string) =>
    authedFetch<ResolveShareLinkResponse>(
      getToken,
      `/share-links/${encodeURIComponent(token)}/resolve`
    ),

  listEvidenceArtifacts: (getToken: FetchToken, evidenceId: string, orgId?: string) =>
    authedFetch<{ artifacts: EvidenceArtifact[] }>(
      getToken,
      `/evidences/${encodeURIComponent(evidenceId)}/artifacts${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`
    ),

  createArtifactReadUrl: (getToken: FetchToken, evidenceId: string, artifactId: string, orgId?: string) =>
    authedFetch<ArtifactReadUrl>(
      getToken,
      `/evidences/${encodeURIComponent(evidenceId)}/artifacts/${encodeURIComponent(artifactId)}/read-url${
        orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""
      }`
    ),

  acceptInvitation: (getToken: FetchToken, token: string) =>
    authedFetch<AcceptInvitationResponse>(getToken, "/orgs/invitations/accept", {
      method: "POST",
      body: JSON.stringify({ token })
    })
};
