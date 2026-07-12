"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Maximize2, Minimize2, UsersIcon, X } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { StreamEmbed } from "@/components/streams/stream-embed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_MULTI_STREAMS, multiviewGridClass } from "@/lib/co-stream-multiview";
import type { CoStream, StreamPlatform } from "@/lib/stream-types";

const PLATFORM_LABELS: Record<StreamPlatform, string> = {
  twitch: "Twitch",
  kick: "Kick",
  youtube: "YouTube",
  soop: "SOOP",
};

export type MultiStreamGridStrings = {
  multiView: string;
  watching: string;
  loadStream: string;
  streamEnded: string;
  removeStream: string;
  openOn: (platform: string) => string;
  enterFullscreen: string;
  exitFullscreen: string;
  fullscreenFailed: string;
};

export function MultiStreamGrid({
  selected,
  loadedIds,
  parent,
  strings,
  onLoad,
  onRemove,
}: {
  selected: CoStream[];
  loadedIds: string[];
  parent: string;
  strings: MultiStreamGridStrings;
  onLoad: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenStatus, setFullscreenStatus] = useState("");
  const visibleStreams = selected.slice(0, MAX_MULTI_STREAMS);
  const loaded = new Set(loadedIds.slice(0, MAX_MULTI_STREAMS));

  useEffect(() => {
    const container = containerRef.current;
    setFullscreenAvailable(Boolean(document.fullscreenEnabled && container?.requestFullscreen));
    const handleFullscreenChange = () => setIsFullscreen(document.fullscreenElement === container);
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = async () => {
    setFullscreenStatus("");
    try {
      if (document.fullscreenElement === containerRef.current) {
        await document.exitFullscreen();
      } else {
        await containerRef.current?.requestFullscreen();
      }
    } catch {
      setFullscreenStatus(strings.fullscreenFailed);
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 fullscreen:overflow-auto fullscreen:bg-background fullscreen:p-4"
    >
      {fullscreenAvailable ? (
        <div className="flex justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  aria-label={isFullscreen ? strings.exitFullscreen : strings.enterFullscreen}
                  onClick={toggleFullscreen}
                />
              }
            >
              {isFullscreen ? <Minimize2 /> : <Maximize2 />}
            </TooltipTrigger>
            <TooltipContent>{isFullscreen ? strings.exitFullscreen : strings.enterFullscreen}</TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      <p aria-live="polite" className="sr-only">
        {fullscreenStatus}
      </p>
      <section className={multiviewGridClass(visibleStreams.length)} aria-label={strings.multiView}>
        {visibleStreams.map((stream) => {
          const channel = stream.embedChannel;
          const canEmbed = Boolean(stream.isLive && channel);
          const isLoaded = loaded.has(stream.id);
          const platform = channel?.platform ?? stream.channels[0]?.platform;
          const platformLabel = platform ? PLATFORM_LABELS[platform] : "Stream";
          const externalChannel = channel ?? stream.channels.find((candidate) => candidate.url);

          return (
            <article key={stream.id} data-stream-tile={stream.id} className="min-w-0">
              {canEmbed && channel && isLoaded ? (
                <StreamEmbed
                  platform={channel.platform}
                  handle={channel.handle}
                  parent={parent}
                  videoId={channel.videoId}
                  label={stream.label}
                />
              ) : (
                <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border bg-black p-4 text-white">
                  {canEmbed ? (
                    <div className="flex min-w-0 flex-col items-center gap-3 text-center">
                      <span className="max-w-full truncate font-medium">{stream.label}</span>
                      {platform ? <Badge variant="secondary">{platformLabel}</Badge> : null}
                      <Button type="button" variant="secondary" onClick={() => onLoad(stream.id)}>
                        {strings.loadStream}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-sm text-white/80">{strings.streamEnded}</span>
                  )}
                </div>
              )}

              <div className="flex min-w-0 items-center gap-2 py-2">
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{stream.label}</span>
                  {platform ? (
                    <Badge variant="secondary" className="gap-1">
                      <PlatformIcon platform={platform} />
                      {platformLabel}
                    </Badge>
                  ) : null}
                  {stream.isLive && stream.viewerCount != null ? (
                    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <UsersIcon className="size-3.5" />
                      {stream.viewerCount.toLocaleString()} {strings.watching}
                    </span>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {externalChannel?.url ? (
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            render={<a href={externalChannel.url} target="_blank" rel="noreferrer" />}
                            nativeButton={false}
                            variant="ghost"
                            size="icon-sm"
                            aria-label={strings.openOn(PLATFORM_LABELS[externalChannel.platform])}
                          />
                        }
                      >
                        <ExternalLink />
                      </TooltipTrigger>
                      <TooltipContent>{strings.openOn(PLATFORM_LABELS[externalChannel.platform])}</TooltipContent>
                    </Tooltip>
                  ) : null}
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${strings.removeStream}: ${stream.label}`}
                          onClick={() => onRemove(stream.id)}
                        />
                      }
                    >
                      <X />
                    </TooltipTrigger>
                    <TooltipContent>{strings.removeStream}</TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}
