"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

interface SearchResult {
  id: string;
  title: string;
  snippet: string;
  path: string[];
}

export function SearchTrigger({ siteId, baseHref, compact = false }: { siteId: string; baseHref: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const router = useRouter();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Defaults to the non-Mac label (matches the pre-hydration server render);
  // the keydown handler below already accepts either modifier regardless —
  // this only affects which one is *shown*.
  const [isMac, setIsMac] = useState(false);

  useEffect(() => {
    setIsMac(/Mac|iPhone|iPod|iPad/.test(navigator.platform || navigator.userAgent));
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setResults([]);
      return;
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const res = await fetch(`/api/sites/${siteId}/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = await res.json();
      setResults(data.results ?? []);
      setActiveIndex(0);
    }, 200);
  }, [query, siteId]);

  function navigateTo(result: SearchResult) {
    setOpen(false);
    router.push(`${baseHref}/${result.path.join("/")}`);
  }

  function onInputKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && results[activeIndex]) {
      navigateTo(results[activeIndex]);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search"
        className={`flex h-8 items-center gap-2 rounded-md border border-site-border text-xs text-site-ink-muted transition hover:bg-site-surface ${compact ? "w-8 justify-center" : "px-2.5"}`}
      >
        <SearchIcon />
        {compact ? null : (
          <>
            <span>Search</span>
            <kbd className="rounded border border-site-border px-1 font-sans text-[10px]">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </>
        )}
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-[15vh]" onClick={() => setOpen(false)}>
          <div
            className="w-full max-w-lg overflow-hidden rounded-xl border border-site-border bg-site-canvas shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-site-border px-4 py-3">
              <SearchIcon />
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- opening the palette should focus it immediately, matching every other Cmd+K pattern */}
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKeyDown}
                placeholder="Search..."
                className="w-full bg-transparent text-sm text-site-ink outline-none placeholder:text-site-ink-muted"
              />
            </div>
            {results.length > 0 ? (
              <ul className="max-h-80 overflow-y-auto py-2">
                {results.map((result, i) => (
                  <li key={result.id}>
                    <button
                      type="button"
                      onClick={() => navigateTo(result)}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={`block w-full px-4 py-2 text-left ${i === activeIndex ? "bg-site-surface" : ""}`}
                    >
                      <p className="text-sm font-medium text-site-ink">{result.title}</p>
                      <p className="truncate text-xs text-site-ink-muted">{result.snippet}</p>
                    </button>
                  </li>
                ))}
              </ul>
            ) : query.trim().length >= 2 ? (
              <p className="px-4 py-6 text-center text-sm text-site-ink-muted">No results</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0">
      <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M11 11l3.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
