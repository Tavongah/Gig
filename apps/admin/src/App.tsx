import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/v1";
const TOKEN_KEY = "gigflow_admin_token";

interface Overview {
  users: number;
  workers: number;
  openGigs: number;
  completedGigs: number;
  grossVolumeCents: number;
  platformRevenueCents: number;
  commissionRate: number;
}

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
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

function LoginPanel({ onSuccess }: { onSuccess: () => void }) {
  const [email, setEmail] = useState("admin@gigflow.local");
  const [fullName, setFullName] = useState("GigFlow Admin");

  const loginMutation = useMutation({
    mutationFn: () =>
      fetch(`${apiUrl}/auth/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, fullName, role: "ADMIN" })
      }).then(async (response) => {
        if (!response.ok) {
          throw new Error("Login failed");
        }
        return response.json() as Promise<{ token: string }>;
      }),
    onSuccess: ({ token }) => {
      localStorage.setItem(TOKEN_KEY, token);
      onSuccess();
    }
  });

  return (
    <section className="login">
      <p className="eyebrow">Admin access</p>
      <h1>Sign in to GigFlow Ops</h1>
      <p className="notice">Use the seeded admin account or any user promoted to ADMIN in the database.</p>
      <label>
        Email
        <input value={email} onChange={(event) => setEmail(event.target.value)} />
      </label>
      <label>
        Full name
        <input value={fullName} onChange={(event) => setFullName(event.target.value)} />
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

export function App() {
  const queryClient = useQueryClient();
  const [authenticated, setAuthenticated] = useState(Boolean(getToken()));
  const [commissionInput, setCommissionInput] = useState("20");

  const overviewQuery = useQuery({
    queryKey: ["admin-overview"],
    queryFn: () => apiRequest<Overview>("/admin/overview"),
    enabled: authenticated,
    retry: false
  });

  const commissionMutation = useMutation({
    mutationFn: () => apiRequest("/admin/commission", { method: "POST", body: JSON.stringify({ rate: Number(commissionInput) / 100 }) }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["admin-overview"] })
  });

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
      openGigs: 0,
      completedGigs: 0,
      grossVolumeCents: 0,
      platformRevenueCents: 0,
      commissionRate: 0.2
    } satisfies Overview);

  return (
    <main>
      <aside>
        <div className="logo">GigFlow</div>
        <nav>
          {["Overview", "Users", "Categories", "Commission"].map((item) => (
            <a key={item}>{item}</a>
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

        <div className="grid">
          {cards.map(([label, key]) => (
            <article key={key}>
              <span>{label}</span>
              <strong>{formatValue(key, overview[key])}</strong>
            </article>
          ))}
        </div>

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

        <section className="panel">
          <h2>Launch checklist</h2>
          <ul>
            <li>Monitor worker supply by category and city.</li>
            <li>Review high-urgency gigs and cancellations.</li>
            <li>Tune commission and category pricing before scaling spend.</li>
            <li>Connect Stripe Connect before enabling live payouts.</li>
          </ul>
        </section>
      </section>
    </main>
  );
}
