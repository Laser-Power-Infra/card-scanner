"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

export const BLANK = "(Blank)";

interface MultiSelectFilterProps {
  label: string;
  allLabel: string;
  options: string[];
  cascadedOptions?: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  counts?: Record<string, number>;
  includeBlank?: boolean;
  searchPlaceholder?: string;
  align?: "left" | "right";
  className?: string;
  panelClassName?: string;
}

export default function MultiSelectFilter({
  label,
  allLabel,
  options,
  cascadedOptions,
  selected,
  onChange,
  counts,
  includeBlank = false,
  searchPlaceholder,
  align = "left",
  className = "",
  panelClassName = "",
}: MultiSelectFilterProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const visibleOptions = useMemo(() => {
    const cascadedSet = cascadedOptions ? new Set(cascadedOptions) : null;
    const selectedSet = new Set(selected);
    const q = search.toLowerCase().trim();
    return options.filter((opt) => {
      const allowed = !cascadedSet || cascadedSet.has(opt) || selectedSet.has(opt);
      return allowed && opt.toLowerCase().includes(q);
    });
  }, [options, cascadedOptions, selected, search]);

  const toggle = (opt: string) => {
    onChange(
      selected.includes(opt)
        ? selected.filter((v) => v !== opt)
        : [...selected, opt]
    );
  };

  const close = () => {
    setOpen(false);
    setSearch("");
  };

  const hasFilter = selected.length > 0;
  const buttonLabel =
    selected.length === 0
      ? allLabel
      : selected.length === 1
      ? selected[0]
      : `${selected.length} Selected`;

  const blankChecked = selected.includes(BLANK);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full h-7 rounded border px-2 py-0.5 text-[11px] text-left cursor-pointer flex items-center justify-between outline-none normal-case font-normal transition-colors ${
          hasFilter
            ? "border-accent-500 bg-accent-50/70 text-accent-700 font-semibold"
            : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
        } ${className}`}
        title={buttonLabel}
      >
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown
          className={`h-3 w-3 shrink-0 ml-1 transition-transform ${
            open ? "rotate-180 text-accent-600" : "text-stone-400"
          }`}
        />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={close}
          />
          <div
            className={`absolute top-full mt-1.5 w-64 z-50 animate-rise rounded-xl bg-white text-ink shadow-pop ring-1 ring-stone-900/[0.06] p-2.5 flex flex-col gap-2 max-h-72 ${
              align === "right" ? "right-0 left-auto" : "left-0"
            } ${panelClassName}`}
          >
            {/* Search Box */}
            <div className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 bg-stone-100">
              <Search className="h-3.5 w-3.5 text-stone-400 shrink-0" />
              <input
                type="text"
                placeholder={searchPlaceholder || `Search ${label.toLowerCase()}...`}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full text-xs bg-transparent outline-none border-none placeholder:text-stone-400 p-0 h-4 normal-case text-stone-800"
                autoFocus
              />
            </div>

            {/* Select All / Clear */}
            <div className="flex justify-between items-center px-1 text-[11px]">
              <button
                type="button"
                onClick={() => {
                  const allValues = includeBlank ? [BLANK, ...options] : [...options];
                  onChange(allValues);
                }}
                className="text-accent-700 font-medium hover:underline cursor-pointer"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-stone-500 font-medium hover:underline cursor-pointer"
              >
                Clear
              </button>
            </div>

            {/* Options List */}
            <div className="flex-1 overflow-y-auto divide-y divide-stone-100 max-h-44 pr-0.5">
              {includeBlank && (
                <label className="flex items-center gap-2 py-1.5 px-1 hover:bg-stone-50 rounded cursor-pointer select-none text-xs text-stone-700 font-medium truncate">
                  <input
                    type="checkbox"
                    checked={blankChecked}
                    onChange={() => toggle(BLANK)}
                    className="h-3.5 w-3.5 rounded text-accent-600 focus:ring-accent-500 border-stone-300 cursor-pointer"
                  />
                  <span className="truncate flex-1 italic text-stone-500">{BLANK}</span>
                  {counts?.[BLANK] !== undefined && (
                    <span className="text-[10px] text-stone-400 font-medium shrink-0 ml-1">
                      ({counts[BLANK]})
                    </span>
                  )}
                </label>
              )}

              {visibleOptions.map((opt) => {
                const isChecked = selected.includes(opt);
                const count = counts?.[opt];
                return (
                  <label
                    key={opt}
                    className="flex items-center gap-2 py-1.5 px-1 hover:bg-stone-50 rounded cursor-pointer select-none text-xs text-stone-700 font-normal truncate"
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggle(opt)}
                      className="h-3.5 w-3.5 rounded text-accent-600 focus:ring-accent-500 border-stone-300 cursor-pointer"
                    />
                    <span className="truncate flex-1" title={opt}>
                      {opt}
                    </span>
                    {count !== undefined && (
                      <span className="text-[10px] text-stone-400 font-medium shrink-0 ml-1">
                        ({count})
                      </span>
                    )}
                  </label>
                );
              })}

              {visibleOptions.length === 0 && !includeBlank && (
                <div className="py-3 px-2 text-xs text-stone-400 italic text-center">
                  No options found
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
