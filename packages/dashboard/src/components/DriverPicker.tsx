import { useEffect, useRef, useState } from 'react';
import { DRIVER_SEARCH_DEBOUNCE_MS } from '@bongofleet/shared-lib';
import { apiFetch, ApiError } from '../lib/api';
import type { DriverSearchResponse, DriverSearchResult } from '../lib/types';

/**
 * Stage G6 Part 2 - a reusable searchable driver picker: type a name, phone,
 * or plate; the match runs server-side (GET /drivers/search), debounced so a
 * short name is one request, not one per keystroke. Built for the Payments
 * page's rent-to-own flow first, but takes only `value`/`onSelect` so it
 * drops into assignments, expenses, and plan creation later unchanged.
 *
 * Never loads the full driver list - at fleet scale (hundreds of vehicles)
 * that's the thing that breaks. Every fetched page is capped server-side;
 * `hasMore` is shown, never silently dropped.
 */
export function DriverPicker({
  value,
  onSelect,
  placeholder = 'Search by name, phone, or plate…',
  includeInactive = false,
}: {
  value: DriverSearchResult | null;
  onSelect: (driver: DriverSearchResult | null) => void;
  placeholder?: string;
  /** Stage DS1 - opt in per call site; see PaymentFormModal for why its
   *  rent-to-own flow passes true. */
  includeInactive?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DriverSearchResult[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setHasMore(false);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: trimmed });
      if (includeInactive) {
        params.set('includeInactive', 'true');
      }
      apiFetch<DriverSearchResponse>(`/drivers/search?${params.toString()}`)
        .then((res) => {
          setResults(res.results);
          setHasMore(res.hasMore);
          setHighlightedIndex(0);
          setError(null);
        })
        .catch((err) => {
          setResults([]);
          setHasMore(false);
          setError(err instanceof ApiError ? err.message : 'Could not search drivers.');
        })
        .finally(() => setLoading(false));
    }, DRIVER_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, includeInactive]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function selectDriver(driver: DriverSearchResult) {
    onSelect(driver);
    setQuery('');
    setResults([]);
    setOpen(false);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const driver = results[highlightedIndex];
      if (driver) selectDriver(driver);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  if (value) {
    return (
      <div className="flex items-center justify-between rounded border border-line bg-panel-2 px-3 py-2 text-sm">
        <span className="text-txt">
          {value.firstName} {value.lastName}
          {!value.isActive && (
            <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 text-xs font-medium text-txt-2">
              Inactive
            </span>
          )}
          {' — '}
          {value.registrationNumber ?? 'no vehicle on file'}
          {' — '}
          {value.phone}
        </span>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className="ml-3 shrink-0 text-sm font-medium text-txt-2 hover:underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="w-full rounded border border-line px-3 py-2 text-sm"
      />
      {open && query.trim() !== '' && (
        <div className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded border border-line bg-panel shadow-lg">
          {loading ? (
            <p className="px-3 py-2 text-sm text-txt-2">Searching…</p>
          ) : error ? (
            <p className="px-3 py-2 text-sm text-crit">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-txt-2">
              No drivers match &quot;{query.trim()}&quot;.
            </p>
          ) : (
            <>
              {results.map((driver, index) => (
                <button
                  type="button"
                  key={driver.id}
                  onClick={() => selectDriver(driver)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`block w-full px-3 py-2 text-left text-sm ${
                    index === highlightedIndex ? 'bg-panel-2' : ''
                  }`}
                >
                  <div className="font-medium text-txt">
                    {driver.firstName} {driver.lastName}
                    {!driver.isActive && (
                      <span className="ml-2 rounded bg-panel-2 px-1.5 py-0.5 text-xs font-medium text-txt-2">
                        Inactive
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-txt-2">
                    {driver.registrationNumber ?? 'No vehicle on file'} · {driver.phone}
                  </div>
                </button>
              ))}
              {hasMore && (
                <p className="border-t border-line-soft px-3 py-2 text-xs text-txt-2">
                  More matches than shown — refine your search.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
