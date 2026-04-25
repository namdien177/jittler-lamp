import React, { useEffect, useState } from "react";

import {
  api,
  type ApiCreatedInvitation,
  type ApiInvitation,
  type ApiMember,
  type ApiOrgSummary
} from "../api";
import { useDesktopAuth } from "../auth-context";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { copyToClipboard, formatRelativeTime, getInitials } from "../utils";

export function OrganisationPage(): React.JSX.Element {
  const auth = useDesktopAuth();
  const toast = useToast();
  const [orgs, setOrgs] = useState<ApiOrgSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAcceptInvite, setShowAcceptInvite] = useState(false);
  const [detailOrg, setDetailOrg] = useState<ApiOrgSummary | null>(null);

  const reload = async (): Promise<void> => {
    if (auth.state.status !== "signed-in") return;
    setLoading(true);
    setError(null);
    try {
      const [profile, list] = await Promise.all([
        api.fetchAccountProfile(auth.getToken),
        api.listOrganizations(auth.getToken)
      ]);
      setActiveOrgId(profile.activeOrgId);
      setOrgs(list.organizations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load organisations.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [auth.state.status]);

  const handleSwitch = async (orgId: string): Promise<void> => {
    try {
      await api.selectActiveOrganization(auth.getToken, orgId);
      setActiveOrgId(orgId);
      await auth.refreshProfile();
      toast.success("Active workspace switched");
    } catch (error) {
      toast.error(
        "Unable to switch workspace",
        error instanceof Error ? error.message : undefined
      );
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Organisations</h1>
          <p className="page-subtitle">
            Switch the workspace your active session uses, create new shared organisations, or accept invitations
            from teammates.
          </p>
        </div>
        <div className="row">
          <button className="button ghost sm" type="button" onClick={() => setShowAcceptInvite(true)}>
            Have a token? Accept invite
          </button>
          <button className="button primary sm" type="button" onClick={() => setShowCreate(true)}>
            New organisation
          </button>
        </div>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      {orgs.length === 0 ? (
        <div className="empty-state">
          <h3>{loading ? "Loading organisations…" : "You're not a member of any organisations yet"}</h3>
          <p>Create a personal workspace, or paste an invitation token someone shared with you.</p>
        </div>
      ) : (
        <div className="org-cards">
          {orgs.map((org) => (
            <article key={org.id} className="org-card" data-active={org.id === activeOrgId ? "true" : "false"}>
              <div className="org-card-header">
                <div className="row" style={{ gap: 10 }}>
                  <div className="sidebar-account-avatar" style={{ width: 36, height: 36, fontSize: 12 }}>
                    {getInitials(org.name)}
                  </div>
                  <div className="column" style={{ gap: 2 }}>
                    <h3 className="org-card-name">{org.name}</h3>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {org.isPersonal ? "Personal workspace" : `${org.memberCount} member${org.memberCount === 1 ? "" : "s"}`}
                    </span>
                  </div>
                </div>
                {org.id === activeOrgId ? <span className="chip success">active</span> : null}
              </div>
              <div className="org-card-meta">
                <span>Role · <strong style={{ color: "var(--text)" }}>{org.role}</strong></span>
                <span>Created · {formatRelativeTime(org.createdAt)}</span>
              </div>
              <div className="org-card-actions">
                <button
                  className="button primary sm"
                  type="button"
                  disabled={org.id === activeOrgId}
                  onClick={() => void handleSwitch(org.id)}
                >
                  {org.id === activeOrgId ? "Active" : "Switch"}
                </button>
                <button className="button ghost sm" type="button" onClick={() => setDetailOrg(org)}>
                  Manage
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {showCreate ? (
        <CreateOrganizationDialog
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => {
            setShowCreate(false);
            await reload();
            toast.success("Organisation created", `${created.name} is now your active workspace.`);
            await auth.refreshProfile();
            setActiveOrgId(created.id);
          }}
        />
      ) : null}

      {showAcceptInvite ? (
        <AcceptInvitationDialog
          onClose={() => setShowAcceptInvite(false)}
          onAccepted={async (orgId) => {
            setShowAcceptInvite(false);
            await reload();
            await auth.refreshProfile();
            setActiveOrgId(orgId);
            toast.success("Invitation accepted", "Welcome to the workspace!");
          }}
        />
      ) : null}

      {detailOrg ? (
        <OrganisationDetailDialog
          org={detailOrg}
          onClose={() => setDetailOrg(null)}
          onChanged={() => void reload()}
        />
      ) : null}
    </div>
  );
}

function CreateOrganizationDialog(props: {
  onClose: () => void;
  onCreated: (organization: ApiOrgSummary) => Promise<void>;
}): React.JSX.Element {
  const auth = useDesktopAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!name.trim()) {
      setError("Pick a name for the new workspace.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.createOrganization(auth.getToken, name.trim());
      await props.onCreated(result.organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organisation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={props.onClose}
      title="Create organisation"
      description="A new shared workspace with you as the owner. Invite teammates afterwards."
      footer={
        <>
          <button className="button ghost sm" type="button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary sm" type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Creating…" : "Create workspace"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input
          className="input field-input"
          type="text"
          placeholder="Acme legal team"
          value={name}
          autoFocus
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </label>
      {error ? <div className="auth-error">{error}</div> : null}
    </Dialog>
  );
}

function AcceptInvitationDialog(props: {
  onClose: () => void;
  onAccepted: (orgId: string) => Promise<void>;
}): React.JSX.Element {
  const auth = useDesktopAuth();
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    if (!token.trim()) {
      setError("Paste the invitation token.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.acceptInvitation(auth.getToken, token.trim());
      await props.onAccepted(result.organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={props.onClose}
      title="Accept invitation"
      description="Paste the invitation token an organisation owner shared with you."
      footer={
        <>
          <button className="button ghost sm" type="button" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button primary sm" type="button" onClick={() => void submit()} disabled={busy}>
            {busy ? "Joining…" : "Join workspace"}
          </button>
        </>
      }
    >
      <label className="field">
        <span>Invitation token</span>
        <input
          className="input field-input mono"
          type="text"
          placeholder="inv_…"
          value={token}
          autoFocus
          onChange={(event) => setToken(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
        />
      </label>
      {error ? <div className="auth-error">{error}</div> : null}
    </Dialog>
  );
}

function OrganisationDetailDialog(props: {
  org: ApiOrgSummary;
  onClose: () => void;
  onChanged: () => void;
}): React.JSX.Element {
  const { org, onClose, onChanged } = props;
  const auth = useDesktopAuth();
  const toast = useToast();
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [createdInvitation, setCreatedInvitation] = useState<ApiCreatedInvitation | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"owner" | "member">("member");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = org.role === "owner";

  const reload = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const memberResult = await api.listMembers(auth.getToken, org.id);
      setMembers(memberResult.members);

      if (isOwner) {
        const inviteResult = await api.listInvitations(auth.getToken, org.id);
        setInvitations(inviteResult.invitations);
      } else {
        setInvitations([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load organisation details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [org.id]);

  const sendInvite = async (): Promise<void> => {
    if (!inviteEmail.trim()) {
      setError("Enter the invitee's email address.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await api.createInvitation(auth.getToken, org.id, {
        email: inviteEmail.trim(),
        role: inviteRole
      });
      setCreatedInvitation(result.invitation);
      setInviteEmail("");
      toast.success("Invitation created", "Copy the token and share it with the invitee.");
      await reload();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create invitation.");
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (invitationId: string): Promise<void> => {
    setBusy(true);
    try {
      await api.revokeInvitation(auth.getToken, org.id, invitationId);
      toast.success("Invitation revoked");
      await reload();
    } catch (err) {
      toast.error("Failed to revoke invitation", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      size="lg"
      title={`Manage · ${org.name}`}
      description={`${members.length} member${members.length === 1 ? "" : "s"} · You are a ${org.role}`}
      footer={
        <button className="button secondary sm" type="button" onClick={onClose}>
          Close
        </button>
      }
    >
      {error ? <div className="auth-error">{error}</div> : null}

      <section>
        <h3 className="card-title" style={{ marginBottom: 8 }}>Members</h3>
        {loading ? (
          <div className="skeleton-row" style={{ height: 36 }} />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Role</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.membershipId}>
                  <td>
                    <div className="row" style={{ gap: 8 }}>
                      <div className="sidebar-account-avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                        {getInitials(member.clerkUserId)}
                      </div>
                      <span className="mono" style={{ fontSize: 11 }}>{member.clerkUserId}</span>
                    </div>
                  </td>
                  <td>
                    <span className={`chip ${member.role === "owner" ? "accent" : "neutral"}`}>{member.role}</span>
                  </td>
                  <td className="muted">{formatRelativeTime(member.joinedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {isOwner ? (
        <section>
          <h3 className="card-title" style={{ marginBottom: 8 }}>Invite teammate</h3>
          <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ flex: 2, minWidth: 220 }}>
              <span>Email</span>
              <input
                className="input field-input"
                type="email"
                value={inviteEmail}
                placeholder="teammate@company.com"
                onChange={(event) => setInviteEmail(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void sendInvite();
                }}
              />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 130 }}>
              <span>Role</span>
              <select
                className="select field-input"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.currentTarget.value as "owner" | "member")}
              >
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
            </label>
            <button className="button primary sm" type="button" onClick={() => void sendInvite()} disabled={busy}>
              {busy ? "Working…" : "Generate invite"}
            </button>
          </div>
          {createdInvitation ? (
            <div className="invite-token-box" style={{ marginTop: 12 }}>
              <span className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Invite token for {createdInvitation.email}
              </span>
              <span>{createdInvitation.token}</span>
              <div className="row" style={{ gap: 6 }}>
                <button
                  className="button primary xs"
                  type="button"
                  onClick={async () => {
                    await copyToClipboard(createdInvitation.token);
                    toast.success("Token copied");
                  }}
                >
                  Copy token
                </button>
                <button className="button ghost xs" type="button" onClick={() => setCreatedInvitation(null)}>
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {isOwner && invitations.length > 0 ? (
        <section>
          <h3 className="card-title" style={{ marginBottom: 8 }}>Invitations</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Created</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.email}</td>
                  <td>
                    <span className={`chip ${invitation.role === "owner" ? "accent" : "neutral"}`}>{invitation.role}</span>
                  </td>
                  <td>
                    <span
                      className={`chip ${
                        invitation.status === "pending"
                          ? "warning"
                          : invitation.status === "accepted"
                            ? "success"
                            : "danger"
                      }`}
                    >
                      {invitation.status}
                    </span>
                  </td>
                  <td className="muted">{formatRelativeTime(invitation.createdAt)}</td>
                  <td>
                    <div className="table-actions">
                      {invitation.status === "pending" ? (
                        <button
                          className="button ghost xs"
                          type="button"
                          onClick={() => void revoke(invitation.id)}
                          disabled={busy}
                        >
                          Revoke
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </Dialog>
  );
}
