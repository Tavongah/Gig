import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/v1";
const TOKEN_KEY = "gigflow_admin_token";

interface Overview {
  users: number;
  workers: number;
  pendingWorkers: number;
  openGigs: number;
  completedGigs: number;
  grossVolumeCents: number;
  platformRevenueCents: number;
  commissionRate: number;
}

interface PendingWorker {
  id: string;
  email: string;
  fullName: string;
  phoneNumber: string | null;
  accountStatus: string;
  createdAt: string;
  workerProfile: {
    city: string | null;
    serviceArea: string | null;
    serviceCategories: Array<{ id: string; name: string }>;
  } | null;
}

interface AdminUser {
  id: string;
  email: string;
  fullName: string;
  roles: string[];
  accountStatus: string;
  createdAt: string;
}

interface AdminGig {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  client?: { fullName: string };
}

type AdminTab = "overview" | "pending" | "users" | "gigs";

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const response = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    }
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(body?.message ?? body?.error ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function LoginPanel({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("admin@gigflow.local");
  const [password, setPassword] = useState("Admin123!");

  const loginMutation = useMutation({
    mutationFn: () =>
      fetch(`${apiUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      }).then(async (response) => {
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? "Login failed");
        }
        const session = (await response.json()) as { token: string; user: { roles: string[] } };
        if (!session.user.roles.includes("ADMIN")) {
          throw new Error("This account is not an admin.");
        }
        return session;
      }),
    onSuccess: ({ token }) => {
      localStorage.setItem(TOKEN_KEY, token);
      onSuccess();
    }
  });

  return (
    <section className="login">
      <p className="eyebrow">Admin access</p>
      <h1>Sign in to GIGFLOW Ops</h1>
      <p className="notice">Use the seeded admin account: admin@gigflow.local / Admin123!</p>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      <button type="button" onClick={() => loginMutation.mutate()} disabled={loginMutation.isPending}>
        {loginMutation.isPending ? "Signing in..." : "Sign in"}
      </button>
      {loginMutation.error ? <p className="notice">{loginMutation.error.message}</p> : null}
    </section>
  );
}

const cards = [
  ["Users", "users"],
  ["Workers", "workers"],
  ["Pending approvals", "pendingWorkers"],
  ["Open gigs", "openGigs"],
  ["Completed gigs", "completedGigs"],
  ["Gross volume", "grossVolumeCents"],
  ["Platform revenue", "platformRevenueCents"]
] as const;

function formatValue(key: keyof Overview, value: number): string {
  if (key.endsWith("Cents")) {
    return `$${(value / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  }

  return value.toLocaleString();
}

function PendingWorkersTable({
  workers,
  isLoading,
  onApprove,
  onReject,
  actionsDisabled
}: {
  workers: PendingWorker[];
  isLoading: boolean;
  onApprove: (workerId: string) => void;
  onReject: (workerId: string) => void;
  actionsDisabled: boolean;
}) {
  if (isLoading) {
    return <p className="notice">Loading pending applications...</p>;
  }

  if (workers.length === 0) {
    return <p className="notice">No pending applications.</p>;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Email</th>
          <th>Phone</th>
          <th>Services</th>
          <th>City</th>
          <th>Submitted</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {workers.map((worker) => (
          <tr key={worker.id}>
            <td>{worker.fullName}</td>
            <td>{worker.email}</td>
            <td>{worker.phoneNumber ?? "—"}</td>
            <td>{worker.workerProfile?.serviceCategories.map((c) => c.name).join(", ") ?? "—"}</td>
            <td>{worker.workerProfile?.city ?? worker.workerProfile?.serviceArea ?? "—"}</td>
            <td>{new Date(worker.createdAt).toLocaleDateString()}</td>
            <td className="actions">
              <button type="button" onClick={() => onApprove(worker.id)} disabled={actionsDisabled}>
                Approve
              </button>
              <button type="button" onClick={() => onReject(worker.id)} disabled={actionsDisabled}>
                Reject
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function App() {
  const queryClient = useQueryClient();
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [commissionInput, setCommissionInput] = useState("20");
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");

  useEffect(() => {
    async function validateSession(): Promise<void> {
      const token = getToken();
      if (!token) {
        setAuthChecked(true);
        return;
      }

      try {
        const { user } = await apiRequest<{ user: { roles: string[] } }>("/auth/me");
        if (!user.roles.includes("ADMIN")) {
          localStorage.removeItem(TOKEN_KEY);
          setAuthenticated(false);
        } else {
          setAuthenticated(true);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        setAuthenticated(false);
      } finally {
        setAuthChecked(true);
      }
    }

    void validateSession();
  }, []);

  const overviewQuery = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiRequest<Overview>("/admin/overview"),
    enabled: authenticated,
    retry: false
  });

  const pendingQuery = useQuery({
    queryKey: ["admin-pending-workers"],
    queryFn: () => apiRequest<{ workers: PendingWorker[] }>("/admin/workers/pending"),
    enabled: authenticated,
    retry: false
  });

  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => apiRequest<{ users: AdminUser[] }>("/admin/users"),
    enabled: authenticated && activeTab === "users"
  });

  const gigsQuery = useQuery({
    queryKey: ["admin-gigs"],
    queryFn: () => apiRequest<{ gigs: AdminGig[] }>("/admin/gigs"),
    enabled: authenticated && activeTab === "gigs"
  });

  const approveMutation = useMutation({
    mutationFn: (workerId: string) => apiRequest(`/admin/workers/${workerId}/approve`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-pending-workers"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (workerId: string) =>
      apiRequest(`/admin/workers/${workerId}/reject`, { method: "POST", body: JSON.stringify({}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-pending-workers"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-overview"] });
    }
  });

  const commissionMutation = useMutation({
    mutationFn: () => apiRequest("/admin/commission", { method: "POST", body: JSON.stringify({ rate: Number(commissionInput) / 100 }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-overview"] })
  });

  if (!authChecked) {
    return (
      <main className="login-layout">
        <p className="notice">Checking admin session...</p>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="login-layout">
        <LoginPanel onSuccess={() => setAuthenticated(true)} />
      </main>
    );
  }

  const overview =
    overviewQuery.data ??
    ({
      users: 0,
      workers: 0,
      pendingWorkers: 0,
      openGigs: 0,
      completedGigs: 0,
      grossVolumeCents: 0,
      platformRevenueCents: 0,
      commissionRate: 0.2
    } satisfies Overview);

  const pendingWorkers = pendingQuery.data?.workers ?? [];
  const pendingCount = overview.pendingWorkers || pendingWorkers.length;

  return (
    <main>
      <aside>
        <div className="logo">GIGFLOW</div>
        <nav>
          {(
            [
              ["Overview", "overview"],
              ["Pending workers", "pending"],
              ["Users", "users"],
              ["Gigs", "gigs"]
            ] as const
          ).map(([label, tab]) => (
            <button key={tab} type="button" className={activeTab === tab ? "nav-active" : ""} onClick={() => setActiveTab(tab)}>
              {label}
              {tab === "pending" && pendingCount > 0 ? <span className="nav-badge">{pendingCount}</span> : null}
            </button>
          ))}
        </nav>
        <button
          type="button"
          className="sign-out"
          onClick={() => {
            localStorage.removeItem(TOKEN_KEY);
            setAuthenticated(false);
          }}
        >
          Sign out
        </button>
      </aside>
      <section className="content">
        <header>
          <div>
            <p className="eyebrow">Operations dashboard</p>
            <h1>Marketplace command center</h1>
          </div>
          <div className="commission">{Math.round(overview.commissionRate * 100)}% commission</div>
        </header>

        {overviewQuery.error ? <p className="notice">{overviewQuery.error.message}</p> : null}

        {pendingCount > 0 && activeTab === "overview" ? (
          <section className="panel alert-panel">
            <h2>{pendingCount} worker application{pendingCount === 1 ? "" : "s"} awaiting review</h2>
            <p>Review and approve workers so they can accept gigs on the platform.</p>
            <button type="button" onClick={() => setActiveTab("pending")}>
              Review pending workers
            </button>
          </section>
        ) : null}

        {activeTab === "overview" ? (
          <>
            <div className="grid">
              {cards.map(([label, key]) => (
                <article key={key} className={key === "pendingWorkers" && overview.pendingWorkers > 0 ? "highlight-card" : ""}>
                  <span>{label}</span>
                  <strong>{formatValue(key, overview[key])}</strong>
                </article>
              ))}
            </div>

            {pendingWorkers.length > 0 ? (
              <section className="panel">
                <h2>Pending worker applications</h2>
                <PendingWorkersTable
                  workers={pendingWorkers}
                  isLoading={pendingQuery.isLoading}
                  onApprove={(workerId) => approveMutation.mutate(workerId)}
                  onReject={(workerId) => rejectMutation.mutate(workerId)}
                  actionsDisabled={approveMutation.isPending || rejectMutation.isPending}
                />
              </section>
            ) : null}

            <section className="panel">
              <h2>Commission settings</h2>
              <div className="commission-form">
                <input type="number" min={5} max={35} value={commissionInput} onChange={(event) => setCommissionInput(event.target.value)} />
                <span>% platform fee</span>
                <button type="button" onClick={() => commissionMutation.mutate()} disabled={commissionMutation.isPending}>
                  {commissionMutation.isPending ? "Saving..." : "Update commission"}
                </button>
              </div>
            </section>
          </>
        ) : null}

        {activeTab === "pending" ? (
          <section className="panel">
            <h2>Pending worker applications</h2>
            {pendingQuery.error ? <p className="notice">{pendingQuery.error.message}</p> : null}
            <PendingWorkersTable
              workers={pendingWorkers}
              isLoading={pendingQuery.isLoading}
              onApprove={(workerId) => approveMutation.mutate(workerId)}
              onReject={(workerId) => rejectMutation.mutate(workerId)}
              actionsDisabled={approveMutation.isPending || rejectMutation.isPending}
            />
          </section>
        ) : null}

        {activeTab === "users" ? (
          <section className="panel">
            <h2>All users</h2>
            {usersQuery.error ? <p className="notice">{usersQuery.error.message}</p> : null}
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Roles</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {(usersQuery.data?.users ?? []).map((user) => (
                  <tr key={user.id}>
                    <td>{user.fullName}</td>
                    <td>{user.email}</td>
                    <td>{user.roles.join(", ")}</td>
                    <td>{user.accountStatus}</td>
                    <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {activeTab === "gigs" ? (
          <section className="panel">
            <h2>Posted gigs</h2>
            {gigsQuery.error ? <p className="notice">{gigsQuery.error.message}</p> : null}
            <table className="data-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Posted</th>
                </tr>
              </thead>
              <tbody>
                {(gigsQuery.data?.gigs ?? []).map((gig) => (
                  <tr key={gig.id}>
                    <td>{gig.title}</td>
                    <td>{gig.client?.fullName ?? "—"}</td>
                    <td>{gig.status}</td>
                    <td>{new Date(gig.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}
      </section>
    </main>
  );
}
