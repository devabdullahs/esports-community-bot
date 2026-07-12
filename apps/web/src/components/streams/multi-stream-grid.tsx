"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ExternalLink, GripVertical, Maximize2, Minimize2, UsersIcon, X } from "lucide-react";
import { PlatformIcon } from "@/components/platform-icon";
import { StreamEmbed } from "@/components/streams/stream-embed";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MAX_MULTI_STREAMS, multiviewGridClass, multiviewTileClass } from "@/lib/co-stream-multiview";
import { cn } from "@/lib/utils";
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
  reorderStream: (name: string) => string;
  streamMoved: (name: string) => string;
  mobileTwitchUnavailable: string;
};

function SortableStreamTile({
  id,
  className,
  dragLabel,
  children,
}: {
  id: string;
  className?: string;
  dragLabel: string;
  children: (dragHandle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
  });
  const dragHandle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="touch-none cursor-grab active:cursor-grabbing"
            aria-label={dragLabel}
            {...attributes}
            {...listeners}
          />
        }
      >
        <GripVertical />
      </TooltipTrigger>
      <TooltipContent>{dragLabel}</TooltipContent>
    </Tooltip>
  );

  return (
    <article
      ref={setNodeRef}
      data-stream-tile={id}
      className={cn("min-w-0 touch-manipulation", isDragging && "opacity-70", className)}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      {children(dragHandle)}
    </article>
  );
}

export function MultiStreamGrid({
  selected,
  loadedIds,
  parent,
  strings,
  autoplay = true,
  twitchEmbedsSupported = true,
  compactViewport = false,
  onLoad,
  onRemove,
  onReorder,
}: {
  selected: CoStream[];
  loadedIds: string[];
  parent: string;
  strings: MultiStreamGridStrings;
  autoplay?: boolean;
  twitchEmbedsSupported?: boolean;
  compactViewport?: boolean;
  onLoad: (id: string) => void;
  onRemove: (id: string) => void;
  onReorder: (activeId: string, overId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [fullscreenAvailable, setFullscreenAvailable] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenStatus, setFullscreenStatus] = useState("");
  const visibleStreams = selected.slice(0, MAX_MULTI_STREAMS);
  const loaded = new Set(loadedIds.slice(0, MAX_MULTI_STREAMS));
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

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

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const stream = visibleStreams.find((candidate) => candidate.id === active.id);
    onReorder(String(active.id), String(over.id));
    setFullscreenStatus(strings.streamMoved(stream?.label ?? String(active.id)));
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col gap-3 fullscreen:h-screen fullscreen:overflow-auto fullscreen:bg-background fullscreen:p-4"
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
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={visibleStreams.map((stream) => stream.id)}>
          <section className={multiviewGridClass(visibleStreams.length)} aria-label={strings.multiView}>
            {visibleStreams.map((stream, index) => {
              const channel = stream.embedChannel;
              const canEmbed = Boolean(stream.isLive && channel);
              const isLoaded = loaded.has(stream.id);
              const platform = channel?.platform ?? stream.channels[0]?.platform;
              const platformLabel = platform ? PLATFORM_LABELS[platform] : "Stream";
              const externalChannel = channel ?? stream.channels.find((candidate) => candidate.url);
              const mobileTwitchUnavailable = channel?.platform === "twitch" && !twitchEmbedsSupported;

              return (
                <SortableStreamTile
                  key={stream.id}
                  id={stream.id}
                  className={multiviewTileClass(visibleStreams.length, index)}
                  dragLabel={strings.reorderStream(stream.label)}
                >
                  {(dragHandle) => (
                    <>
                      {canEmbed && channel && isLoaded && !mobileTwitchUnavailable ? (
                        <StreamEmbed
                          platform={channel.platform}
                          handle={channel.handle}
                          parent={parent}
                          videoId={channel.videoId}
                          label={stream.label}
                          autoplay={autoplay}
                          minimumTwitchHeight={compactViewport}
                        />
                      ) : (
                        <div className="flex aspect-video w-full items-center justify-center overflow-hidden rounded-lg border bg-black p-4 text-white">
                          {mobileTwitchUnavailable && externalChannel?.url ? (
                            <div className="flex min-w-0 flex-col items-center gap-3 text-center">
                              <span className="max-w-full truncate font-medium">{stream.label}</span>
                              <Badge variant="secondary">{platformLabel}</Badge>
                              <p className="max-w-sm text-sm text-white/75">{strings.mobileTwitchUnavailable}</p>
                              <Button
                                render={<a href={externalChannel.url} target="_blank" rel="noreferrer" />}
                                nativeButton={false}
                                variant="secondary"
                              >
                                <ExternalLink data-icon="inline-start" />
                                {strings.openOn(platformLabel)}
                              </Button>
                            </div>
                          ) : canEmbed ? (
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
                          {visibleStreams.length > 1 ? dragHandle : null}
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
                              <TooltipContent>
                                {strings.openOn(PLATFORM_LABELS[externalChannel.platform])}
                              </TooltipContent>
                            </Tooltip>
                          ) : null}
                          {visibleStreams.length > 1 ? (
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
                          ) : null}
                        </div>
                      </div>
                    </>
                  )}
                </SortableStreamTile>
              );
            })}
          </section>
        </SortableContext>
      </DndContext>
    </div>
  );
}
