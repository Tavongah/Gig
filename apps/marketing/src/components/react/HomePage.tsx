import "../../styles/home.css";
import { HeroSection } from "./HeroSection";
import { TrustStrip } from "./TrustStrip";
import { SolutionsSection, type Solution } from "./SolutionsSection";
import { GrowthPlatformSection } from "./GrowthPlatformSection";
import { DutsIntelligenceDiagram } from "./DutsIntelligenceDiagram";
import { HowItWorksSection } from "./HowItWorksSection";
import { ProductsVsSolutions } from "./ProductsVsSolutions";
import { IndustriesSection } from "./IndustriesSection";
import { WhyDuts } from "./WhyDuts";
import { AIPathfinder } from "./AIPathfinder";
import { BrandBand } from "./BrandBand";
import { FinalCTA } from "./FinalCTA";

type Step = { n: string; title: string; body: string };
type Industry = { name: string; useCase: string };
type Principle = { title: string; body: string };
type PathOption = {
  id: string;
  label: string;
  solutions: readonly string[] | string[];
  message: string;
};

export function HomePage({
  solutions,
  steps,
  industries,
  principles,
  pathfinderOptions
}: {
  solutions: Solution[];
  steps: Step[];
  industries: Industry[];
  principles: Principle[];
  pathfinderOptions: PathOption[];
}) {
  return (
    <>
      <HeroSection />
      <TrustStrip />
      <SolutionsSection solutions={solutions} />
      <GrowthPlatformSection />
      <DutsIntelligenceDiagram />
      <HowItWorksSection steps={steps} />
      <ProductsVsSolutions />
      <IndustriesSection industries={industries} />
      <WhyDuts principles={principles} />
      <AIPathfinder options={pathfinderOptions} />
      <BrandBand />
      <FinalCTA />
    </>
  );
}
