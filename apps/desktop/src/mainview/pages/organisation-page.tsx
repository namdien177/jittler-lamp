import React, { useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod/v4";

import {
  api,
  type ApiCreatedInvitationCode,
  type ApiInvitation,
  type ApiInvitationCode,
  type ApiMember,
  type ApiOrgSummary,
  webOrigin
} from "../api";
import { useDesktopAuth } from "../auth-context";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/toast";
import { copyToClipboard, formatRelativeTime, getInitials } from "../utils";

type ManagementTab = "members" | "invites";

const createOrganizationFormSchema = z.object({
  name: z.string().trim().min(1, "Pick a name for the new workspace.").max(100)
});

const acceptInvitationFormSchema = z.object({
  token: z.string().trim().min(1, "Paste the invitation code."),
  password: z.string().optional()
});

const invitationCodeFormSchema = z.object({
  label: z.string().trim().min(1, "Name this invitation code.").max(80),
  role: z.enum(["moderator", "member"]),
  password: z.string().optional(),
  emailDomain: z
    .string()
    .trim()
    .transform((value) => value.replace(/^@/, "").toLowerCase())
    .pipe(z.union([z.literal(""), z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, "Use a valid domain.")])),
  expiresDays: z.string().regex(/^\d*$/, "Use whole days only."),
  guestDays: z.string()
});

type CreateOrganizationFormValues = z.infer<typeof createOrganizationFormSchema>;
type AcceptInvitationFormValues = z.infer<typeof acceptInvitationFormSchema>;
type InvitationCodeFormValues = z.infer<typeof invitationCodeFormSchema>;

function getInviteUrl(token: string): string {
  return `${webOrigin}/join?code=${encodeURIComponent(token)}`;
}

function getMemberPrimaryText(member: ApiMember): string {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
  return fullName || member.displayName || member.email || "Unknown user";
}

function roleChipClass(role: string): string {
  if (role === "owner") return "accent";
  if (role === "moderator") return "warning";
  return "neutral";
}

export function OrganisationPage(): React.JSX.Element {
  const auth = useDesktopAuth();
  const toast = useToast();
  const [orgs, setOrgs] = useState<ApiOrgSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showAcceptInvite, setShowAcceptInvite] = useState(false);
  const [managedOrgId, setManagedOrgId] = useState<string | null>(null);

  const managedOrg = orgs.find((org) => org.id === managedOrgId) ?? null;

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
      if (managedOrgId && !list.organizations.some((org) => org.id === managedOrgId)) {
        setManagedOrgId(null);
      }
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
      toast.error("Unable to switch workspace", error instanceof Error ? error.message : undefined);
    }
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Organisations</h1>
          <p className="page-subtitle">
            Switch workspace, review membership, and manage reusable joining codes for onboarding.
          </p>
        </div>
        <div className="row">
          <button className="button ghost sm" type="button" onClick={() => setShowAcceptInvite(true)}>
            Accept invite
          </button>
          <button className="button primary sm" type="button" onClick={() => setShowCreate(true)}>
            New organisation
          </button>
        </div>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      <div className="org-layout">
        <section className="org-list-panel">
          {orgs.length === 0 ? (
            <div className="empty-state">
              <h3>{loading ? "Loading organisations…" : "No organisations yet"}</h3>
              <p>Create an organisation, or paste an invitation code someone shared with you.</p>
            </div>
          ) : (
            <div className="org-cards compact">
              {orgs.map((org) => (
                <article
                  key={org.id}
                  className="org-card"
                  data-active={org.id === activeOrgId ? "true" : "false"}
                  data-selected={org.id === managedOrgId ? "true" : "false"}
                >
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
                    <button className="button ghost sm" type="button" onClick={() => setManagedOrgId(org.id)}>
                      Manage
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="org-management-panel">
          {managedOrg ? (
            <OrganisationManagement org={managedOrg} onChanged={() => void reload()} />
          ) : (
            <div className="empty-state">
              <h3>Select an organisation</h3>
              <p>Use Manage to open the member list, role controls, and invitation-code setup.</p>
            </div>
          )}
        </section>
      </div>

      {showCreate ? (
        <CreateOrganizationDialog
          onClose={() => setShowCreate(false)}
          onCreated={async (created) => {
            setShowCreate(false);
            setManagedOrgId(created.id);
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
            setManagedOrgId(orgId);
            await reload();
            await auth.refreshProfile();
            setActiveOrgId(orgId);
            toast.success("Invitation accepted");
          }}
        />
      ) : null}
    </div>
  );
}

function OrganisationManagement(props: { org: ApiOrgSummary; onChanged: () => void }): React.JSX.Element {
  const { org, onChanged } = props;
  const auth = useDesktopAuth();
  const toast = useToast();
  const [tab, setTab] = useState<ManagementTab>("members");
  const [members, setMembers] = useState<ApiMember[]>([]);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [codes, setCodes] = useState<ApiInvitationCode[]>([]);
  const [createdCode, setCreatedCode] = useState<ApiCreatedInvitationCode | null>(null);
  const [search, setSearch] = useState("");
  const [name, setName] = useState(org.name);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canManage = org.role === "owner" || org.role === "moderator";
  const isOwner = org.role === "owner";

  const reload = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [memberResult, inviteResult] = await Promise.all([
        api.listMembers(auth.getToken, org.id),
        canManage ? api.listInvitations(auth.getToken, org.id) : Promise.resolve({ invitations: [], codes: [] })
      ]);
      setMembers(memberResult.members);
      setInvitations(inviteResult.invitations);
      setCodes(inviteResult.codes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load organisation details.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setName(org.name);
    void reload();
  }, [org.id]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter((member) =>
      [getMemberPrimaryText(member), member.email ?? "", member.role].some((value) => value.toLowerCase().includes(q))
    );
  }, [members, search]);

  const rename = async (): Promise<void> => {
    if (!name.trim() || name.trim() === org.name) return;
    setBusy(true);
    try {
      await api.renameOrganization(auth.getToken, org.id, name.trim());
      toast.success("Organisation renamed");
      onChanged();
    } catch (err) {
      toast.error("Rename failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const updateRole = async (member: ApiMember, role: "moderator" | "member"): Promise<void> => {
    setBusy(true);
    try {
      await api.updateMemberRole(auth.getToken, org.id, member.membershipId, role);
      toast.success("Member role updated");
      await reload();
    } catch (err) {
      toast.error("Role update failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: ApiMember): Promise<void> => {
    setBusy(true);
    try {
      await api.removeMember(auth.getToken, org.id, member.membershipId);
      toast.success("Member removed");
      await reload();
      onChanged();
    } catch (err) {
      toast.error("Remove failed", err instanceof Error ? err.message : undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="org-management">
      <header className="org-management-header">
        <div>
          <span className="detail-label">Managing</span>
          <h2>{org.name}</h2>
          <p>{members.length} member{members.length === 1 ? "" : "s"} · your role is {org.role}</p>
        </div>
        {isOwner ? (
          <div className="org-rename">
            <input className="input" value={name} onChange={(event) => setName(event.currentTarget.value)} />
            <button className="button secondary sm" type="button" disabled={busy} onClick={() => void rename()}>
              Rename
            </button>
          </div>
        ) : null}
      </header>

      <div className="org-management-tabs">
        <button type="button" data-active={tab === "members"} onClick={() => setTab("members")}>
          Members
        </button>
        <button type="button" data-active={tab === "invites"} onClick={() => setTab("invites")}>
          Invitation codes
        </button>
      </div>

      {error ? <div className="auth-error">{error}</div> : null}

      {tab === "members" ? (
        <section className="org-management-section">
          <div className="auth-toolbar">
            <input
              className="input"
              type="search"
              placeholder="Search by name, email, or role"
              value={search}
              onChange={(event) => setSearch(event.currentTarget.value)}
            />
            <span className="muted">{filteredMembers.length} shown</span>
          </div>
          {loading ? (
            <div className="skeleton-row" style={{ height: 48 }} />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Joined</th>
                  <th>Guest until</th>
                  <th style={{ textAlign: "right" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => {
                  const canEdit = canManage && member.role !== "owner" && (isOwner || member.role === "member");
                  return (
                    <tr key={member.membershipId}>
                      <td>
                        <div className="row" style={{ gap: 8 }}>
                          <div className="sidebar-account-avatar" style={{ width: 28, height: 28, fontSize: 10 }}>
                            {getInitials(getMemberPrimaryText(member))}
                          </div>
                          <div className="column" style={{ gap: 2 }}>
                            <span style={{ fontSize: 12.5, fontWeight: 650 }}>{getMemberPrimaryText(member)}</span>
                            <span className="muted" style={{ fontSize: 11 }}>{member.email ?? "No email available"}</span>
                          </div>
                        </div>
                      </td>
                      <td><span className={`chip ${roleChipClass(member.role)}`}>{member.role}</span></td>
                      <td className="muted">{formatRelativeTime(member.joinedAt)}</td>
                      <td className="muted">{member.guestExpiresAt ? formatRelativeTime(member.guestExpiresAt) : "Permanent"}</td>
                      <td>
                        <div className="table-actions">
                          {canEdit && isOwner ? (
                            <select
                              className="select xs-select"
                              value={member.role === "moderator" ? "moderator" : "member"}
                              disabled={busy}
                              onChange={(event) => void updateRole(member, event.currentTarget.value as "moderator" | "member")}
                            >
                              <option value="member">Member</option>
                              <option value="moderator">Moderator</option>
                            </select>
                          ) : null}
                          {canEdit ? (
                            <button className="button ghost xs" type="button" disabled={busy} onClick={() => void removeMember(member)}>
                              Remove
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      ) : (
        <InvitationCodePanel
          org={org}
          canManage={canManage}
          isOwner={isOwner}
          busy={busy}
          codes={codes}
          invitations={invitations}
          createdCode={createdCode}
          setBusy={setBusy}
          setCreatedCode={setCreatedCode}
          reload={reload}
        />
      )}
    </div>
  );
}

function InvitationCodePanel(props: {
  org: ApiOrgSummary;
  canManage: boolean;
  isOwner: boolean;
  busy: boolean;
  codes: ApiInvitationCode[];
  invitations: ApiInvitation[];
  createdCode: ApiCreatedInvitationCode | null;
  setBusy: (busy: boolean) => void;
  setCreatedCode: (code: ApiCreatedInvitationCode | null) => void;
  reload: () => Promise<void>;
}): React.JSX.Element {
  const auth = useDesktopAuth();
  const toast = useToast();
  const form = useForm<InvitationCodeFormValues>({
    resolver: zodResolver(invitationCodeFormSchema),
    defaultValues: {
      label: "Team onboarding",
      role: "member",
      password: "",
      emailDomain: "",
      expiresDays: "",
      guestDays: ""
    }
  });

  const createCode = async (values: InvitationCodeFormValues): Promise<void> => {
    props.setBusy(true);
    try {
      const result = await api.createInvitationCode(auth.getToken, props.org.id, {
        label: values.label.trim(),
        role: values.role,
        emailDomain: values.emailDomain || null,
        expiresAt: values.expiresDays ? Date.now() + Number(values.expiresDays) * 24 * 60 * 60 * 1000 : null,
        guestExpiresAfterDays: values.guestDays ? Number(values.guestDays) : null,
        ...(values.password?.trim() ? { password: values.password.trim() } : {})
      });
      props.setCreatedCode(result.code);
      form.setValue("password", "");
      toast.success("Invitation code created");
      await props.reload();
    } catch (err) {
      toast.error("Code creation failed", err instanceof Error ? err.message : undefined);
    } finally {
      props.setBusy(false);
    }
  };

  const lockCode = async (code: ApiInvitationCode, locked: boolean): Promise<void> => {
    props.setBusy(true);
    try {
      await api.setInvitationCodeLocked(auth.getToken, props.org.id, code.id, locked);
      toast.success(locked ? "Invitation code locked" : "Invitation code unlocked");
      await props.reload();
    } catch (err) {
      toast.error("Code update failed", err instanceof Error ? err.message : undefined);
    } finally {
      props.setBusy(false);
    }
  };

  const deleteCode = async (code: ApiInvitationCode): Promise<void> => {
    props.setBusy(true);
    try {
      await api.deleteInvitationCode(auth.getToken, props.org.id, code.id);
      toast.success("Invitation code deleted");
      await props.reload();
    } catch (err) {
      toast.error("Code deletion failed", err instanceof Error ? err.message : undefined);
    } finally {
      props.setBusy(false);
    }
  };

  if (!props.canManage) {
    return <div className="empty-state"><h3>Member access</h3><p>Owners and moderators manage invitation codes.</p></div>;
  }

  return (
    <section className="org-management-section">
      <form className="invite-code-grid" onSubmit={form.handleSubmit(createCode)}>
        <label className="field">
          <span>Label</span>
          <input className="input field-input" {...form.register("label")} />
          {form.formState.errors.label ? <span className="field-error">{form.formState.errors.label.message}</span> : null}
        </label>
        <label className="field">
          <span>Role</span>
          <select className="select field-input" {...form.register("role")}>
            <option value="member">Member</option>
            <option value="moderator">Moderator</option>
          </select>
        </label>
        <label className="field">
          <span>Password</span>
          <input className="input field-input" type="password" placeholder="Optional" {...form.register("password")} />
        </label>
        <label className="field">
          <span>Email domain</span>
          <input className="input field-input" placeholder="littlelives.com" {...form.register("emailDomain")} />
          {form.formState.errors.emailDomain ? <span className="field-error">{form.formState.errors.emailDomain.message}</span> : null}
        </label>
        <label className="field">
          <span>Code expires in days</span>
          <input className="input field-input" type="number" min="1" placeholder="No expiry" {...form.register("expiresDays")} />
          {form.formState.errors.expiresDays ? <span className="field-error">{form.formState.errors.expiresDays.message}</span> : null}
        </label>
        <label className="field">
          <span>Guest days</span>
          <select className="select field-input" {...form.register("guestDays")}>
            <option value="">Permanent</option>
            <option value="1">1 day</option>
            <option value="3">3 days</option>
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
          </select>
        </label>
        <button className="button primary sm" type="submit" disabled={props.busy || props.codes.length >= 3}>
          Create code
        </button>
      </form>

      {props.createdCode ? (
        <div className="invite-token-box">
          <span className="detail-label">New static joining link</span>
          <span>{props.createdCode.code}</span>
          <div className="row">
            <button className="button primary xs" type="button" onClick={async () => { await copyToClipboard(props.createdCode?.code ?? ""); toast.success("Code copied"); }}>
              Copy code
            </button>
            <button className="button ghost xs" type="button" onClick={async () => { await copyToClipboard(getInviteUrl(props.createdCode?.code ?? "")); toast.success("Join URL copied"); }}>
              Copy URL
            </button>
            <button className="button ghost xs" type="button" onClick={() => props.setCreatedCode(null)}>Done</button>
          </div>
        </div>
      ) : null}

      <table className="table">
        <thead>
          <tr>
            <th>Code</th>
            <th>Restrictions</th>
            <th>Guest</th>
            <th>Status</th>
            <th style={{ textAlign: "right" }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {props.codes.map((code) => (
            <tr key={code.id}>
              <td>
                <div className="column" style={{ gap: 2 }}>
                  <strong>{code.label}</strong>
                  <span className="muted">{code.role}</span>
                </div>
              </td>
              <td className="muted">
                {[
                  code.hasPassword ? "password" : null,
                  code.emailDomain ? `@${code.emailDomain}` : null,
                  code.expiresAt ? `expires ${formatRelativeTime(code.expiresAt)}` : null
                ].filter(Boolean).join(" · ") || "None"}
              </td>
              <td className="muted">{code.guestExpiresAfterDays ? `${code.guestExpiresAfterDays} days` : "Permanent"}</td>
              <td><span className={`chip ${code.lockedAt ? "danger" : "success"}`}>{code.lockedAt ? "locked" : "active"}</span></td>
              <td>
                <div className="table-actions">
                  {props.isOwner ? (
                    <button className="button ghost xs" type="button" disabled={props.busy} onClick={() => void lockCode(code, !code.lockedAt)}>
                      {code.lockedAt ? "Unlock" : "Lock"}
                    </button>
                  ) : null}
                  <button className="button ghost xs" type="button" disabled={props.busy} onClick={() => void deleteCode(code)}>
                    Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {props.codes.length === 0 ? (
            <tr><td colSpan={5} className="muted">No static codes yet. Create one for repeat onboarding.</td></tr>
          ) : null}
        </tbody>
      </table>

      {props.invitations.length > 0 ? (
        <div className="legacy-invites">
          <h3 className="card-title">Pending direct invitations</h3>
          <table className="table">
            <tbody>
              {props.invitations.map((invitation) => (
                <tr key={invitation.id}>
                  <td>{invitation.email}</td>
                  <td><span className={`chip ${roleChipClass(invitation.role)}`}>{invitation.role}</span></td>
                  <td><span className="chip neutral">{invitation.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function CreateOrganizationDialog(props: {
  onClose: () => void;
  onCreated: (organization: ApiOrgSummary) => Promise<void>;
}): React.JSX.Element {
  const auth = useDesktopAuth();
  const form = useForm<CreateOrganizationFormValues>({
    resolver: zodResolver(createOrganizationFormSchema),
    defaultValues: { name: "" }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: CreateOrganizationFormValues): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createOrganization(auth.getToken, values.name.trim());
      await props.onCreated(result.organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create organisation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={props.onClose} title="Create organisation" footer={
      <>
        <button className="button ghost sm" type="button" onClick={props.onClose} disabled={busy}>Cancel</button>
        <button className="button primary sm" type="button" onClick={() => void form.handleSubmit(submit)()} disabled={busy}>{busy ? "Creating…" : "Create"}</button>
      </>
    }>
      <form
        className="column"
        style={{ gap: 12 }}
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit(submit)(event);
        }}
      >
        <label className="field">
          <span>Name</span>
          <input className="input field-input" autoFocus {...form.register("name")} />
          {form.formState.errors.name ? <span className="field-error">{form.formState.errors.name.message}</span> : null}
        </label>
      </form>
      {error ? <div className="auth-error">{error}</div> : null}
    </Dialog>
  );
}

function AcceptInvitationDialog(props: {
  onClose: () => void;
  onAccepted: (orgId: string) => Promise<void>;
}): React.JSX.Element {
  const auth = useDesktopAuth();
  const form = useForm<AcceptInvitationFormValues>({
    resolver: zodResolver(acceptInvitationFormSchema),
    defaultValues: { token: "", password: "" }
  });
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: AcceptInvitationFormValues): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!requiresPassword) {
        const lookup = await api.lookupInvitation(auth.getToken, values.token.trim()).catch(() => null);
        if (lookup?.code.requiresPassword) {
          setRequiresPassword(true);
          setError("This invitation code is password protected.");
          return;
        }
      }
      if (requiresPassword && !values.password) {
        setError("Enter the invitation password.");
        return;
      }
      const result = await api.acceptInvitation(auth.getToken, values.token.trim(), requiresPassword ? values.password : undefined);
      await props.onAccepted(result.organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={props.onClose} title="Accept invitation" footer={
      <>
        <button className="button ghost sm" type="button" onClick={props.onClose} disabled={busy}>Cancel</button>
        <button className="button primary sm" type="button" onClick={() => void form.handleSubmit(submit)()} disabled={busy}>{busy ? "Joining…" : "Join"}</button>
      </>
    }>
      <form
        className="column"
        style={{ gap: 12 }}
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit(submit)(event);
        }}
      >
        <label className="field">
          <span>Invitation code</span>
          <input className="input field-input mono" autoFocus {...form.register("token")} />
          {form.formState.errors.token ? <span className="field-error">{form.formState.errors.token.message}</span> : null}
        </label>
        {requiresPassword ? (
          <label className="field">
            <span>Password</span>
            <input className="input field-input" type="password" {...form.register("password")} />
          </label>
        ) : null}
      </form>
      {error ? <div className="auth-error">{error}</div> : null}
    </Dialog>
  );
}
