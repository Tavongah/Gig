import { useQuery } from "@tanstack/react-query";

const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:4000/v1";

interface Overview {
  users: number;
  workers: number;
  openGigs: number;
  completedGigs: number;
  grossVolumeCents: number;
  platformRevenueCents: number;
  commissionRate: number;
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

async function fetchOverview(): Promise<Overview> {
  const token = localStorage.getItem("gigflow_admin_token");
  const response = await fetch(`${apiUrl}/admin/overview`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });

  if (!response.ok) {
    throw new Error("Add an admin JWT to localStorage.gigflow_admin_token to load live data.");
  }

  return response.json() as Promise<Overview>;
}

export function App() {
  const overviewQuery = useQuery({ queryKey: ["admin-overview"], queryFn: fetchOverview, retry: false });
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
          {["Users", "Workers", "Disputes", "Analytics", "Revenue", "Categories", "Commission"].map((item) => (
            <a key={item}>{item}</a>
          ))}
        </nav>
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
          <h2>MVP control priorities</h2>
          <ul>
            <li>Monitor worker supply by category and city.</li>
            <li>Review high-urgency gigs and cancellations.</li>
            <li>Tune commission and category pricing before scaling spend.</li>
            <li>Resolve payment disputes before worker payout release.</li>
          </ul>
        </section>
      </section>
    </main>
  );
}
