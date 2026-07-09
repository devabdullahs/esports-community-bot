"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { getAdminCopy } from "@/lib/admin-copy";
import { guardedAdminNavigationHref } from "@/lib/admin-navigation";
import type { Locale } from "@/lib/i18n";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type AdminNavigationGuardContextValue = {
  setDirtySource: (sourceId: string, dirty: boolean) => void;
  allowNextNavigation: () => void;
};

const AdminNavigationGuardContext = createContext<AdminNavigationGuardContextValue | null>(null);

export function AdminNavigationGuardProvider({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  const router = useRouter();
  const [dirtySources, setDirtySources] = useState<Set<string>>(() => new Set());
  const dirtySourcesRef = useRef(dirtySources);
  const allowNextNavigationRef = useRef(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const t = getAdminCopy(locale).navigationGuard;

  useEffect(() => {
    dirtySourcesRef.current = dirtySources;
  }, [dirtySources]);

  const setDirtySource = useCallback((sourceId: string, dirty: boolean) => {
    setDirtySources((prev) => {
      const alreadyDirty = prev.has(sourceId);
      if (alreadyDirty === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  }, []);

  const allowNextNavigation = useCallback(() => {
    allowNextNavigationRef.current = true;
  }, []);

  useEffect(() => {
    if (dirtySources.size === 0) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtySources.size]);

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (dirtySourcesRef.current.size === 0) return;
      if (allowNextNavigationRef.current) {
        allowNextNavigationRef.current = false;
        return;
      }
      if (event.defaultPrevented) return;

      const target = event.target instanceof Element ? event.target : null;
      const anchor = target?.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = guardedAdminNavigationHref({
        href: anchor.getAttribute("href") ?? anchor.href,
        currentUrl: window.location.href,
        button: event.button,
        metaKey: event.metaKey,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        download: anchor.hasAttribute("download"),
        target: anchor.getAttribute("target"),
      });
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();
      setPendingHref(href);
      setConfirmOpen(true);
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  const contextValue = useMemo(
    () => ({ setDirtySource, allowNextNavigation }),
    [allowNextNavigation, setDirtySource],
  );

  const discardAndContinue = useCallback(() => {
    const href = pendingHref;
    if (!href) return;
    setDirtySources(new Set());
    setPendingHref(null);
    setConfirmOpen(false);
    router.push(href);
  }, [pendingHref, router]);

  return (
    <AdminNavigationGuardContext.Provider value={contextValue}>
      {children}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          setConfirmOpen(open);
          if (!open) setPendingHref(null);
        }}
        title={t.title}
        description={t.description}
        cancelLabel={t.cancel}
        actions={[
          {
            label: t.discard,
            variant: "destructive",
            onClick: discardAndContinue,
          },
        ]}
      />
    </AdminNavigationGuardContext.Provider>
  );
}

export function useAdminNavigationGuard(sourceId: string, dirty: boolean) {
  const guard = useContext(AdminNavigationGuardContext);
  useEffect(() => {
    if (!guard) return;
    guard.setDirtySource(sourceId, dirty);
    return () => guard.setDirtySource(sourceId, false);
  }, [dirty, guard, sourceId]);

  return {
    allowNextNavigation: guard?.allowNextNavigation ?? (() => undefined),
  };
}
