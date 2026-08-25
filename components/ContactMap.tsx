"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import type { CardData } from "@/types/card";
import { resolveLocationCoords } from "@/lib/location";

// Default marker icon (Leaflet's bundled icons break under bundlers).
const markerIcon = new L.Icon({
  iconUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl:
    "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

type Point = {
  id: string;
  fullName: string | null;
  company: string | null;
  location: string | null;
  coords: [number, number];
};

interface ContactMapProps {
  contacts: CardData[];
  onViewProfile: (contactId: string) => void;
}

const INDIA_CENTER: [number, number] = [22.5, 79];
// Esri World Street Map — dense street/POI labels, Google-like.
const STREET_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}";

// Esri World Imagery — free for light use, no API key.
const SATELLITE_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
// Esri labels overlay — place/city names drawn over the imagery.
const LABELS_URL =
  "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";

const ESRI_ATTRIBUTION =
  "Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

export default function ContactMap({
  contacts,
  onViewProfile,
}: ContactMapProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const cacheRef = useRef<Map<string, [number, number] | null>>(new Map());

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersRef = useRef<L.Marker[]>([]);

  // Live user location state.
  const [userLocation, setUserLocation] = useState<
    [number, number] | null
  >(null);
  const [userAccuracy, setUserAccuracy] = useState<number>(0);
  const [locStatus, setLocStatus] = useState<
    "idle" | "requesting" | "granted" | "denied" | "error"
  >("idle");
  const watchIdRef = useRef<number | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userCircleRef = useRef<L.Circle | null>(null);

  const userDivIcon = L.divIcon({
    className: "",
    html: '<div class="user-loc-dot"></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });

  const locateMe = () => {
    if (!("geolocation" in navigator)) {
      setLocStatus("error");
      return;
    }

    // Already tracking — do not request again.
    if (watchIdRef.current !== null) {
      return;
    }

    setLocStatus("requesting");

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const coords: [number, number] = [
          pos.coords.latitude,
          pos.coords.longitude,
        ];
        setUserLocation(coords);
        setUserAccuracy(pos.coords.accuracy);
        setLocStatus("granted");
        // mapRef.current?.flyTo(coords, 14);
      },
      (err) => {
        setLocStatus(err.code === 1 ? "denied" : "error");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Initialize the map exactly once. The `mapRef.current` guard makes this
  // StrictMode-safe: the second mount pass becomes a no-op instead of
  // re-initializing the container (which would throw "already initialized").
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: INDIA_CENTER,
      zoom: 5,
      scrollWheelZoom: true,
      zoomControl: true,
      doubleClickZoom: true,
      touchZoom: true,
      maxZoom: 19,
    });

    const street = L.tileLayer(STREET_URL, {
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 19,
    }).addTo(map);

    const satelliteBase = L.tileLayer(SATELLITE_URL, {
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 19,
    });

    const labels = L.tileLayer(LABELS_URL, {
      attribution: ESRI_ATTRIBUTION,
      maxZoom: 19,
    });

    const satellite = L.layerGroup([satelliteBase, labels]);

    L.control
      .layers(
        { Streets: street, "Satellite (Hybrid)": satellite },
        undefined,
        { position: "topright" }
      )
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      markersRef.current = [];
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      userMarkerRef.current = null;
      userCircleRef.current = null;
    };
  }, []);

  // Resolve coordinates for contacts (cached per contact id).
  useEffect(() => {
    let cancelled = false;

    (async () => {
      const resolved: Point[] = [];

      for (const contact of contacts) {
        if (!contact.id) continue;

        let coords = cacheRef.current.get(contact.id);

        if (coords === undefined) {
          coords = await resolveLocationCoords({
            companyLocation: contact.companyLocation,
            address: contact.address,
          });
          cacheRef.current.set(contact.id, coords);
        }

        if (coords) {
          resolved.push({
            id: contact.id,
            fullName: contact.fullName,
            company: contact.company,
            location:
              contact.companyLocation || contact.address || null,
            coords,
          });
        }
      }

      if (!cancelled) {
        setPoints(resolved);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contacts]);

  const center = useMemo<[number, number]>(() => {
    if (points.length === 0) return INDIA_CENTER;
    const latSum = points.reduce((s, p) => s + p.coords[0], 0);
    const lngSum = points.reduce((s, p) => s + p.coords[1], 0);
    return [latSum / points.length, lngSum / points.length];
  }, [points]);

  // Re-render markers whenever the resolved points change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove existing markers.
    for (const marker of markersRef.current) {
      marker.remove();
    }
    markersRef.current = [];

    const handlePopupOpen = (e: L.LeafletEvent) => {
      const id = (e.popup as unknown as { getElement: () => HTMLElement | null })
        .getElement?.()
        ?.getAttribute("data-contact-id");
      if (id) onViewProfile(id);
    };

    map.on("popupopen", handlePopupOpen);

    for (const point of points) {
      const popup = L.popup({ className: "contact-map-popup" });
      popup.setContent(
        `<div class="min-w-[180px]">
           <p class="font-semibold text-slate-900">${escapeHtml(
             point.company ?? point.fullName ?? "Unknown"
           )}</p>
           ${point.fullName && point.company
             ? `<p class="text-sm text-slate-600">${escapeHtml(point.fullName)}</p>`
             : ""}
           ${point.location
             ? `<p class="mt-1 text-xs text-slate-500">${escapeHtml(point.location)}</p>`
             : ""}
           <button data-contact-id="${escapeHtml(
             point.id
           )}" class="contact-map-view mt-2 w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-900 hover:bg-sky-50 hover:border-sky-300">
             View Profile
           </button>
         </div>`
      );

      // Hover tooltip showing name + company.
      const tooltip = L.tooltip({ direction: "top", offset: [0, -35] });
      tooltip.setContent(
        `<div class="px-1">
           <p class="text-sm font-semibold text-slate-900">${escapeHtml(
             point.company ?? point.fullName ?? "Unknown"
           )}</p>
           ${point.fullName && point.company
             ? `<p class="text-xs text-slate-600">${escapeHtml(point.fullName)}</p>`
             : ""}
         </div>`
      );

      const marker = L.marker(point.coords, { icon: markerIcon })
        .addTo(map)
        .bindPopup(popup)
        .bindTooltip(tooltip);

      markersRef.current.push(marker);
    }

    return () => {
      map.off("popupopen", handlePopupOpen);
    };
  }, [points, onViewProfile]);

  // Draw the live user location marker + accuracy circle.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Remove previous user marker/circle.
    if (userMarkerRef.current) {
      userMarkerRef.current.remove();
      userMarkerRef.current = null;
    }
    if (userCircleRef.current) {
      userCircleRef.current.remove();
      userCircleRef.current = null;
    }

    if (!userLocation) return;

    if (userAccuracy > 0) {
      userCircleRef.current = L.circle(userLocation, {
        radius: userAccuracy,
        className: "user-loc-circle",
      }).addTo(map);
    }

    userMarkerRef.current = L.marker(userLocation, {
      icon: userDivIcon,
      zIndexOffset: 1000,
    })
      .addTo(map)
      .bindTooltip("You are here", { direction: "top", offset: [0, -10] });
  }, [userLocation, userAccuracy, userDivIcon]);

  const resolvedCount = points.length;

  return (
    <div>
      <div className="mb-3 text-sm text-slate-600">
        Showing {resolvedCount} of {contacts.length} contacts on the map
        {resolvedCount < contacts.length
          ? " (remaining have no resolvable location)"
          : ""}
      </div>

      <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div
          ref={containerRef}
          style={{ height: "560px", width: "100%" }}
        />

        {/* Locate me button */}
        <div className="absolute bottom-3 right-3 z-[1000] flex flex-col items-end gap-2">
          <button
            onClick={locateMe}
            disabled={locStatus === "requesting" || locStatus === "granted"}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow hover:bg-slate-100 disabled:opacity-50"
            title="Show my live location"
          >
            <span className="inline-block h-3 w-3 rounded-full bg-sky-600" />
            {locStatus === "requesting" ? "Locating…" : "Locate me"}
          </button>

          {locStatus === "denied" && (
            <span className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 shadow">
              Location access denied — click to retry
            </span>
          )}
          {locStatus === "error" && (
            <span className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-700 shadow">
              Unable to get location
            </span>
          )}
          {locStatus === "granted" && (
            <span className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-700 shadow">
              Tracking your location
            </span>
          )}
        </div>

        {loading && (
          <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-white/70">
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 text-sm text-slate-600 shadow">
              Resolving locations…
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
