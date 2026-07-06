type DirectoryToolbarProps = {
  viewMode: "cards" | "table";
  setViewMode: (mode: "cards" | "table") => void;
  total: number;
  onScanAnother: () => void;
};

export default function DirectoryToolbar({
  viewMode,
  setViewMode,
  total,
  onScanAnother,
}: DirectoryToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-ivory/15 bg-white/5 p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setViewMode("cards")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            viewMode === "cards"
              ? "bg-copper text-graphite"
              : "border border-ivory/20 text-ivory hover:border-ivory/40"
          }`}
        >
          Cards
        </button>

        <button
          onClick={() => setViewMode("table")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            viewMode === "table"
              ? "bg-copper text-graphite"
              : "border border-ivory/20 text-ivory hover:border-ivory/40"
          }`}
        >
          Table
        </button>

        <button
          onClick={onScanAnother}
          className="rounded-lg bg-copper px-4 py-2 text-sm font-medium text-graphite transition hover:bg-copperdim"
        >
          Scan Another
        </button>
      </div>

      <div className="text-sm font-medium text-ivory/70">
        {total} Contact{total !== 1 ? "s" : ""}
      </div>
    </div>
  );
}