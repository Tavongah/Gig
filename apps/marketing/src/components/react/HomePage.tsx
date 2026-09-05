import "../../styles/home.css";
import { HeroSection } from "./HeroSection";
import { TrustStrip } from "./TrustStrip";
import { SolutionsSection, type Solution } from "./SolutionsSection";
import { SolutionStories } from "./SolutionStories";
import { GrowthPlatformSection } from "./GrowthPlatformSection";
import { StickyIntelligence } from "./StickyIntelligence";
import { HowItWorksSection } from "./HowItWorksSection";
import { ProductsVsSolutions } from "./ProductsVsSolutions";
import { IndustriesGallery } from "./IndustriesGallery";
import { WhyDuts } from "./WhyDuts";
import { AIPathfinder } from "./AIPathfinder";
import { BrandBand } from "./BrandBand";
import { FinalCTA } from "./FinalCTA";

type Step = { n: string; title: string; body: string };
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
  principles,
  pathfinderOptions
}: {
  solutions: Solution[];
  steps: Step[];
  industries?: unknown;
  principles: Principle[];
  pathfinderOptions: PathOption[];
}) {
  return (
    <>
      <HeroSection />
      <TrustStrip />
      <SolutionStories />
      <SolutionsSection
        solutions={solutions}
        eyebrow="All capabilities"
        title="A complete set of practical AI building blocks."
        lead="Explore the full range — then start with the one problem costing you the most time or customers."
      />
      <GrowthPlatformSection />
      <StickyIntelligence />
      <HowItWorksSection steps={steps} />
      <ProductsVsSolutions />
      <IndustriesGallery />
      <WhyDuts principles={principles} />
      <AIPathfinder options={pathfinderOptions} />
      <BrandBand />
      <FinalCTA />
    </>
  );
}
