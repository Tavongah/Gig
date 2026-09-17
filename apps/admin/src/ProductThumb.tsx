import {
  CATALOG_CATEGORIES,
  displayCategory,
  friendlyCatalogStatus,
  statusTone
} from "./commerceAdminUi";

type ThumbProps = {
  src?: string | null;
  alt: string;
  size?: "sm" | "md" | "lg" | "hero";
  className?: string;
};

export function ProductThumb({ src, alt, size = "md", className = "" }: ThumbProps) {
  return (
    <div className={`product-thumb product-thumb-${size} ${className}`.trim()} aria-hidden={!src}>
      {src ? (
        <img src={src} alt={alt} loading="lazy" decoding="async" />
      ) : (
        <span className="product-thumb-placeholder">{alt.slice(0, 1).toUpperCase() || "?"}</span>
      )}
    </div>
  );
}

export function StatusBadge({ status }: { status: string }) {
  return <span className={`status-badge tone-${statusTone(status)}`}>{friendlyCatalogStatus(status)}</span>;
}

export function CategorySelect({
  value,
  onChange,
  id
}: {
  value: string;
  onChange: (next: string) => void;
  id?: string;
}) {
  const options: string[] = [...CATALOG_CATEGORIES];
  if (value && !options.some((c) => c.toLowerCase() === value.toLowerCase())) {
    options.unshift(value);
  }

  return (
    <select id={id} className="commerce-select" value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((c) => (
        <option key={c} value={c}>
          {displayCategory(c)}
        </option>
      ))}
    </select>
  );
}
