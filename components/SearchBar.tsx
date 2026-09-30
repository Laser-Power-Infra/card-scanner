import { Search } from "lucide-react";

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  compact?: boolean;
};

export default function SearchBar({
  value,
  onChange,
  compact = false,
}: SearchBarProps) {
  return (
    <label className={`relative block ${compact ? "w-full md:max-w-xs" : "w-full"}`}>
      <span className="sr-only">Search contacts</span>
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400"
        strokeWidth={1.75}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search name, company, email, phone"
        className="w-full rounded-xl border border-stone-200 bg-white py-2 pl-9 pr-3 text-sm text-ink shadow-soft transition duration-200 placeholder:text-stone-400 focus:border-accent-500 focus:outline-none focus:ring-4 focus:ring-accent-500/10"
      />
    </label>
  );
}
