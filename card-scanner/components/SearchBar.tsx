type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
};

export default function SearchBar({
  value,
  onChange,
}: SearchBarProps) {
  return (
    <div className="w-full">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search by name, company, email, phone..."
        className="w-full rounded-xl border border-ivory/20 bg-transparent px-4 py-3 text-ivory placeholder:text-ivory/40 focus:border-copper focus:outline-none"
      />
    </div>
  );
}