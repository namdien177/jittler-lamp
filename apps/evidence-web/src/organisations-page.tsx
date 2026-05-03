import React, { useEffect, useMemo, useState } from "react";
import { Dialog as BaseDialog } from "@base-ui-components/react/dialog";
import { useAuth } from "@clerk/clerk-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useForm } from "react-hook-form";
import { useNavigate, useParams } from "react-router";
import { z } from "zod/v4";

import {
  api,
  type ApiCreatedInvitationCode,
  type ApiEvidenceSummary,
  type ApiInvitation,
  type ApiInvitationCode,
  type ApiMember,
  type ApiMembersResponse,
  type ApiOrgSummary
} from "./api";
import { AuthenticatedWebLayout } from "./auth-layout";

type DetailTab = "members" | "invitations" | "library" | "options";
type SortKey = "name" | "joinedAt" | "role";
type RoleFilter = "all" | "owner" | "moderator" | "member";

const createOrgSchema = z.object({
  name: z.string().trim().min(1, "Organisation name is required.").max(100)
});

const acceptInvitationSchema = z.object({
  token: z.string().trim().min(1, "Invitation code is required."),
  password: z.string().optional()
});

const codeSchema = z.object({
  label: z.string().trim().min(1, "Label is required.").max(80),
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

type CreateOrgValues = z.infer<typeof createOrgSchema>;
type AcceptInvitationValues = z.infer<typeof acceptInvitationSchema>;
type CodeValues = z.infer<typeof codeSchema>;

const tabs: Array<{ id: DetailTab; label: string }> = [
  { id: "members", label: "Members" },
  { id: "invitations", label: "Invitations" },
  { id: "library", label: "Library" },
  { id: "options", label: "Options" }
];

function formatRelativeTime(value: number): string {
  const diff = Date.now() - value;
  const day = 24 * 60 * 60 * 1000;
  if (Math.abs(diff) < day) return "today";
  const days = Math.round(Math.abs(diff) / day);
  return diff >= 0 ? `${days}d ago` : `in ${days}d`;
}

function memberName(member: ApiMember): string {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(" ").trim();
  return fullName || member.displayName || member.email || "Unknown user";
}

function sortOrganizations(orgs: ApiOrgSummary[], activeOrgId: string | null, sort: SortKey): ApiOrgSummary[] {
  return [...orgs].sort((a, b) => {
    if (a.id === activeOrgId) return -1;
    if (b.id === activeOrgId) return 1;
    if (sort === "name") return a.name.localeCompare(b.name);
    if (sort === "role") return a.role.localeCompare(b.role) || a.name.localeCompare(b.name);
    return a.joinedAt - b.joinedAt;
  });
}

function getTabPath(orgId: string, tab: DetailTab): string {
  if (tab === "members") return `/organisations/${orgId}`;
  return `/organisations/${orgId}/${tab}`;
}

export function OrganisationsPage(props: { section?: DetailTab }): React.JSX.Element {
  const { orgId } = useParams();
  return orgId ? <OrganisationDetailPage orgId={orgId} tab={props.section ?? "members"} /> : <OrganisationListPage />;
}

function OrganisationListPage(): React.JSX.Element {
  const auth = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<ApiOrgSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>("name");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [showAcceptInvite, setShowAcceptInvite] = useState(false);
  const getToken = () => auth.getToken();

  const load = async (): Promise<void> => {
    const [profile, list] = await Promise.all([api.fetchAccountProfile(getToken), api.listOrganizations(getToken)]);
    setActiveOrgId(profile.activeOrgId);
    setOrgs(list.organizations);
  };

  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn) return;
    void load().catch((err) => setError(err instanceof Error ? err.message : "Unable to load organisations."));
  }, [auth.isLoaded, auth.isSignedIn]);

  const orderedOrgs = useMemo(() => sortOrganizations(orgs, activeOrgId, sort), [activeOrgId, orgs, sort]);

  const activate = async (id: string): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.selectActiveOrganization(getToken, id);
      setActiveOrgId(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to change active organisation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthenticatedWebLayout>
      <main className="auth-main org-web-main">
        <header className="auth-main-header">
          <div>
            <h1 className="auth-page-title">Organisations</h1>
            <p className="auth-page-subtitle">Workspaces you belong to, with the active organisation always first.</p>
          </div>
          <div className="org-web-actions">
            <button className="auth-button ghost" type="button" onClick={() => setShowAcceptInvite(true)}>Accept invite</button>
            <button className="auth-button primary" type="button" onClick={() => setShowCreate(true)}>Create</button>
          </div>
        </header>

        <div className="auth-main-content org-web-stack">
          {error ? <div className="auth-error-banner">{error}</div> : null}
          <div className="org-web-toolbar">
            <span className="auth-muted">{orgs.length} organisation{orgs.length === 1 ? "" : "s"}</span>
            <label className="org-web-sort">
              <span>Order by</span>
              <select value={sort} onChange={(event) => setSort(event.currentTarget.value as SortKey)}>
                <option value="name">Name</option>
                <option value="joinedAt">Date joining</option>
                <option value="role">Role</option>
              </select>
            </label>
          </div>

          <section className="org-web-panel">
            <table className="org-web-table">
              <thead><tr><th>Organisation</th><th>Role</th><th>Joined</th><th>Members</th><th>Actions</th></tr></thead>
              <tbody>
                {orderedOrgs.map((org) => (
                  <tr key={org.id} data-active={org.id === activeOrgId}>
                    <td><strong>{org.name}</strong><span>{org.isPersonal ? "Personal workspace" : "Organisation workspace"}</span></td>
                    <td><span className="auth-chip">{org.role}</span></td>
                    <td>{formatRelativeTime(org.joinedAt)}</td>
                    <td>{org.memberCount}</td>
                    <td>
                      <div className="org-web-actions">
                        <button className={org.id === activeOrgId ? "auth-button" : "auth-button primary"} type="button" disabled={busy || org.id === activeOrgId} onClick={() => void activate(org.id)}>Active</button>
                        <button className="auth-button ghost" type="button" onClick={() => navigate(`/organisations/${org.id}`)}>Manage</button>
                      </div>
                    </td>
                  </tr>
                ))}
                {orderedOrgs.length === 0 ? <tr><td colSpan={5}>No organisations yet.</td></tr> : null}
              </tbody>
            </table>
          </section>
        </div>

        {showCreate ? (
          <CreateOrganizationDialog
            getToken={getToken}
            onClose={() => setShowCreate(false)}
            onCreated={async (created) => {
              setShowCreate(false);
              await load();
              navigate(`/organisations/${created.id}`);
            }}
          />
        ) : null}

        {showAcceptInvite ? (
          <AcceptInvitationDialog
            getToken={getToken}
            onClose={() => setShowAcceptInvite(false)}
            onAccepted={async (id) => {
              setShowAcceptInvite(false);
              await load();
              navigate(`/organisations/${id}`);
            }}
          />
        ) : null}
      </main>
    </AuthenticatedWebLayout>
  );
}

function OrganisationDetailPage(props: { orgId: string; tab: DetailTab }): React.JSX.Element {
  const { orgId, tab } = props;
  const auth = useAuth();
  const navigate = useNavigate();
  const [orgs, setOrgs] = useState<ApiOrgSummary[]>([]);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);
  const [membersResult, setMembersResult] = useState<ApiMembersResponse>({ members: [], total: 0, page: 1, limit: 20 });
  const [memberSearch, setMemberSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [memberPage, setMemberPage] = useState(1);
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [codes, setCodes] = useState<ApiInvitationCode[]>([]);
  const [createdCode, setCreatedCode] = useState<ApiCreatedInvitationCode | null>(null);
  const [evidences, setEvidences] = useState<ApiEvidenceSummary[]>([]);
  const [creatorMembers, setCreatorMembers] = useState<ApiMember[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const getToken = () => auth.getToken();
  const org = orgs.find((candidate) => candidate.id === orgId) ?? null;
  const canManage = org?.role === "owner" || org?.role === "moderator";
  const isOwner = org?.role === "owner";
  const pages = Math.max(1, Math.ceil(membersResult.total / membersResult.limit));
  const creatorByUserId = useMemo(() => new Map(creatorMembers.map((member) => [member.userId, memberName(member)])), [creatorMembers]);

  const loadShell = async (): Promise<void> => {
    const [profile, list] = await Promise.all([api.fetchAccountProfile(getToken), api.listOrganizations(getToken)]);
    setActiveOrgId(profile.activeOrgId);
    setOrgs(list.organizations);
    if (!list.organizations.some((candidate) => candidate.id === orgId)) navigate("/organisations");
  };

  const loadMembers = async (): Promise<void> => {
    const result = await api.listMembers(getToken, orgId, {
      search: memberSearch.trim() || undefined,
      role: roleFilter,
      page: memberPage,
      limit: 20
    });
    setMembersResult(result);
  };

  const loadInvitations = async (): Promise<void> => {
    const result = await api.listInvitations(getToken, orgId);
    setInvitations(result.invitations);
    setCodes(result.codes);
  };

  useEffect(() => {
    if (!auth.isLoaded || !auth.isSignedIn) return;
    void loadShell().catch((err) => setError(err instanceof Error ? err.message : "Unable to load organisation."));
  }, [auth.isLoaded, auth.isSignedIn, orgId]);

  useEffect(() => {
    if (tab !== "members" || !auth.isSignedIn) return;
    void loadMembers().catch((err) => setError(err instanceof Error ? err.message : "Unable to load members."));
  }, [auth.isSignedIn, orgId, tab, memberSearch, roleFilter, memberPage]);

  useEffect(() => {
    if (tab !== "invitations" || !canManage) return;
    void loadInvitations().catch((err) => setError(err instanceof Error ? err.message : "Unable to load invitations."));
  }, [canManage, orgId, tab]);

  useEffect(() => {
    if (tab !== "library" || !auth.isSignedIn) return;
    void Promise.all([
      api.listEvidences(getToken, orgId),
      api.listMembers(getToken, orgId, { limit: 100 })
    ]).then(([evidenceResult, memberResult]) => {
      setEvidences(evidenceResult.evidences);
      setCreatorMembers(memberResult.members);
    }).catch((err) => setError(err instanceof Error ? err.message : "Unable to load organisation library."));
  }, [auth.isSignedIn, orgId, tab]);

  const updateRole = async (member: ApiMember, role: "moderator" | "member"): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.updateMemberRole(getToken, orgId, member.membershipId, role);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to update member.");
    } finally {
      setBusy(false);
    }
  };

  const removeMember = async (member: ApiMember): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.removeMember(getToken, orgId, member.membershipId);
      await loadMembers();
      await loadShell();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to remove member.");
    } finally {
      setBusy(false);
    }
  };

  const leave = async (): Promise<void> => {
    if (!org || !window.confirm(`Leave ${org.name}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await api.leaveOrganization(getToken, org.id);
      navigate("/organisations");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to leave organisation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthenticatedWebLayout>
      <main className="auth-main org-web-main">
        <header className="auth-main-header">
          <div>
            <button className="auth-button ghost" type="button" onClick={() => navigate("/organisations")}>Back</button>
            <h1 className="auth-page-title">{org?.name ?? "Organisation"}</h1>
            <p className="auth-page-subtitle">{org ? `${org.memberCount} members · your role is ${org.role}` : "Loading organisation..."}</p>
          </div>
          {org?.id === activeOrgId ? <span className="auth-chip">active</span> : null}
        </header>

        <div className="auth-main-content org-web-stack">
          <div className="org-web-tabs">{tabs.map((item) => <button key={item.id} type="button" data-active={tab === item.id} onClick={() => navigate(getTabPath(orgId, item.id))}>{item.label}</button>)}</div>
          {error ? <div className="auth-error-banner">{error}</div> : null}

          {tab === "members" ? (
            <section className="org-web-panel">
              <div className="org-web-toolbar">
                <input className="auth-search" placeholder="Search members" value={memberSearch} onChange={(event) => { setMemberPage(1); setMemberSearch(event.currentTarget.value); }} />
                <select value={roleFilter} onChange={(event) => { setMemberPage(1); setRoleFilter(event.currentTarget.value as RoleFilter); }}>
                  <option value="all">All roles</option>
                  <option value="owner">Owner</option>
                  <option value="moderator">Moderator</option>
                  <option value="member">Member</option>
                </select>
              </div>
              <MembersTable members={membersResult.members} canManage={canManage} isOwner={isOwner} busy={busy} onRoleChange={updateRole} onRemove={removeMember} />
              <Pagination page={memberPage} pages={pages} total={membersResult.total} onPage={setMemberPage} />
            </section>
          ) : null}

          {tab === "invitations" && org ? (
            <InvitationsPanel org={org} canManage={canManage} isOwner={isOwner} busy={busy} codes={codes} invitations={invitations} createdCode={createdCode} setBusy={setBusy} setCreatedCode={setCreatedCode} reload={loadInvitations} setError={setError} />
          ) : null}

          {tab === "library" ? (
            <section className="org-web-panel">
              <table className="org-web-table">
                <thead><tr><th>Evidence</th><th>Creator</th><th>Type</th><th>Updated</th><th>Action</th></tr></thead>
                <tbody>
                  {evidences.map((evidence) => (
                    <tr key={evidence.id}>
                      <td><strong>{evidence.title}</strong><span>{evidence.id}</span></td>
                      <td>{creatorByUserId.get(evidence.createdBy) ?? evidence.createdBy}</td>
                      <td><span className="auth-chip">{evidence.sourceType}</span></td>
                      <td>{formatRelativeTime(evidence.updatedAt)}</td>
                      <td><button className="auth-button ghost" type="button" onClick={() => navigate(`/evidence/${encodeURIComponent(evidence.id)}`)}>Open</button></td>
                    </tr>
                  ))}
                  {evidences.length === 0 ? <tr><td colSpan={5}>No organisation evidence yet.</td></tr> : null}
                </tbody>
              </table>
            </section>
          ) : null}

          {tab === "options" && org ? (
            <section className="org-web-panel org-web-options">
              <OptionRow title="Leave organisation" detail="Remove your membership from this organisation.">
                <button className="auth-button danger" type="button" disabled={busy || org.isPersonal} onClick={() => void leave()}>Leave</button>
              </OptionRow>
              {isOwner ? (
                <OptionRow title="Transfer organisation" detail="Transfer ownership to another member before stepping away.">
                  <button className="auth-button ghost" type="button" disabled>Transfer</button>
                </OptionRow>
              ) : null}
            </section>
          ) : null}
        </div>
      </main>
    </AuthenticatedWebLayout>
  );
}

function MembersTable(props: {
  members: ApiMember[];
  canManage: boolean;
  isOwner: boolean;
  busy: boolean;
  onRoleChange: (member: ApiMember, role: "moderator" | "member") => Promise<void>;
  onRemove: (member: ApiMember) => Promise<void>;
}): React.JSX.Element {
  return (
    <table className="org-web-table">
      <thead><tr><th>User</th><th>Role</th><th>Joined</th><th>Guest until</th><th>Actions</th></tr></thead>
      <tbody>
        {props.members.map((member) => {
          const editable = props.canManage && member.role !== "owner" && (props.isOwner || member.role === "member");
          return (
            <tr key={member.membershipId}>
              <td><strong>{memberName(member)}</strong><span>{member.email ?? "No email"}</span></td>
              <td><span className="auth-chip">{member.role}</span></td>
              <td>{formatRelativeTime(member.joinedAt)}</td>
              <td>{member.guestExpiresAt ? formatRelativeTime(member.guestExpiresAt) : "Permanent"}</td>
              <td><div className="org-web-actions">{editable && props.isOwner ? <select value={member.role === "moderator" ? "moderator" : "member"} disabled={props.busy} onChange={(event) => void props.onRoleChange(member, event.currentTarget.value as "moderator" | "member")}><option value="member">Member</option><option value="moderator">Moderator</option></select> : null}{editable ? <button className="auth-button ghost" type="button" disabled={props.busy} onClick={() => void props.onRemove(member)}>Remove</button> : null}</div></td>
            </tr>
          );
        })}
        {props.members.length === 0 ? <tr><td colSpan={5}>No members match this filter.</td></tr> : null}
      </tbody>
    </table>
  );
}

function Pagination(props: { page: number; pages: number; total: number; onPage: (page: number) => void }): React.JSX.Element {
  return (
    <div className="org-web-pagination">
      <span className="auth-muted">{props.total} member{props.total === 1 ? "" : "s"}</span>
      <div className="org-web-actions">
        <button className="auth-button ghost" type="button" disabled={props.page <= 1} onClick={() => props.onPage(props.page - 1)}>Previous</button>
        <span className="auth-muted">Page {props.page} of {props.pages}</span>
        <button className="auth-button ghost" type="button" disabled={props.page >= props.pages} onClick={() => props.onPage(props.page + 1)}>Next</button>
      </div>
    </div>
  );
}

function OptionRow(props: { title: string; detail: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="org-web-option-row"><div><h3>{props.title}</h3><p>{props.detail}</p></div>{props.children}</div>;
}

function InvitationsPanel(props: {
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
  setError: (error: string | null) => void;
}): React.JSX.Element {
  const auth = useAuth();
  const form = useForm<CodeValues>({
    resolver: zodResolver(codeSchema),
    defaultValues: { label: "Team onboarding", role: "member", password: "", emailDomain: "", expiresDays: "", guestDays: "" }
  });
  const [showCreate, setShowCreate] = useState(false);
  const getToken = () => auth.getToken();

  const createCode = async (values: CodeValues): Promise<void> => {
    props.setBusy(true);
    props.setError(null);
    try {
      const result = await api.createInvitationCode(getToken, props.org.id, {
        label: values.label,
        role: values.role,
        emailDomain: values.emailDomain || null,
        expiresAt: values.expiresDays ? Date.now() + Number(values.expiresDays) * 24 * 60 * 60 * 1000 : null,
        guestExpiresAfterDays: values.guestDays ? Number(values.guestDays) : null,
        ...(values.password?.trim() ? { password: values.password.trim() } : {})
      });
      props.setCreatedCode(result.code);
      form.setValue("password", "");
      setShowCreate(false);
      await props.reload();
    } catch (err) {
      props.setError(err instanceof Error ? err.message : "Unable to create invitation code.");
    } finally {
      props.setBusy(false);
    }
  };

  const toggleCode = async (code: ApiInvitationCode): Promise<void> => {
    props.setBusy(true);
    props.setError(null);
    try {
      await api.setInvitationCodeLocked(getToken, props.org.id, code.id, !code.lockedAt);
      await props.reload();
    } catch (err) {
      props.setError(err instanceof Error ? err.message : "Unable to update invitation code.");
    } finally {
      props.setBusy(false);
    }
  };

  const deleteCode = async (code: ApiInvitationCode): Promise<void> => {
    props.setBusy(true);
    props.setError(null);
    try {
      await api.deleteInvitationCode(getToken, props.org.id, code.id);
      await props.reload();
    } catch (err) {
      props.setError(err instanceof Error ? err.message : "Unable to delete invitation code.");
    } finally {
      props.setBusy(false);
    }
  };

  if (!props.canManage) {
    return <div className="auth-empty"><h3>Member access</h3><p>Owners and moderators manage invitation codes.</p></div>;
  }

  return (
    <section className="org-web-panel org-web-stack">
      <div className="org-web-section-header">
        <div>
          <h2>Invitation codes</h2>
          <p>Reusable codes for member onboarding.</p>
        </div>
        <button className="auth-button primary" type="button" onClick={() => setShowCreate(true)} disabled={props.busy || props.codes.length >= 3}>Create</button>
      </div>
      {props.createdCode ? <div className="invite-token-box"><span className="detail-label">New static joining code</span><span>{props.createdCode.code}</span><button className="auth-button ghost" type="button" onClick={() => props.setCreatedCode(null)}>Done</button></div> : null}
      <table className="org-web-table">
        <thead><tr><th>Code</th><th>Restrictions</th><th>Guest</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>
          {props.codes.map((code) => (
            <tr key={code.id}>
              <td><strong>{code.label}</strong><span>{code.role}</span></td>
              <td>{[code.hasPassword ? "password" : null, code.emailDomain ? `@${code.emailDomain}` : null, code.expiresAt ? `expires ${formatRelativeTime(code.expiresAt)}` : null].filter(Boolean).join(" · ") || "None"}</td>
              <td>{code.guestExpiresAfterDays ? `${code.guestExpiresAfterDays} days` : "Permanent"}</td>
              <td><span className="auth-chip">{code.lockedAt ? "locked" : "active"}</span></td>
              <td><div className="org-web-actions">{props.isOwner ? <button className="auth-button ghost" type="button" disabled={props.busy} onClick={() => void toggleCode(code)}>{code.lockedAt ? "Unlock" : "Lock"}</button> : null}<button className="auth-button ghost" type="button" disabled={props.busy} onClick={() => void deleteCode(code)}>Delete</button></div></td>
            </tr>
          ))}
          {props.codes.length === 0 ? <tr><td colSpan={5}>No static codes yet.</td></tr> : null}
        </tbody>
      </table>
      {props.invitations.length > 0 ? (
        <table className="org-web-table">
          <thead><tr><th>Direct invitation</th><th>Role</th><th>Status</th></tr></thead>
          <tbody>{props.invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td>{invitation.role}</td><td>{invitation.status}</td></tr>)}</tbody>
        </table>
      ) : null}
      {showCreate ? (
        <WebDialog
          title="Create invitation code"
          onClose={() => setShowCreate(false)}
          footer={<><button className="auth-button ghost" type="button" onClick={() => setShowCreate(false)} disabled={props.busy}>Cancel</button><button className="auth-button primary" type="button" onClick={() => void form.handleSubmit(createCode)()} disabled={props.busy}>{props.busy ? "Creating..." : "Create"}</button></>}
        >
          <form className="org-web-dialog-form" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(createCode)(event); }}>
            <label className="field"><span>Label</span><input className="input field-input" autoFocus {...form.register("label")} />{form.formState.errors.label ? <span className="field-error">{form.formState.errors.label.message}</span> : null}</label>
            <label className="field"><span>Role</span><select className="select field-input" {...form.register("role")}><option value="member">Member</option><option value="moderator">Moderator</option></select></label>
            <label className="field"><span>Password</span><input className="input field-input" type="password" placeholder="Optional" {...form.register("password")} /></label>
            <label className="field"><span>Email domain</span><input className="input field-input" placeholder="littlelives.com" {...form.register("emailDomain")} />{form.formState.errors.emailDomain ? <span className="field-error">{form.formState.errors.emailDomain.message}</span> : null}</label>
            <label className="field"><span>Code expires in days</span><input className="input field-input" type="number" min="1" placeholder="No expiry" {...form.register("expiresDays")} />{form.formState.errors.expiresDays ? <span className="field-error">{form.formState.errors.expiresDays.message}</span> : null}</label>
            <label className="field"><span>Guest days</span><select className="select field-input" {...form.register("guestDays")}><option value="">Permanent</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
          </form>
        </WebDialog>
      ) : null}
    </section>
  );
}

function CreateOrganizationDialog(props: {
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onCreated: (organization: ApiOrgSummary) => Promise<void>;
}): React.JSX.Element {
  const form = useForm<CreateOrgValues>({ resolver: zodResolver(createOrgSchema), defaultValues: { name: "" } });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: CreateOrgValues): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.createOrganization(props.getToken, values.name.trim());
      await props.onCreated(result.organization);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create organisation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WebDialog title="Create organisation" onClose={props.onClose} footer={<><button className="auth-button ghost" type="button" onClick={props.onClose} disabled={busy}>Cancel</button><button className="auth-button primary" type="button" onClick={() => void form.handleSubmit(submit)()} disabled={busy}>{busy ? "Creating..." : "Create"}</button></>}>
      <form className="org-web-dialog-form" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(submit)(event); }}>
        <label className="field"><span>Name</span><input className="input field-input" autoFocus {...form.register("name")} />{form.formState.errors.name ? <span className="field-error">{form.formState.errors.name.message}</span> : null}</label>
      </form>
      {error ? <div className="auth-error-banner">{error}</div> : null}
    </WebDialog>
  );
}

function AcceptInvitationDialog(props: {
  getToken: () => Promise<string | null>;
  onClose: () => void;
  onAccepted: (orgId: string) => Promise<void>;
}): React.JSX.Element {
  const form = useForm<AcceptInvitationValues>({ resolver: zodResolver(acceptInvitationSchema), defaultValues: { token: "", password: "" } });
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (values: AcceptInvitationValues): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (!requiresPassword) {
        const lookup = await api.lookupInvitation(props.getToken, values.token.trim()).catch(() => null);
        if (lookup?.code.requiresPassword) {
          setRequiresPassword(true);
          setError("This invitation code requires a password.");
          return;
        }
      }
      if (requiresPassword && !values.password) {
        setError("Enter the invitation password.");
        return;
      }
      const result = await api.acceptInvitationWithPassword(props.getToken, values.token.trim(), requiresPassword ? values.password : undefined);
      await props.onAccepted(result.organizationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to accept invitation.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <WebDialog title="Accept invitation" onClose={props.onClose} footer={<><button className="auth-button ghost" type="button" onClick={props.onClose} disabled={busy}>Cancel</button><button className="auth-button primary" type="button" onClick={() => void form.handleSubmit(submit)()} disabled={busy}>{busy ? "Joining..." : "Join"}</button></>}>
      <form className="org-web-dialog-form" onSubmit={(event) => { event.preventDefault(); void form.handleSubmit(submit)(event); }}>
        <label className="field"><span>Invitation code</span><input className="input field-input auth-mono" autoFocus {...form.register("token")} />{form.formState.errors.token ? <span className="field-error">{form.formState.errors.token.message}</span> : null}</label>
        {requiresPassword ? <label className="field"><span>Password</span><input className="input field-input" type="password" {...form.register("password")} /></label> : null}
      </form>
      {error ? <div className="auth-error-banner">{error}</div> : null}
    </WebDialog>
  );
}

function WebDialog(props: {
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <BaseDialog.Root
      open
      onOpenChange={(open) => {
        if (!open) props.onClose();
      }}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className="ui-dialog-backdrop" />
        <BaseDialog.Viewport className="ui-dialog-viewport">
          <BaseDialog.Popup className="ui-dialog">
            <div className="ui-dialog-header">
              <BaseDialog.Title className="ui-dialog-title" id="web-dialog-title">{props.title}</BaseDialog.Title>
              <BaseDialog.Close className="ui-dialog-close" type="button" aria-label="Close"><X aria-hidden size={16} strokeWidth={2} /></BaseDialog.Close>
            </div>
            <div className="ui-dialog-body">{props.children}</div>
            {props.footer ? <div className="ui-dialog-footer">{props.footer}</div> : null}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
