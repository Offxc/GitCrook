"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { resolveTreePath, variantSegments } from "@gitcrook/shared";
import { useSiteNav } from "./SiteNavProvider";

/**
 * GitBook's "version" dropdown. A plain <details>/<summary>. Each option links to the same page-slug
 * path in that variant when the page exists there, and to that variant's first page when it doesn't.
 * Worked out in the browser from the structure the layout loaded, so it follows the reader around
 * the site without the header being rebuilt.
 */
export function VariantSwitcher() {
  const nav = useSiteNav();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDetailsElement>(null);

  // The header is part of the persistent shell, so the menu would otherwise stay open after a choice
  // is made. Also close it on an outside click or Escape, as a dropdown should.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (!nav) return null;
  const { location, baseHref } = nav;
  const variants = location.space.variants;
  if (variants.length <= 1) return null;

  return (
    <details ref={ref} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)} data-placement="variant-switcher" className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-site-border px-2.5 py-1 text-xs font-medium text-site-ink-muted transition hover:text-site-ink [&::-webkit-details-marker]:hidden">
        {location.variant.name}
        <ChevronIcon />
      </summary>
      <nav className="absolute right-0 z-10 mt-1 min-w-[10rem] rounded-md border border-site-border bg-site-canvas py-1 shadow-lg">
        {variants.map((variant) => {
          const isActive = variant.id === location.variant.id;
          const hasEquivalent = isActive || (location.rest.length > 0 && resolveTreePath(variant.tree, location.rest) !== null);
          const segments = [...location.base, ...variantSegments(variant), ...(hasEquivalent ? location.rest : [])];
          return (
            <Link
              key={variant.id}
              href={`${baseHref}/${segments.join("/")}`}
              onClick={() => setOpen(false)}
              className={`block px-3 py-1.5 text-sm transition hover:bg-site-surface ${isActive ? "font-semibold text-site-primary" : "text-site-ink"}`}
            >
              {variant.name}
            </Link>
          );
        })}
      </nav>
    </details>
  );
}

function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 16 16" fill="none" aria-hidden className="transition group-open:rotate-180">
      <path d="M3.5 6l4.5 4 4.5-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
