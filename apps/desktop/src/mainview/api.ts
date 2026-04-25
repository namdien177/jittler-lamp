export const apiOrigin = (process.env.JITTLE_LAMP_API_ORIGIN?.trim() || "http://127.0.0.1:3001").replace(/\/+$/, "");
export const webOrigin = (process.env.JITTLE_LAMP_WEB_ORIGIN?.trim() || "http://127.0.0.1:4173").replace(/\/+$/, "");

export type ApiOrganization = {
  id: string;
  name: string;
  role: string;
  isPersonal: boolean;
  isActive: boolean;
};

export type ApiAccountProfile = {
  userId: string;
  activeOrgId: string | null;
  user: {
    id: string;
    displayName: string;
    email: string | null;
    imageUrl: string | null;
  };
  organizations: ApiOrganization[];
};

export type ApiOrgSummary = {
  id: string;
  name: string;
  role: string;
  isPersonal: boolean;
  memberCount: number;
  createdAt: number;
};

export type ApiMember = {
  membershipId: string;
  userId: string;
  clerkUserId: string;
  role: string;
  joinedAt: number;
};

export type ApiInvitation = {
  id: string;
  email: string;
  role: "owner" | "member";
  status: "pending" | "accepted" | "revoked" | "expired";
  expiresAt: number;
  createdAt: number;
  invitedBy: string;
};

export type ApiCreatedInvitation = ApiInvitation & {
  organizationId: string;
  token: string;
};

export type ApiEvidenceSummary = {
  id: string;
  orgId: string;
  title: string;
  sourceType: string;
  sourceExternalId?: string | null;
  sourceMetadata?: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
};

export type ApiEvidenceArtifactSummary = {
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

export type ApiShareLinkSummary = {
  id: string;
  evidenceId: string;
  orgId: string;
  scope: "internal";
  createdAt: number;
  expiresAt: number;
  revokedAt: number | null;
  createdBy: string;
};

export type CreatedShareLink = {
  id: string;
  token: string;
  evidenceId: string;
  orgId: string;
  expiresAt: number;
  scope: "internal";
};

export type StartedEvidenceUpload = {
  uploadId: string;
  evidenceId: string;
  organizationId: string;
  uploadSession: {
    expiresAt: number;
    uploadUrl: string;
    method: "PUT";
    headers: {
      "content-type": string;
    };
    storageKey: string;
  };
};

export type StartedDesktopSessionSync = {
  evidenceId: string;
  organizationId: string;
  uploadSessions: Array<{
    key: string;
    uploadId: string;
    expiresAt: number;
    uploadUrl: string;
    method: "PUT";
    headers: {
      "content-type": string;
    };
    storageKey: string;
  }>;
};

async function readApiError(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return payload?.error?.message ?? fallback;
}

export type FetchToken = () => Promise<string | null>;

async function authedFetch<T>(getToken: FetchToken, path: string, init: RequestInit = {}): Promise<T> {
  const token = await getToken();
  if (!token) throw new Error("No API session token available.");

  const headers = new Headers(init.headers ?? {});
  headers.set("authorization", `Bearer ${token}`);
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${apiOrigin}${path}`, { ...init, headers });
  if (!response.ok) {
    throw new Error(await readApiError(response, `Request failed (${response.status}).`));
  }

  if (response.status === 204) return undefined as unknown as T;
  return (await response.json()) as T;
}

export const api = {
  fetchAccountProfile: (getToken: FetchToken) =>
    authedFetch<ApiAccountProfile>(getToken, "/protected/me"),

  selectActiveOrganization: (getToken: FetchToken, orgId: string) =>
    authedFetch<{ organizationId: string }>(getToken, `/orgs/${encodeURIComponent(orgId)}/select-active`, {
      method: "POST"
    }),

  listOrganizations: (getToken: FetchToken) =>
    authedFetch<{ organizations: ApiOrgSummary[] }>(getToken, "/orgs"),

  createOrganization: (getToken: FetchToken, name: string) =>
    authedFetch<{ organization: ApiOrgSummary }>(getToken, "/orgs", {
      method: "POST",
      body: JSON.stringify({ name })
    }),

  listMembers: (getToken: FetchToken, orgId: string) =>
    authedFetch<{ members: ApiMember[] }>(getToken, `/orgs/${encodeURIComponent(orgId)}/members`),

  listInvitations: (getToken: FetchToken, orgId: string) =>
    authedFetch<{ invitations: ApiInvitation[] }>(getToken, `/orgs/${encodeURIComponent(orgId)}/invitations`),

  createInvitation: (
    getToken: FetchToken,
    orgId: string,
    body: { email: string; role?: "owner" | "member"; ttlMs?: number }
  ) =>
    authedFetch<{ invitation: ApiCreatedInvitation }>(getToken, `/orgs/${encodeURIComponent(orgId)}/invitations`, {
      method: "POST",
      body: JSON.stringify(body)
    }),

  revokeInvitation: (getToken: FetchToken, orgId: string, invitationId: string) =>
    authedFetch<{ invitation: ApiInvitation }>(
      getToken,
      `/orgs/${encodeURIComponent(orgId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      { method: "POST" }
    ),

  acceptInvitation: (getToken: FetchToken, token: string) =>
    authedFetch<{ organizationId: string; role: "owner" | "member"; invitationId: string }>(
      getToken,
      "/orgs/invitations/accept",
      {
        method: "POST",
        body: JSON.stringify({ token })
      }
    ),

  listEvidences: (getToken: FetchToken, orgId?: string) =>
    authedFetch<{ evidences: ApiEvidenceSummary[]; orgId: string }>(
      getToken,
      orgId ? `/evidences?orgId=${encodeURIComponent(orgId)}` : "/evidences"
    ),

  listEvidenceArtifacts: (getToken: FetchToken, evidenceId: string, orgId?: string) =>
    authedFetch<{ artifacts: ApiEvidenceArtifactSummary[] }>(
      getToken,
      `/evidences/${encodeURIComponent(evidenceId)}/artifacts${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ""}`
    ),

  listShareLinks: (getToken: FetchToken, evidenceId: string) =>
    authedFetch<{ shareLinks: ApiShareLinkSummary[] }>(
      getToken,
      `/evidences/${encodeURIComponent(evidenceId)}/share-links`
    ),

  createShareLink: (getToken: FetchToken, evidenceId: string, expiresInMs?: number) =>
    authedFetch<{ shareLink: CreatedShareLink }>(
      getToken,
      `/evidences/${encodeURIComponent(evidenceId)}/share-links`,
      {
        method: "POST",
        body: JSON.stringify(expiresInMs !== undefined ? { expiresInMs } : {})
      }
    ),

  startEvidenceUpload: (
    getToken: FetchToken,
    body: {
      title: string;
      sourceType: string;
      sourceExternalId: string;
      sourceMetadata?: string;
      artifact: {
        kind: "recording" | "transcript" | "screenshot" | "network-log" | "attachment";
        mimeType: string;
        bytes: number;
        checksum: string;
      };
    }
  ) =>
    authedFetch<StartedEvidenceUpload>(getToken, "/evidences/uploads/start", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  startDesktopSessionSync: (
    getToken: FetchToken,
    body: {
      sessionId: string;
      title: string;
      sourceMetadata?: string;
      artifacts: Array<{
        key: "recording" | "archive";
        kind: "recording" | "network-log";
        mimeType: string;
        bytes: number;
        checksum: string;
      }>;
    }
  ) =>
    authedFetch<StartedDesktopSessionSync>(getToken, "/evidences/desktop-sessions/sync/start", {
      method: "POST",
      body: JSON.stringify(body)
    }),

  uploadEvidenceBlob: async (
    getToken: FetchToken,
    uploadUrl: string,
    payload: Uint8Array,
    mimeType: string
  ): Promise<void> => {
    const token = await getToken();
    if (!token) throw new Error("No API session token available.");

    const response = await fetch(uploadUrl, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": mimeType
      },
      body: new Blob([payload.slice().buffer as ArrayBuffer], { type: mimeType })
    });
    if (!response.ok) {
      throw new Error(await readApiError(response, `Upload failed (${response.status}).`));
    }
  },

  completeEvidenceUpload: (
    getToken: FetchToken,
    uploadId: string,
    body: { bytes: number; checksum: string; mimeType: string }
  ) =>
    authedFetch<{ uploadId: string; evidenceId: string; status: "committed" }>(
      getToken,
      `/evidences/uploads/${encodeURIComponent(uploadId)}/complete`,
      {
        method: "POST",
        body: JSON.stringify(body)
      }
    ),

  revokeShareLink: (getToken: FetchToken, shareLinkId: string) =>
    authedFetch<{ shareLink: { id: string; revokedAt: number } }>(
      getToken,
      `/share-links/${encodeURIComponent(shareLinkId)}/revoke`,
      { method: "POST" }
    )
};
