"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet.markercluster";
import { Info, LocateFixed, LocateOff, Locate, Maximize2, RefreshCw } from "lucide-react";
import "leaflet/dist/leaflet.css";
// Only the animation/transition rules: the bubbles are styled in globals.css.
import "leaflet.markercluster/dist/MarkerCluster.css";

import { buildFilterParams, type ContactsQuery } from "@/lib/store/contactsSlice";
import type { LocationPoint, LocationPointsResponse } from "@/types/card";

interface ContactMapProps {
  /** The directory's current search and filters; the map plots exactly those contacts. */
  query: ContactsQuery;
  /** Offered in the empty state when filters are what emptied the map. */
  onClearFilters?: () => void;
  /** Called from a pin's popup. Without it the popup links to the full profile page instead. */
  onViewProfile?: (point: LocationPoint) => void;
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

const FIT_PADDING: [number, number] = [40, 40];
const FIT_MAX_ZOOM = 14;
const FIT_SECONDS = 0.8;

const PRIMARY_COLOR = "#2C6150";
const SECONDARY_COLOR = "#B45309";

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ── Pins ──────────────────────────────────────────────────────────────────────
// Inline SVG, so there is no CDN image to flash in and they stay crisp on
// retina screens. Primary and secondary locations differ by colour; a pin that
// sits on an area or city centre rather than a street address is drawn hollow.
// The hollow rule is precision, not status: nearly every worker-found location
// is APPROXIMATE (the VERIFIED bar is very strict), so status would hollow out
// almost the whole map and say nothing. The popup still states the status.

const PIN_PATH = "M14 35C14 35 2 22.5 2 13.5a12 12 0 1 1 24 0C26 22.5 14 35 14 35z";

function pinSvg(color: string, hollow: boolean): string {
  return (
    `<svg viewBox="0 0 28 36" width="28" height="36" aria-hidden="true">` +
    `<path d="${PIN_PATH}" fill="${hollow ? "#ffffff" : color}" stroke="${hollow ? color : "#ffffff"}" stroke-width="${hollow ? 2.5 : 1.5}"/>` +
    `<circle cx="14" cy="13.5" r="4.5" fill="${hollow ? color : "#ffffff"}"/>` +
    `</svg>`
  );
}

const iconCache = new Map<string, L.DivIcon>();

function pinIcon(p: LocationPoint): L.DivIcon {
  const hollow = p.precision !== "STREET";
  const key = `${p.isPrimary ? "p" : "s"}${hollow ? "h" : "f"}`;
  let icon = iconCache.get(key);
  if (!icon) {
    icon = L.divIcon({
      className: "",
      html: `<div class="cm-pin">${pinSvg(p.isPrimary ? PRIMARY_COLOR : SECONDARY_COLOR, hollow)}</div>`,
      iconSize: [28, 36],
      iconAnchor: [14, 36],
      popupAnchor: [0, -32],
      tooltipAnchor: [0, -30],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

function clusterIcon(cluster: L.MarkerCluster): L.DivIcon {
  const n = cluster.getChildCount();
  const size = n < 10 ? "sm" : n < 100 ? "md" : "lg";
  const px = size === "sm" ? 36 : size === "md" ? 44 : 52;
  return L.divIcon({
    className: "",
    html: `<div class="cm-cluster cm-cluster--${size}"><span>${n}</span></div>`,
    iconSize: [px, px],
  });
}

// The "you are here" dot. Module-level on purpose: when this was rebuilt on
// every render it sat in the dependency list of the marker effect, which then
// removed and re-added the dot on every render.
const userDivIcon = L.divIcon({
  className: "",
  html: '<div class="user-loc-dot"></div>',
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

const titleOf = (p: LocationPoint) => p.company ?? p.fullName ?? "Unknown";

const VIEW_BUTTON_CLASS =
  "mt-3 block w-full rounded-lg bg-accent-700 px-3 py-2 text-center text-sm font-medium !text-white no-underline hover:bg-accent-800";

/** `asLink` is the fallback when the parent gave no `onViewProfile`: navigate to the full page. */
function popupHtml(p: LocationPoint, asLink: boolean): string {
  const place = p.address && p.label ? `${p.address}, ${p.label}` : (p.address ?? p.label);
  const quality = `${p.status === "VERIFIED" ? "Verified" : "Approximate"} · ${p.precision.toLowerCase()} precision`;
  return `<div class="min-w-[190px]">
    <p class="font-semibold text-stone-900">${escapeHtml(titleOf(p))}</p>
    ${p.fullName && p.company ? `<p class="text-sm text-stone-600">${escapeHtml(p.fullName)}</p>` : ""}
    ${place ? `<p class="mt-1 text-xs text-stone-500">${escapeHtml(place)}</p>` : ""}
    <p class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-stone-500">
      ${p.isPrimary ? `<span class="rounded-full bg-accent-50 px-1.5 py-0.5 font-medium text-accent-800">Primary</span>` : `<span class="rounded-full bg-stone-100 px-1.5 py-0.5 font-medium text-stone-600">Other location</span>`}
      <span>${escapeHtml(quality)}</span>
    </p>
    ${
      asLink
        ? `<a href="/contacts/${encodeURIComponent(p.contactId)}" class="${VIEW_BUTTON_CLASS}">View profile</a>`
        : `<button type="button" data-view-profile class="${VIEW_BUTTON_CLASS}">View profile</button>`
    }
  </div>`;
}

/** Popup body as a DOM node, so the button can call back into React instead of navigating. */
function popupContent(p: LocationPoint, onView: (() => void) | null): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = popupHtml(p, !onView);
  if (onView) root.querySelector("[data-view-profile]")?.addEventListener("click", onView);
  return root;
}

function buildMarker(p: LocationPoint, hoverable: boolean, onView: ((p: LocationPoint) => void) | null): L.Marker {
  const mobile = typeof window !== "undefined" && window.innerWidth < 768;
  const marker = L.marker([p.lat, p.lng], { icon: pinIcon(p), riseOnHover: true });
  marker.bindPopup(
    L.popup({
      className: "contact-map-popup",
      // Keep an opening popup clear of the floating filter bar and controls.
      autoPanPaddingTopLeft: [24, mobile ? 140 : 96],
      autoPanPaddingBottomRight: [24, mobile ? 110 : 24],
    }).setContent(
      popupContent(
        p,
        // Close the popup first, so it is not left floating behind the drawer.
        onView ? () => { marker.closePopup(); onView(p); } : null
      )
    )
  );
  // Hover tooltips only where there is a hover: on touch a tap opens the popup.
  if (hoverable) {
    marker.bindTooltip(
      `<div class="px-1">
         <p class="text-sm font-semibold text-stone-900">${escapeHtml(titleOf(p))}</p>
         ${p.fullName && p.company ? `<p class="text-xs text-stone-600">${escapeHtml(p.fullName)}</p>` : ""}
       </div>`,
      { direction: "top", offset: [0, -2] }
    );
  }
  return marker;
}

/** Everything that changes how a pin looks or what it says; a change rebuilds just that pin. */
const pointSig = (p: LocationPoint) =>
  [p.isPrimary, p.status, p.precision, p.lat, p.lng, p.label, p.address, p.company, p.fullName, p.contactId].join("|");

/** Order-independent fingerprint of the result set: the camera only refits when it changes. */
function fitKey(points: LocationPoint[]): string {
  const ids = points.map((p) => p.id).sort();
  let h = 5381;
  for (const id of ids) for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return `${ids.length}:${h}`;
}

const nf = new Intl.NumberFormat("en-IN");

export default function ContactMap({ query, onClearFilters, onViewProfile }: ContactMapProps) {
  // The previous result stays in `data` while the next one loads, so pins never
  // blink out between filter changes.
  const [data, setData] = useState<LocationPointsResponse | null>(null);
  const [fetching, setFetching] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [legendOpen, setLegendOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const clusterRef = useRef<L.MarkerClusterGroup | null>(null);
  const markersRef = useRef<Map<string, { marker: L.Marker; sig: string }>>(new Map());
  const fitKeyRef = useRef<string | null>(null);

  // The parent passes a fresh callback every render. Pins read it through this
  // ref when clicked, so it never has to be a dependency of the marker diff
  // (which would rebuild every pin on every render).
  const onViewProfileRef = useRef(onViewProfile);
  useEffect(() => {
    onViewProfileRef.current = onViewProfile;
  }, [onViewProfile]);

  // Live user location state.
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [userAccuracy, setUserAccuracy] = useState<number>(0);
  const [locStatus, setLocStatus] = useState<
    "idle" | "requesting" | "granted" | "denied" | "error"
  >("idle");
  const watchIdRef = useRef<number | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const userCircleRef = useRef<L.Circle | null>(null);

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

  /** Frame the given points. `animate` is false for the very first fit and under reduced motion. */
  const fit = useCallback((pts: LocationPoint[], animate: boolean) => {
    const map = mapRef.current;
    if (!map || pts.length === 0) return;
    const fly = animate && !prefersReducedMotion();
    if (pts.length === 1) {
      const at: [number, number] = [pts[0].lat, pts[0].lng];
      if (fly) map.flyTo(at, 11, { duration: FIT_SECONDS });
      else map.setView(at, 11, { animate: false });
      return;
    }
    const bounds = L.latLngBounds(pts.map((p) => [p.lat, p.lng] as [number, number]));
    if (fly) map.flyToBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, duration: FIT_SECONDS });
    else map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: false });
  }, []);

  // Initialize the map exactly once.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const reduce = prefersReducedMotion();

    const map = L.map(el, {
      center: INDIA_CENTER,
      zoom: 5,
      scrollWheelZoom: true,
      zoomControl: true,
      doubleClickZoom: true,
      touchZoom: true,
      maxZoom: 19,
      // A slower wheel, so zooming glides instead of lurching. Zoom stays on
      // whole levels on purpose: half steps (zoomSnap 0.5) scale the tiles by a
      // fractional amount and leave visible hairline seams between them.
      wheelPxPerZoomLevel: 90,
      wheelDebounceTime: 40,
      inertia: true,
      zoomAnimation: !reduce,
      fadeAnimation: !reduce,
      markerZoomAnimation: !reduce,
      // Stop panning past the poles into the grey area above/below the tiles.
      maxBounds: [[-85.05, -540], [85.05, 540]],
      maxBoundsViscosity: 1,
    });

    // No updates mid-zoom and a wide buffer: fewer grey tiles while flying.
    const tileOptions = { maxZoom: 19, attribution: ESRI_ATTRIBUTION, updateWhenZooming: false, keepBuffer: 4 };

    const street = L.tileLayer(STREET_URL, tileOptions).addTo(map);
    const satelliteBase = L.tileLayer(SATELLITE_URL, tileOptions);
    const labels = L.tileLayer(LABELS_URL, tileOptions);
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

    const cluster = L.markerClusterGroup({
      // Add thousands of pins in slices, so the page stays responsive.
      chunkedLoading: true,
      animate: !reduce,
      animateAddingMarkers: !reduce,
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 50,
      iconCreateFunction: clusterIcon,
    });
    map.addLayer(cluster);

    mapRef.current = map;
    clusterRef.current = cluster;
    // Captured here so the cleanup closes over the Map this effect owns.
    const markers = markersRef.current;

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
      clusterRef.current = null;
      fitKeyRef.current = null;
      markers.clear();
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      userMarkerRef.current = null;
      userCircleRef.current = null;
    };
  }, []);

  // Fetch the pins for the directory's current filters. Keyed on the filter
  // string, not `query`: paging changes the query object but not what is plotted.
  const filterQs = useMemo(() => buildFilterParams(query).toString(), [query]);

  useEffect(() => {
    const ctrl = new AbortController();
    setFetching(true);
    setLoadError(false);

    fetch(`/api/locations/points${filterQs ? `?${filterQs}` : ""}`, { signal: ctrl.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`Points request failed with status ${res.status}`);
        return res.json() as Promise<LocationPointsResponse>;
      })
      .then((body) => {
        setData(body);
        setFetching(false);
      })
      .catch((err: unknown) => {
        if ((err as { name?: string })?.name === "AbortError") return;
        console.error("[Map] Failed to load locations:", err);
        setLoadError(true);
        setFetching(false);
      });

    // A superseding request aborts this one and owns `fetching` from here on.
    return () => ctrl.abort();
  }, [filterQs, reloadTick]);

  // Diff the pins into the cluster group: only what changed is added or removed.
  useEffect(() => {
    const cluster = clusterRef.current;
    if (!cluster || !data) return;

    const hoverable = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const onView = onViewProfileRef.current
      ? (point: LocationPoint) => onViewProfileRef.current?.(point)
      : null;
    const live = markersRef.current;
    const wanted = new Set<string>();
    const add: L.Marker[] = [];
    const drop: L.Marker[] = [];

    for (const p of data.points) {
      wanted.add(p.id);
      const sig = pointSig(p);
      const current = live.get(p.id);
      if (current?.sig === sig) continue;
      if (current) drop.push(current.marker);
      const marker = buildMarker(p, hoverable, onView);
      live.set(p.id, { marker, sig });
      add.push(marker);
    }
    for (const [id, current] of live) {
      if (!wanted.has(id)) {
        drop.push(current.marker);
        live.delete(id);
      }
    }

    if (drop.length) cluster.removeLayers(drop);
    if (add.length) cluster.addLayers(add);

    // Reframe only when the set of locations really changed: an identical
    // refetch never moves the camera. The first fit is instant, later ones glide.
    const key = fitKey(data.points);
    if (key !== fitKeyRef.current) {
      fit(data.points, fitKeyRef.current !== null);
      fitKeyRef.current = key;
    }
  }, [data, fit]);

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
  }, [userLocation, userAccuracy]);

  const shown = data?.points.length ?? 0;
  const unmapped = data ? Math.max(data.contactsTotal - data.contactsPlotted, 0) : 0;
  const isEmpty = !!data && shown === 0 && !fetching && !loadError;

  const noteText = [
    unmapped > 0 ? `${nf.format(unmapped)} ${unmapped === 1 ? "contact has" : "contacts have"} no coordinates yet` : null,
    data?.truncated ? `showing the first ${nf.format(shown)} locations` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    // `isolate z-0`: Leaflet's panes and controls use z-indexes up to 1000. Without
    // their own stacking context on desktop they would paint over the profile
    // drawer (z-50) that opens above the map.
    <div className="contact-map relative isolate z-0 flex h-full min-h-0 flex-col">
      <div className="mb-3 hidden shrink-0 items-center justify-between text-sm text-stone-600 md:flex">
        <div role="status" aria-live="polite">
          {data ? (
            <>
              Showing <span className="font-semibold text-stone-900">{nf.format(shown)}</span>{" "}
              {shown === 1 ? "location" : "locations"} for{" "}
              <span className="font-semibold text-stone-900">{nf.format(data.contactsPlotted)}</span> of{" "}
              <span className="font-semibold text-stone-900">{nf.format(data.contactsTotal)}</span> contacts
              {noteText && <span className="text-stone-500"> · {noteText}</span>}
            </>
          ) : (
            <span className="text-stone-500">Loading locations…</span>
          )}
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden bg-stone-100 md:min-h-[420px] md:rounded-2xl md:shadow-soft md:ring-1 md:ring-stone-900/[0.04]">
        <div ref={containerRef} className="absolute inset-0" />

        {/* Refresh indicator: the old pins stay put while the next set loads. */}
        {fetching && data && <div className="cm-progress" role="progressbar" aria-label="Updating map" />}

        {/* Compact count for phones, where the line above the map is hidden. */}
        {data && (
          <div className="pointer-events-none absolute left-3 top-32 z-[1000] max-w-[70%] rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-700 shadow-lift ring-1 ring-stone-900/[0.06] md:hidden">
            <span className="font-semibold text-stone-900">{nf.format(shown)}</span>{" "}
            {shown === 1 ? "location" : "locations"} ·{" "}
            <span className="font-semibold text-stone-900">{nf.format(data.contactsPlotted)}</span>{" "}
            {data.contactsPlotted === 1 ? "contact" : "contacts"}
            {noteText && <span className="block truncate text-[11px] font-normal text-stone-500">{noteText}</span>}
          </div>
        )}

        {/* Controls */}
        <div className="absolute bottom-28 right-4 z-[1000] flex items-center gap-2 md:bottom-8">
          {(locStatus === "denied" || locStatus === "error") && (
            <span role="alert" className="rounded-lg bg-white px-2.5 py-1.5 text-xs font-medium text-red-700 shadow-lift">
              {locStatus === "denied" ? "Location blocked. Allow it in browser settings." : "Couldn't get your location."}
            </span>
          )}
          <button
            onClick={() => data && fit(data.points, true)}
            disabled={shown === 0}
            aria-label="Fit all locations"
            title="Fit all locations"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-white shadow-lift ring-1 ring-stone-900/[0.06] transition hover:bg-stone-50 active:scale-95 disabled:opacity-40"
          >
            <Maximize2 className="h-5 w-5 text-stone-600" strokeWidth={2} />
          </button>
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

        {/* Legend */}
        <div className="absolute bottom-28 left-3 z-[1000] md:bottom-8">
          {legendOpen ? (
            <div className="rounded-xl bg-white/95 px-3 py-2.5 text-xs text-stone-700 shadow-lift ring-1 ring-stone-900/[0.06]">
              <div className="mb-1.5 flex items-center justify-between gap-6">
                <span className="font-semibold text-stone-900">Legend</span>
                <button
                  onClick={() => setLegendOpen(false)}
                  className="text-stone-500 hover:text-stone-800"
                  aria-label="Hide legend"
                >
                  Hide
                </button>
              </div>
              <ul className="space-y-1">
                <LegendRow svg={pinSvg(PRIMARY_COLOR, false)} label="Primary location" />
                <LegendRow svg={pinSvg(SECONDARY_COLOR, false)} label="Other location" />
                <LegendRow svg={pinSvg(PRIMARY_COLOR, true)} label="Area or city centre" />
              </ul>
            </div>
          ) : (
            <button
              onClick={() => setLegendOpen(true)}
              aria-label="Show legend"
              className="flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-medium text-stone-700 shadow-lift ring-1 ring-stone-900/[0.06] transition hover:bg-stone-50 active:scale-95"
            >
              <Info className="h-4 w-4 text-stone-500" strokeWidth={2} />
              Legend
            </button>
          )}
        </div>

        {/* First load only: a skeleton, not a blur over an empty map. */}
        {!data && fetching && !loadError && (
          <div className="cm-skeleton pointer-events-none absolute inset-0 z-[900] flex items-center justify-center">
            <div role="status" className="flex items-center gap-3 rounded-xl bg-white px-5 py-3.5 text-sm font-medium text-ink shadow-lift">
              <span className="h-2 w-2 animate-pulse rounded-full bg-accent-500" />
              Loading locations…
            </div>
          </div>
        )}

        {loadError && (
          <div className="absolute inset-x-0 top-36 z-[1000] flex justify-center px-4 md:top-4">
            <div role="alert" className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 text-sm text-stone-800 shadow-lift ring-1 ring-red-200">
              <span>Couldn&rsquo;t load map locations.</span>
              <button
                onClick={() => setReloadTick((t) => t + 1)}
                className="inline-flex items-center gap-1.5 rounded-lg bg-accent-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-800 active:scale-[.98]"
              >
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} /> Retry
              </button>
            </div>
          </div>
        )}

        {isEmpty && (
          <div className="pointer-events-none absolute inset-0 z-[900] flex items-center justify-center px-6">
            <div className="pointer-events-auto max-w-sm rounded-2xl bg-white px-6 py-5 text-center shadow-lift ring-1 ring-stone-900/[0.06]">
              <p className="text-sm font-semibold text-stone-900">No mapped locations match these filters</p>
              <p className="mt-1 text-xs text-stone-500">
                {data && data.contactsTotal > 0
                  ? `${nf.format(data.contactsTotal)} matching ${data.contactsTotal === 1 ? "contact has" : "contacts have"} no coordinates yet.`
                  : "Try widening your search."}
              </p>
              {onClearFilters && (
                <button
                  onClick={onClearFilters}
                  className="mt-3 inline-flex items-center rounded-lg bg-accent-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-800 active:scale-[.98]"
                >
                  Clear filters
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function LegendRow({ svg, label }: { svg: string; label: string }) {
  return (
    <li className="flex items-center gap-2">
      {/* `svg` is a module-built constant (see pinSvg), never user data. */}
      <span className="h-[22px] w-[17px] shrink-0 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      {label}
    </li>
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
