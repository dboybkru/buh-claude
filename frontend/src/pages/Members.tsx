// Sprint 9: organization members + invitations page.
// Lists members of an organization and lets OWNER/ADMIN invite new ones,
// change role, or remove. Backend gates the actions; we mirror them in the
// UI so disabled buttons make sense at a glance.

import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, UserPlus, Trash2, Shield } from "lucide-react";

import { api, extractApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Role = "OWNER" | "ADMIN" | "ACCOUNTANT" | "VIEWER";
type Status = "ACTIVE" | "INVITED" | "DISABLED";

interface Member {
  id: string;
  organizationId: string;
  userId: string | null;
  role: Role;
  status: Status;
  invitedEmail: string | null;
  createdAt: string;
  user: { id: string; email: string; fullName: string } | null;
  invitedBy: { id: string; email: string; fullName: string } | null;
}

const ROLE_LABEL: Record<Role, string> = {
  OWNER: "Владелец",
  ADMIN: "Администратор",
  ACCOUNTANT: "Бухгалтер",
  VIEWER: "Наблюдатель",
};

const STATUS_LABEL: Record<Status, string> = {
  ACTIVE: "активен",
  INVITED: "приглашён",
  DISABLED: "отключён",
};

const ROLE_RANK: Record<Role, number> = { VIEWER: 0, ACCOUNTANT: 1, ADMIN: 2, OWNER: 3 };

/** Returns the caller's role in this org by looking themselves up in the list. */
function findOwnRole(members: Member[], userId: string | null): Role | null {
  if (!userId) return null;
  const m = members.find((m) => m.userId === userId && m.status === "ACTIVE");
  return m?.role ?? null;
}

function roleBadgeVariant(role: Role): "default" | "secondary" | "outline" {
  if (role === "OWNER") return "default";
  if (role === "ADMIN") return "secondary";
  return "outline";
}

export function MembersPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("ACCOUNTANT");

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await api.get<{ user: { id: string; email: string } }>("/auth/me")).data.user,
  });

  const membersQuery = useQuery<Member[]>({
    queryKey: ["org-members", orgId],
    queryFn: async () => (await api.get<Member[]>(`/organizations/${orgId}/members`)).data,
    enabled: !!orgId,
  });

  const ownRole = findOwnRole(membersQuery.data ?? [], meQuery.data?.id ?? null);
  const canInvite = ownRole === "OWNER" || ownRole === "ADMIN";
  const canManage = ownRole === "OWNER" || ownRole === "ADMIN";

  const inviteMutation = useMutation({
    mutationFn: async () =>
      (await api.post<Member>(`/organizations/${orgId}/members/invite`, {
        email: inviteEmail,
        role: inviteRole,
      })).data,
    onSuccess: () => {
      toast.success("Приглашение отправлено");
      setInviteEmail("");
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ memberId, role, status }: { memberId: string; role?: Role; status?: Status }) =>
      (await api.patch<Member>(`/organizations/${orgId}/members/${memberId}`, { role, status })).data,
    onSuccess: () => {
      toast.success("Сохранено");
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  const removeMutation = useMutation({
    mutationFn: async (memberId: string) =>
      (await api.delete(`/organizations/${orgId}/members/${memberId}`)).data,
    onSuccess: () => {
      toast.success("Участник удалён");
      qc.invalidateQueries({ queryKey: ["org-members", orgId] });
    },
    onError: (err) => toast.error(extractApiError(err).message),
  });

  if (!orgId) return null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5" /> Участники организации
        </h1>
        <Link to="/organizations" className="text-sm text-muted-foreground hover:underline">
          ← к списку организаций
        </Link>
      </div>

      {canInvite && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Пригласить участника
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[220px]">
              <label className="text-xs text-muted-foreground" htmlFor="invite-email">Email</label>
              <Input
                id="invite-email"
                type="email"
                placeholder="user@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
            </div>
            <div className="min-w-[180px]">
              <label className="text-xs text-muted-foreground">Роль</label>
              <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ownRole === "OWNER" && <SelectItem value="ADMIN">Администратор</SelectItem>}
                  <SelectItem value="ACCOUNTANT">Бухгалтер</SelectItem>
                  <SelectItem value="VIEWER">Наблюдатель</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="button"
              disabled={!inviteEmail || inviteMutation.isPending}
              onClick={() => inviteMutation.mutate()}
            >
              {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
              Пригласить
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Участники {membersQuery.data && <span className="text-muted-foreground">({membersQuery.data.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {membersQuery.isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
            </div>
          ) : membersQuery.error ? (
            <div className="text-destructive text-sm">{extractApiError(membersQuery.error).message}</div>
          ) : (
            <div className="divide-y">
              {(membersQuery.data ?? []).map((m) => {
                const isSelf = m.userId && m.userId === meQuery.data?.id;
                const targetRank = ROLE_RANK[m.role];
                const actorRank = ownRole ? ROLE_RANK[ownRole] : -1;
                // Mirror backend canManageMember: OWNER → anyone;
                // ADMIN → !OWNER; others → nobody.
                const canEditThis =
                  canManage &&
                  (ownRole === "OWNER" || (ownRole === "ADMIN" && m.role !== "OWNER")) &&
                  actorRank >= targetRank &&
                  !(isSelf && m.role === "OWNER");
                return (
                  <div key={m.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-[200px]">
                      <div className="font-medium">
                        {m.user?.fullName ?? m.invitedEmail ?? "(без имени)"}
                        {isSelf && <span className="ml-2 text-xs text-muted-foreground">(это вы)</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {m.user?.email ?? m.invitedEmail ?? "—"}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={roleBadgeVariant(m.role)}>{ROLE_LABEL[m.role]}</Badge>
                      <Badge variant="outline">{STATUS_LABEL[m.status]}</Badge>
                    </div>
                    {canEditThis && (
                      <div className="flex items-center gap-2">
                        <Select
                          value={m.role}
                          onValueChange={(v) => updateMutation.mutate({ memberId: m.id, role: v as Role })}
                        >
                          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {ownRole === "OWNER" && <SelectItem value="OWNER">Владелец</SelectItem>}
                            {ownRole === "OWNER" && <SelectItem value="ADMIN">Администратор</SelectItem>}
                            <SelectItem value="ACCOUNTANT">Бухгалтер</SelectItem>
                            <SelectItem value="VIEWER">Наблюдатель</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (confirm(`Удалить ${m.user?.email ?? m.invitedEmail}?`)) {
                              removeMutation.mutate(m.id);
                            }
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
