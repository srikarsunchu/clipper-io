import { Composition, registerRoot } from "remotion";
import { RenderPlanComposition, calculateRenderPlanMetadata, type RenderPlanCompositionProps } from "../../shared/RenderPlanComposition";
import type { RenderPlan } from "../../shared/render-contract";

const defaultPlan: RenderPlan = {
  width: 1080,
  height: 1920,
  fps: 30,
  durationSec: 1,
  layers: [],
  planHash: "0",
};

const defaultProps: RenderPlanCompositionProps = { plan: defaultPlan };

const Root: React.FC = () => (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  <Composition<any, RenderPlanCompositionProps>
    id="RenderPlanComposition"
    component={RenderPlanComposition}
    durationInFrames={30}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={defaultProps}
    calculateMetadata={calculateRenderPlanMetadata}
  />
);

registerRoot(Root);
