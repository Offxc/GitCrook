"use client";

import { useEffect, useRef, useState } from "react";
import { requestPdfExport, getExportJobStatus, type ExportJobState } from "./exportActions";

const POLL_INTERVAL_MS = 2000;

export function ExportPdfButton({ pageId }: { pageId: string }) {
  const [state, setState] = useState<ExportJobState>({});
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => () => void (pollRef.current && clearInterval(pollRef.current)), []);

  function pollJob(jobId: string) {
    pollRef.current = setInterval(async () => {
      const result = await getExportJobStatus(jobId);
      setState(result);
      if (result.status === "DONE" || result.status === "FAILED" || result.error) {
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, POLL_INTERVAL_MS);
  }

  async function handleClick() {
    setState({ status: "PENDING" });
    const result = await requestPdfExport(pageId);
    setState(result);
    if (result.jobId) pollJob(result.jobId);
  }

  if (state.status === "DONE" && state.resultAssetId) {
    return (
      <a href={`/api/files/${state.resultAssetId}`} className="text-sm text-brand hover:underline">
        Download PDF ↓
      </a>
    );
  }

  if (state.status === "PENDING" || state.status === "PROCESSING") {
    return <span className="text-sm text-ink-muted">Generating PDF...</span>;
  }

  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={handleClick} className="text-sm text-ink-muted hover:text-ink">
        Export PDF
      </button>
      {state.error ? <span className="text-xs text-danger">{state.error}</span> : null}
    </div>
  );
}
