import { LayoutGrid, Map as MapIcon, Rows3, ScanLine } from "lucide-react";

type ViewMode = "cards" | "table" | "map";

type DirectoryToolbarProps = {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  total: number;
  onScanAnother: () => void;
};

const VIEWS = [
  { mode: "cards", label: "Cards", Icon: LayoutGrid },
  { mode: "table", label: "Table", Icon: Rows3 },
  { mode: "map", label: "Map", Icon: MapIcon },
] as const;

export default function DirectoryToolbar({
  viewMode,
  setViewMode,
  total,
  onScanAnother,
}: DirectoryToolbarProps) {
  const active = VIEWS.findIndex((v) => v.mode === viewMode);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div
        role="tablist"
        aria-label="Directory view"
        className="relative grid grid-cols-3 rounded-xl bg-stone-200/70 p-1"
      >
        {/* Sliding active pill */}
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-lg bg-white shadow-soft transition-transform duration-300 ease-spring"
          style={{ transform: `translateX(${active * 100}%)` }}
        />
        {VIEWS.map(({ mode, label, Icon }) => (
          <button
            key={mode}
            role="tab"
            aria-selected={viewMode === mode}
            onClick={() => setViewMode(mode)}
            className={`relative z-10 inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors duration-200 ${
              viewMode === mode ? "text-ink" : "text-stone-500 hover:text-ink"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      <p className="font-mono text-sm text-stone-500">
        <span className="text-ink">{total}</span> contact{total !== 1 ? "s" : ""}
      </p>

      <button
        onClick={onScanAnother}
        className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-accent-700 transition duration-200 ease-spring hover:bg-accent-50 active:scale-[.98]"
      >
        <ScanLine className="h-4 w-4" strokeWidth={1.75} />
        Scan another
      </button>
    </div>
  );
}
