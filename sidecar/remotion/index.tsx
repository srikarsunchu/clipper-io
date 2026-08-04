import { Composition, registerRoot } from "remotion";
import { CaptionedTimeline, calculateCaptionedTimelineMetadata, type CaptionedTimelineProps } from "./CaptionedTimeline";

const defaultProps: CaptionedTimelineProps = {
  segments: [],
  cues: [],
  style: "pop",
  durationSec: 1,
  width: 1080,
  height: 1920,
  fps: 30,
};

const Root: React.FC = () => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <Composition<any, CaptionedTimelineProps>
    id="CaptionedTimeline"
    component={CaptionedTimeline}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
    calculateMetadata={calculateCaptionedTimelineMetadata}
  />
);

registerRoot(Root);
