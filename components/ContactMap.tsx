"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import { LocateFixed, LocateOff, Locate } from "lucide-react";
import "leaflet/dist/leaflet.css";

import type { CardData } from "@/types/card";

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

// In-memory session cache mapping normalized location string -> [lat, lng] | null
const SESSION_CACHE = new Map<string, [number, number] | null>();

export default function ContactMap({
  contacts,
}: ContactMapProps) {
  const [points, setPoints] = useState<Point[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingProgress, setResolvingProgress] = useState<{
    current: number;
    total: number;
    query?: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markersMapRef = useRef<Map<string, L.Marker>>(new Map());
  const hasFitBoundsRef = useRef(false);

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

  // Fly to the user's position on the next fix after a tap (Google Maps style).
  const centerOnFixRef = useRef(false);

  const locateMe = () => {
    if (!("geolocation" in navigator)) {
      setLocStatus("error");
      return;
    }

    // Already tracking: recenter on the current position.
    if (watchIdRef.current !== null) {
      if (userLocation) {
        mapRef.current?.flyTo(userLocation, Math.max(mapRef.current.getZoom(), 15));
      } else {
        centerOnFixRef.current = true;
      }
      return;
    }

    centerOnFixRef.current = true;
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
        if (centerOnFixRef.current) {
          centerOnFixRef.current = false;
          mapRef.current?.flyTo(coords, Math.max(mapRef.current.getZoom(), 15));
        }
      },
      (err) => {
        setLocStatus(err.code === 1 ? "denied" : "error");
        // Clear the watch so the next tap can retry.
        if (watchIdRef.current !== null) {
          navigator.geolocation.clearWatch(watchIdRef.current);
          watchIdRef.current = null;
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  };

  // Initialize the map exactly once.
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
      // Stop panning past the poles into the grey area above/below the tiles.
      maxBounds: [[-85.05, -540], [85.05, 540]],
      maxBoundsViscosity: 1,
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

    // Drop the "Leaflet" prefix link; keep the Esri tile credit (their terms require it).
    map.attributionControl.setPrefix(false);

    mapRef.current = map;

    // Container height is layout-driven (flex / fixed full-screen on mobile), so
    // tell Leaflet whenever it changes or tiles render as a grey strip.
    // Also keep the world at least as tall as the container: on tall phone
    // screens a zoomed-out world (256px * 2^zoom) leaves grey bands otherwise.
    const fitMinZoom = () => {
      const h = el.clientHeight;
      if (!h) return;
      map.setMinZoom(Math.max(1, Math.ceil(Math.log2(h / 256))));
    };
    fitMinZoom();
    const resizeObserver = new ResizeObserver(() => {
      map.invalidateSize();
      fitMinZoom();
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
      markersMapRef.current.clear();
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      userMarkerRef.current = null;
      userCircleRef.current = null;
    };
  }, []);

  // Reset fit-bounds latch when contacts change
  useEffect(() => {
    hasFitBoundsRef.current = false;
  }, [contacts]);

  // Fetch coordinates:
  // Phase 1: Bulk check DB cache instantly (0s delay for cached items)
  // Phase 2: Progressively resolve missing locations one-by-one and drop markers in real-time
  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Gather all contacts with location strings
      const contactsWithLoc: Array<{
        contact: CardData;
        rawLoc: string;
        normalized: string;
      }> = [];

      for (const c of contacts) {
        if (!c.id) continue;
        const loc = (c.companyLocation || c.address || "").trim();
        if (loc) {
          contactsWithLoc.push({
            contact: c,
            rawLoc: loc,
            normalized: loc.toLowerCase(),
          });
        }
      }

      if (contactsWithLoc.length === 0) {
        setPoints([]);
        setLoading(false);
        setResolvingProgress(null);
        return;
      }

      console.log(
        `[Map] Total contacts: ${contacts.length}, contacts with location strings: ${contactsWithLoc.length}`
      );

      // Helper to build Point[] from contactsWithLoc based on SESSION_CACHE
      const buildPoints = () => {
        const pts: Point[] = [];
        for (const item of contactsWithLoc) {
          const coords = SESSION_CACHE.get(item.normalized);
          if (coords) {
            pts.push({
              id: item.contact.id!,
              fullName: item.contact.fullName,
              company: item.contact.company,
              location:
                item.contact.companyLocation || item.contact.address || null,
              coords,
            });
          }
        }
        return pts;
      };

      // Instantly plot any locations already in client SESSION_CACHE
      const initialPoints = buildPoints();
      if (!cancelled && initialPoints.length > 0) {
        setPoints(initialPoints);
      }

      // Collect all raw locations to check against PostgreSQL LocationCache
      const allUniqueLocations = Array.from(
        new Set(contactsWithLoc.map((item) => item.rawLoc))
      );

      try {
        setLoading(true);
        console.log(
          `[Map] Phase 1: Checking PostgreSQL cache for ${allUniqueLocations.length} unique locations...`
        );

        const checkRes = await fetch("/api/locations/cache-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ locations: allUniqueLocations }),
        });

        if (!checkRes.ok) {
          throw new Error(`Cache check failed with status ${checkRes.status}`);
        }

        const checkData = await checkRes.json();
        const cachedMap = checkData.cached as Record<
          string,
          { lat: number | null; lng: number | null }
        >;
        const missing = (checkData.missing as string[]) || [];

        // Save DB-cached results into SESSION_CACHE
        for (const [normQuery, coords] of Object.entries(cachedMap || {})) {
          if (coords?.lat != null && coords?.lng != null) {
            SESSION_CACHE.set(normQuery, [coords.lat, coords.lng]);
          } else {
            SESSION_CACHE.set(normQuery, null); // Negative cache (unresolvable)
          }
        }

        // Update points with everything found in DB cache immediately
        const cachedPoints = buildPoints();
        if (!cancelled) {
          setPoints(cachedPoints);
          console.log(
            `[Map] Phase 1 complete: Plotted ${cachedPoints.length} contacts from DB cache. Missing to resolve: ${missing.length}`
          );
        }

        if (missing.length === 0) {
          if (!cancelled) {
            setLoading(false);
            setResolvingProgress(null);
          }
          return;
        }

        // Phase 2: Progressively resolve missing locations one by one
        if (!cancelled) {
          setResolvingProgress({
            current: 0,
            total: missing.length,
            query: missing[0],
          });
        }

        for (let i = 0; i < missing.length; i++) {
          if (cancelled) break;
          const missingLoc = missing[i];
          const normLoc = missingLoc.toLowerCase();

          setResolvingProgress({
            current: i + 1,
            total: missing.length,
            query: missingLoc,
          });

          console.log(
            `[Map] (${i + 1}/${missing.length}) Resolving new location: "${missingLoc}"...`
          );

          try {
            const resolveRes = await fetch("/api/locations/resolve", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ location: missingLoc }),
            });

            if (resolveRes.ok) {
              const resolveData = await resolveRes.json();
              if (resolveData.lat != null && resolveData.lng != null) {
                const coords: [number, number] = [
                  resolveData.lat,
                  resolveData.lng,
                ];
                SESSION_CACHE.set(normLoc, coords);
                console.log(
                  `[Map] (${i + 1}/${missing.length}) ✓ Resolved "${missingLoc}" -> [${coords[0]}, ${coords[1]}]`
                );

                // Create new points for contacts having this location and append directly
                const matchingContacts = contactsWithLoc.filter(
                  (c) => c.normalized === normLoc
                );
                const newPoints: Point[] = matchingContacts.map((m) => ({
                  id: m.contact.id!,
                  fullName: m.contact.fullName,
                  company: m.contact.company,
                  location:
                    m.contact.companyLocation ||
                    m.contact.address ||
                    null,
                  coords,
                }));

                if (!cancelled && newPoints.length > 0) {
                  setPoints((prev) => {
                    const existingIds = new Set(prev.map((p) => p.id));
                    const toAdd = newPoints.filter(
                      (p) => !existingIds.has(p.id)
                    );
                    return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
                  });
                }
              } else {
                SESSION_CACHE.set(normLoc, null);
                console.log(
                  `[Map] (${i + 1}/${missing.length}) ✗ Could not resolve "${missingLoc}" (saved negative cache in DB)`
                );
              }
            } else {
              console.warn(
                `[Map] Failed to resolve "${missingLoc}": status ${resolveRes.status}`
              );
            }
          } catch (itemErr) {
            console.error(`[Map] Error resolving "${missingLoc}":`, itemErr);
          }
        }

        console.log(
          "[Map] All missing locations processed and saved to database."
        );
      } catch (err) {
        console.error("[Map] Failed during location resolution:", err);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setResolvingProgress(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [contacts]);

  // Fit bounds when points are first populated or updated
  useEffect(() => {
    const map = mapRef.current;
    if (!map || points.length === 0) return;

    if (!hasFitBoundsRef.current) {
      hasFitBoundsRef.current = true;
      if (points.length === 1) {
        map.setView(points[0].coords, 11);
      } else {
        const bounds = L.latLngBounds(points.map((p) => p.coords));
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    }
  }, [points.length]);

  // Efficiently render markers incrementally without wiping and recreating existing ones
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMarkers = markersMapRef.current;
    const currentPointIds = new Set<string>();

    for (const point of points) {
      currentPointIds.add(point.id);
      if (currentMarkers.has(point.id)) {
        continue;
      }

      const popup = L.popup({ className: "contact-map-popup" });
      popup.setContent(
        `<div class="min-w-[180px]">
           <p class="font-semibold text-stone-900">${escapeHtml(
             point.company ?? point.fullName ?? "Unknown"
           )}</p>
           ${point.fullName && point.company
             ? `<p class="text-sm text-stone-600">${escapeHtml(point.fullName)}</p>`
             : ""}
           ${point.location
             ? `<p class="mt-1 text-xs text-stone-500">${escapeHtml(point.location)}</p>`
             : ""}
           <a href="/contacts/${encodeURIComponent(point.id)}"
              class="mt-3 block rounded-lg bg-accent-700 px-3 py-2 text-center text-sm font-medium !text-white no-underline hover:bg-accent-800">
             View profile
           </a>
         </div>`
      );

      // Hover tooltip showing name + company.
      const tooltip = L.tooltip({ direction: "top", offset: [0, -35] });
      tooltip.setContent(
        `<div class="px-1">
           <p class="text-sm font-semibold text-stone-900">${escapeHtml(
             point.company ?? point.fullName ?? "Unknown"
           )}</p>
           ${point.fullName && point.company
             ? `<p class="text-xs text-stone-600">${escapeHtml(point.fullName)}</p>`
             : ""}
         </div>`
      );

      const marker = L.marker(point.coords, { icon: markerIcon })
        .addTo(map)
        .bindPopup(popup)
        .bindTooltip(tooltip);

      currentMarkers.set(point.id, marker);
    }

    // Clean up markers for points that were removed
    for (const [id, marker] of currentMarkers.entries()) {
      if (!currentPointIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    }

  }, [points]);

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
    <div className="contact-map flex h-full min-h-0 flex-col">
      <div className="mb-3 hidden shrink-0 items-center justify-between text-sm text-stone-600 md:flex">
        <div>
          Showing <span className="font-semibold text-stone-900">{resolvedCount}</span> of <span className="font-semibold text-stone-900">{contacts.length}</span> contacts on the map
          {resolvedCount < contacts.length && !loading && !resolvingProgress && (
            <span className="text-stone-500"> (remaining have no resolvable location)</span>
          )}
        </div>
        {resolvingProgress && (
          <div className="text-xs text-accent-600 font-medium animate-pulse">
            Adding markers in real-time ({resolvingProgress.current}/{resolvingProgress.total})…
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-stone-100 md:min-h-[420px] md:rounded-2xl md:shadow-soft md:ring-1 md:ring-stone-900/[0.04]">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Locate me button */}
        <div className="absolute bottom-28 right-4 z-[1000] flex items-center gap-2 md:bottom-8">
          {(locStatus === "denied" || locStatus === "error") && (
            <span role="alert" className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-lift">
              {locStatus === "denied" ? "Location blocked. Allow it in browser settings." : "Couldn't get your location."}
            </span>
          )}
          <button
            onClick={locateMe}
            aria-label={locStatus === "granted" ? "Center on my location" : "Show my location"}
            title={locStatus === "granted" ? "Center on my location" : "Show my location"}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-lift ring-1 ring-stone-900/[0.06] transition hover:bg-stone-50 active:scale-95"
          >
            {locStatus === "denied" || locStatus === "error" ? (
              <LocateOff className="h-5 w-5 text-red-600" strokeWidth={2} />
            ) : locStatus === "granted" ? (
              <LocateFixed className="h-5 w-5 text-accent-600" strokeWidth={2} />
            ) : (
              <Locate
                className={`h-5 w-5 ${locStatus === "requesting" ? "animate-pulse text-accent-600" : "text-stone-600"}`}
                strokeWidth={2}
              />
            )}
          </button>
        </div>

        {/* Progressive resolution indicator */}
        {resolvingProgress && (
          <div className="pointer-events-none absolute left-3 top-32 z-[1000] flex md:top-3 items-center gap-2 rounded-lg border border-accent-200 bg-white/95 px-3 py-2 text-xs font-medium text-stone-800 shadow-lg backdrop-blur">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-400 opacity-75"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-600"></span>
            </span>
            <span>
              Resolving new locations: <span className="font-semibold text-accent-700">{resolvingProgress.current}</span> of <span className="font-semibold">{resolvingProgress.total}</span>
              {resolvingProgress.query && (
                <span className="text-stone-500 ml-1">
                  (&ldquo;{resolvingProgress.query.length > 28 ? resolvingProgress.query.slice(0, 28) + "…" : resolvingProgress.query}&rdquo;)
                </span>
              )}
            </span>
          </div>
        )}

        {/* Initial loading screen if no cached points exist yet */}
        {loading && !resolvingProgress && points.length === 0 && (
          <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <div role="status" className="flex items-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-medium text-ink shadow-lift">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" />
              Checking location cache…
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
