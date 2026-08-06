import type { TimelineItem } from "./timeline";

export const AI_CLIP_TYPES = [
  "best",
  "hot-take",
  "educational",
  "story",
  "hook",
  "product",
] as const;

export type AiClipType = (typeof AI_CLIP_TYPES)[number];

export interface FindMomentsRequest {
  sourceMediaId: string;
  clipTypes: AiClipType[];
  count: number;
  minDurationSec: number;
  maxDurationSec: number;
  prompt?: string;
}

export type FindMomentsPreferences = Omit<FindMomentsRequest, "sourceMediaId">;

export interface MomentSegment {
  startSec: number;
  endSec: number;
}

export interface MomentScore {
  hook: number;
  selfContained: number;
  payoff: number;
  cleanCut: number;
}

export interface MomentCandidate {
  id: string;
  type: AiClipType;
  title: string;
  reasoning: string;
  transcriptExcerpt: string;
  score: number;
  scoreBreakdown: MomentScore;
  segments: MomentSegment[];
}

export interface AiGeneration {
  id: string;
  sourceMediaId: string;
  request: FindMomentsRequest;
  moments: MomentCandidate[];
  createdAt: string;
}

export interface FindMomentsResponse {
  generation: AiGeneration;
  transcriptMediaId: string;
}

export interface AiEditState {
  generations?: AiGeneration[];
  sourceTimelineSnapshot?: TimelineItem[] | null;
}
