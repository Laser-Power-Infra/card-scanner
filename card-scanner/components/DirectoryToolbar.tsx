import Link from "next/link";

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
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => setViewMode("cards")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            viewMode === "cards"
              ? "bg-sky-600 text-white"
              : "border border-slate-300 text-slate-700 hover:border-slate-400"
          }`}
        >
          Cards
        </button>

        <button
          onClick={() => setViewMode("table")}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
            viewMode === "table"
              ? "bg-sky-600 text-white"
              : "border border-slate-300 text-slate-700 hover:border-slate-400"
          }`}
        >
          Table
        </button>

        <button
          onClick={onScanAnother}
          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-sky-700"
        >
          Scan Another
        </button>
      </div>

      <div className="text-sm font-medium text-slate-600">
        {total} Contact{total !== 1 ? "s" : ""}
      </div>
    </div>
  );
}