import { useCallback, useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  coordsEqual,
  formatAccuracyMessage,
  geolocationErrorMessage,
  hasValidCoordinates,
  isPoorGpsAccuracy,
  isValidLatitude,
  isValidLongitude,
  parseCoordinate,
  roundCoord,
  type LocationSuggestion,
  type MerchantLocationValue
} from "./merchantLocation";

type ApiRequest = <T>(path: string, options?: RequestInit) => Promise<T>;

type Props = {
  apiRequest: ApiRequest;
  value: MerchantLocationValue;
  onChange: (next: MerchantLocationValue) => void;
  confirmed: boolean;
  onConfirmedChange: (confirmed: boolean) => void;
};

// Default Leaflet marker icons break under Vite bundling — use CDN icons.
const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const DEFAULT_CENTER: L.LatLngExpression = [-17.8292, 31.0522]; // Harare

export function MerchantLocationPicker({
  apiRequest,
  value,
  onChange,
  confirmed,
  onConfirmedChange
}: Props) {
  const mapEl = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const skipMoveRef = useRef(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [gpsBusy, setGpsBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>("");
  const [statusTone, setStatusTone] = useState<"ok" | "warn" | "err" | "">("");
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [manualLat, setManualLat] = useState(value.latitude);
  const [manualLng, setManualLng] = useState(value.longitude);
  const [manualError, setManualError] = useState("");

    const applyCoords = useCallback(
    (lat: number, lng: number, label?: string, opts?: { keepLabel?: boolean }) => {
      const next: MerchantLocationValue = {
        latitude: roundCoord(lat),
        longitude: roundCoord(lng),
        locationLabel: opts?.keepLabel ? value.locationLabel : label?.trim() || value.locationLabel
      };
      const moved = !coordsEqual(value, next);
      const labelChanged = next.locationLabel !== value.locationLabel;
      if (moved || (labelChanged && !opts?.keepLabel)) {
        onConfirmedChange(false);
      }
      onChange(next);
      setManualLat(next.latitude);
      setManualLng(next.longitude);
    },
    [onChange, onConfirmedChange, value]
  );

  // Init map once
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return;

    const lat = parseCoordinate(value.latitude);
    const lng = parseCoordinate(value.longitude);
    const center: L.LatLngExpression =
      lat != null && lng != null ? [lat, lng] : DEFAULT_CENTER;

    const map = L.map(mapEl.current, {
      zoomControl: true,
      attributionControl: true
    }).setView(center, lat != null ? 16 : 12);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
    }).addTo(map);

    const marker = L.marker(center, { draggable: true, icon: markerIcon }).addTo(map);

    marker.on("dragend", () => {
      const p = marker.getLatLng();
      applyCoords(p.lat, p.lng, undefined, { keepLabel: true });
      setStatusMsg("Pin moved — confirm the shop location.");
      setStatusTone("warn");
    });

    map.on("click", (e: L.LeafletMouseEvent) => {
      skipMoveRef.current = true;
      marker.setLatLng(e.latlng);
      applyCoords(e.latlng.lat, e.latlng.lng, undefined, { keepLabel: true });
      setStatusMsg("Pin placed — confirm the shop location.");
      setStatusTone("warn");
    });

    mapRef.current = map;
    markerRef.current = marker;

    // Invalidate size after layout (admin panels/mobile).
    const t = window.setTimeout(() => map.invalidateSize(), 80);

    return () => {
      window.clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once
  }, []);

  // Sync marker when external value changes (edit merchant load / manual)
  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;
    const lat = parseCoordinate(value.latitude);
    const lng = parseCoordinate(value.longitude);
    if (lat == null || lng == null) return;
    const current = marker.getLatLng();
    if (Math.abs(current.lat - lat) < 1e-7 && Math.abs(current.lng - lng) < 1e-7) return;
    skipMoveRef.current = true;
    marker.setLatLng([lat, lng]);
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [value.latitude, value.longitude]);

  useEffect(() => {
    setManualLat(value.latitude);
    setManualLng(value.longitude);
  }, [value.latitude, value.longitude]);

  async function useCurrentLocation(): Promise<void> {
    if (!navigator.geolocation) {
      setStatusMsg("Couldn't get your location. Search for the shop or place the pin manually.");
      setStatusTone("err");
      return;
    }
    setGpsBusy(true);
    setStatusMsg("");
    setStatusTone("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        applyCoords(latitude, longitude, undefined, { keepLabel: true });
        setStatusMsg(formatAccuracyMessage(accuracy));
        setStatusTone(isPoorGpsAccuracy(accuracy) ? "warn" : "ok");
        setGpsBusy(false);
        mapRef.current?.invalidateSize();
      },
      (err) => {
        setStatusMsg(geolocationErrorMessage(err.code));
        setStatusTone("err");
        setGpsBusy(false);
      },
      { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
    );
  }

  async function runSearch(): Promise<void> {
    const q = searchQuery.trim();
    if (q.length < 3) {
      setStatusMsg("Enter at least 3 characters to search.");
      setStatusTone("warn");
      return;
    }
    setSearchBusy(true);
    setSuggestions([]);
    try {
      const data = await apiRequest<{ suggestions: LocationSuggestion[] }>(
        `/location/autocomplete?q=${encodeURIComponent(q)}`
      );
      const list = data.suggestions ?? [];
      setSuggestions(list);
      if (list.length === 0) {
        setStatusMsg("Couldn't find that place. Try another search or place the pin on the map.");
        setStatusTone("warn");
      } else {
        setStatusMsg("");
        setStatusTone("");
      }
    } catch {
      setStatusMsg("Couldn't find that place. Try another search or place the pin on the map.");
      setStatusTone("err");
    } finally {
      setSearchBusy(false);
    }
  }

  async function selectSuggestion(s: LocationSuggestion): Promise<void> {
    setSearchBusy(true);
    try {
      let lat: number | null = null;
      let lng: number | null = null;
      let label = s.label || s.formattedAddress || "";

      // Prefer Google placeId when it looks like one; otherwise geocode the label.
      const looksGoogle = /^ChIJ|^[A-Za-z0-9_-]{20,}$/.test(s.placeId) && !/^\d+$/.test(s.placeId);
      if (looksGoogle) {
        try {
          const place = await apiRequest<{
            location?: { latitude: number; longitude: number };
            address?: { formattedAddress?: string; latitude: number; longitude: number };
          }>(`/location/place/${encodeURIComponent(s.placeId)}`);
          lat = place.location?.latitude ?? place.address?.latitude ?? null;
          lng = place.location?.longitude ?? place.address?.longitude ?? null;
          label = place.address?.formattedAddress || label;
        } catch {
          /* fall through to query geocode */
        }
      }

      if (lat == null || lng == null) {
        const geo = await apiRequest<{
          location?: { latitude: number; longitude: number };
          address?: { formattedAddress?: string; latitude: number; longitude: number };
        }>("/location/geocode", {
          method: "POST",
          body: JSON.stringify({ query: s.formattedAddress || s.label })
        });
        lat = geo.location?.latitude ?? geo.address?.latitude ?? null;
        lng = geo.location?.longitude ?? geo.address?.longitude ?? null;
        label = geo.address?.formattedAddress || label;
      }

      if (lat == null || lng == null) {
        setStatusMsg("Couldn't find that place. Try another search or place the pin on the map.");
        setStatusTone("err");
        return;
      }

      applyCoords(lat, lng, label);
      setSuggestions([]);
      setSearchQuery(label);
      setStatusMsg("Place found — confirm the pin.");
      setStatusTone("ok");
    } catch {
      setStatusMsg("Couldn't find that place. Try another search or place the pin on the map.");
      setStatusTone("err");
    } finally {
      setSearchBusy(false);
    }
  }

  function applyManualCoordinates(): void {
    setManualError("");
    if (!isValidLatitude(manualLat)) {
      setManualError("Latitude must be between -90 and 90.");
      return;
    }
    if (!isValidLongitude(manualLng)) {
      setManualError("Longitude must be between -180 and 180.");
      return;
    }
    const lat = parseCoordinate(manualLat)!;
    const lng = parseCoordinate(manualLng)!;
    applyCoords(lat, lng, undefined, { keepLabel: true });
    setStatusMsg("Coordinates updated — confirm the pin.");
    setStatusTone("warn");
  }

  const ready = hasValidCoordinates(value);

  return (
    <div className="merchant-location">
      <h3 className="merchant-location-title">Shop location</h3>
      <p className="muted merchant-location-help">
        Stand at the shop when possible. Coordinates are authoritative — address search is optional.
      </p>

      <button
        type="button"
        className="merchant-location-gps"
        onClick={() => void useCurrentLocation()}
        disabled={gpsBusy}
      >
        {gpsBusy ? "Getting location…" : "Use current location"}
      </button>

      <div className="merchant-location-search">
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search address or place"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void runSearch();
            }
          }}
        />
        <button type="button" onClick={() => void runSearch()} disabled={searchBusy}>
          {searchBusy ? "Searching…" : "Search"}
        </button>
      </div>

      {suggestions.length > 0 ? (
        <ul className="merchant-location-suggestions">
          {suggestions.map((s) => (
            <li key={s.placeId}>
              <button type="button" onClick={() => void selectSuggestion(s)}>
                {s.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {statusMsg ? (
        <p className={`merchant-location-status tone-${statusTone || "ok"}`}>{statusMsg}</p>
      ) : null}

      <div ref={mapEl} className="merchant-location-map" role="presentation" />

      <label className="merchant-location-label-field">
        Location label
        <input
          value={value.locationLabel}
          onChange={(e) => {
            onChange({ ...value, locationLabel: e.target.value });
          }}
          placeholder="e.g. Glen Norah B, Harare"
        />
      </label>

      {ready && confirmed ? (
        <div className="merchant-location-confirmed">
          <strong>📍 Location confirmed</strong>
          <p>{value.locationLabel || `${value.latitude}, ${value.longitude}`}</p>
          <button type="button" className="secondary" onClick={() => onConfirmedChange(false)}>
            Change location
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="merchant-location-confirm"
          disabled={!ready}
          onClick={() => {
            if (!ready) return;
            onConfirmedChange(true);
            setStatusMsg("📍 Location confirmed");
            setStatusTone("ok");
          }}
        >
          Confirm location
        </button>
      )}

      <details
        className="merchant-location-advanced"
        open={advancedOpen}
        onToggle={(e) => setAdvancedOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary>Advanced — Enter coordinates manually</summary>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label>
            Latitude
            <input
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Longitude
            <input
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
        {manualError ? <p className="notice">{manualError}</p> : null}
        <button type="button" onClick={applyManualCoordinates}>
          Apply coordinates
        </button>
      </details>
    </div>
  );
}
