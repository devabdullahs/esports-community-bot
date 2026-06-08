"use client";

import { useMemo, useState } from "react";
import { EyeIcon, SendIcon } from "lucide-react";
import { communityGames, localizeText } from "@/lib/community-content";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const channels = [
  { value: "site", label: "Website only" },
  { value: "discord", label: "Discord announcement" },
  { value: "both", label: "Website and Discord" },
];

const statuses = [
  { value: "draft", label: "Draft" },
  { value: "review", label: "Ready for review" },
  { value: "scheduled", label: "Schedule later" },
];

export function NewsComposer() {
  const [gameSlug, setGameSlug] = useState(communityGames[0]?.slug || "");
  const [channel, setChannel] = useState("both");
  const [status, setStatus] = useState("draft");
  const [title, setTitle] = useState("Grand final watch thread");
  const [summary, setSummary] = useState(
    "Everything the community needs before the match starts.",
  );
  const [body, setBody] = useState(
    "Add schedule context, stream links, team notes, and the discussion prompt that should go to Discord.",
  );
  const [publishedState, setPublishedState] = useState<
    "idle" | "ready" | "published"
  >("idle");

  const game = useMemo(
    () =>
      communityGames.find((item) => item.slug === gameSlug) ||
      communityGames[0],
    [gameSlug],
  );
  const selectedChannel = channels.find((item) => item.value === channel);
  const selectedStatus = statuses.find((item) => item.value === status);
  const canPublish = title.trim() && summary.trim() && body.trim();

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_24rem]">
      <Card>
        <CardHeader>
          <CardTitle>News composer</CardTitle>
          <CardDescription>
            Write once, review the public card, then publish when the backend
            workflow is connected.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field>
                <FieldLabel>Game</FieldLabel>
                <Select
                  value={gameSlug}
                  onValueChange={(value) => {
                    if (value) setGameSlug(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {communityGames.map((item) => (
                        <SelectItem key={item.slug} value={item.slug}>
                          {localizeText(item.title, "en")}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Destination</FieldLabel>
                <Select
                  value={channel}
                  onValueChange={(value) => {
                    if (value) setChannel(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {channels.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Status</FieldLabel>
                <Select
                  value={status}
                  onValueChange={(value) => {
                    if (value) setStatus(value);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {statuses.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="news-title">Headline</FieldLabel>
              <Input
                id="news-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Short headline for the community"
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="news-summary">Summary</FieldLabel>
              <Textarea
                id="news-summary"
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                placeholder="One or two lines that explain why this matters"
              />
              <FieldDescription>
                This is the first thing members see on the public game page.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="news-body">Post body</FieldLabel>
              <Textarea
                id="news-body"
                value={body}
                onChange={(event) => setBody(event.target.value)}
                className="min-h-36"
                placeholder="Write the full community update"
              />
              <FieldDescription>
                Keep the post readable enough for the site and concise enough
                to reuse in Discord.
              </FieldDescription>
            </Field>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={() => setPublishedState("ready")}
                disabled={!canPublish}
              >
                <EyeIcon data-icon="inline-start" />
                Mark ready
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPublishedState("published")}
                disabled={!canPublish}
              >
                <SendIcon data-icon="inline-start" />
                Publish preview
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <Badge variant="outline" className="mb-2 w-fit">
            Live preview
          </Badge>
          <CardTitle>{title || "Untitled post"}</CardTitle>
          <CardDescription>{summary || "No summary yet."}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">
              {game ? localizeText(game.title, "en") : "Game"}
            </Badge>
            <Badge variant="outline">{selectedChannel?.label}</Badge>
            <Badge variant="outline">{selectedStatus?.label}</Badge>
          </div>
          <p className="article-copy text-sm leading-6 text-muted-foreground whitespace-pre-wrap">
            {body || "Start writing to preview the post body."}
          </p>
          {publishedState !== "idle" ? (
            <Badge variant="secondary" className="w-fit">
              {publishedState === "ready"
                ? "Ready for review"
                : "Preview published locally"}
            </Badge>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
