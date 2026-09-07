"use client";

import { usePathname } from "next/navigation";
import { RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useLoadingElapsed } from "@/components/use-loading-elapsed";

export function PageLoading() {
  const pathname = usePathname();
  const ar = pathname === "/ar" || pathname?.startsWith("/ar/");
  const elapsed = useLoadingElapsed();
  const takingLonger = elapsed >= 10;

  return (
    <section className="ec-container ec-page-loading" aria-label={ar ? "تحميل الصفحة" : "Loading page"}>
      <div className="ec-loading-track" aria-hidden="true"><span /></div>
      <div className="ec-loading-heading">
        <span className="ec-loading-spinner" aria-hidden="true" />
        <div>
          <h1>{ar ? "جارٍ تحميل الصفحة" : "Loading your page"}</h1>
          <p>{ar ? "نجهّز المحتوى المطلوب." : "Getting the content you requested."}</p>
          <p aria-hidden="true" className="tabular-nums">{ar ? `وقت الانتظار: ${elapsed} ث` : `Waiting ${elapsed}s`}</p>
        </div>
      </div>
      <div role="status" aria-live="polite" aria-atomic="true" className="ec-loading-status">
        {takingLonger ? (ar ? "يستغرق التحميل وقتًا أطول من المعتاد. يمكنك الانتظار أو إعادة تحميل الصفحة." : "This is taking longer than usual. You can keep waiting or reload the page.") : null}
      </div>
      {takingLonger ? <Button type="button" variant="outline" onClick={() => window.location.reload()}><RefreshCwIcon />{ar ? "إعادة تحميل الصفحة" : "Reload page"}</Button> : null}
      <div className="ec-loading-content" aria-hidden="true">
        <div className="ec-loading-main">
          <div className="ec-loading-placeholder ec-loading-title" />
          {[0, 1, 2, 3].map((row) => (
            <div className="ec-loading-row" key={row}>
              <div className="ec-loading-placeholder ec-loading-mark" />
              <div className="ec-loading-lines"><div className="ec-loading-placeholder" /><div className="ec-loading-placeholder" /></div>
              <div className="ec-loading-placeholder ec-loading-score" />
            </div>
          ))}
        </div>
        <div className="ec-loading-aside"><div className="ec-loading-placeholder ec-loading-cover" /><div className="ec-loading-placeholder ec-loading-title" /><div className="ec-loading-placeholder" /></div>
      </div>
    </section>
  );
}
