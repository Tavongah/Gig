import { photos } from "../../data/photos";
import "../../styles/home.css";

export function BrandBand() {
  return (
    <section className="duts-section duts-section--light">
      <div className="duts-container duts-brandband">
        <div>
          <p className="duts-eyebrow">
            <span className="duts-eyebrow__pip" />
            Company
          </p>
          <h2 className="duts-section__title duts-section__title--wide">
            Built for ambitious businesses everywhere.
          </h2>
          <p className="duts-section__lead">
            DUTS AI helps companies use practical artificial intelligence to attract customers,
            automate repetitive work, improve service and grow — with products for speed and custom
            solutions for complex workflows.
          </p>
          <p className="duts-markets" style={{ textAlign: "left", marginTop: "1.25rem", color: "#475569" }}>
            <strong style={{ color: "#0f172a" }}>United States</strong> · South Africa · Zimbabwe
          </p>
        </div>
        <div className="duts-brandband__photo">
          <img
            src={photos.officeTeam}
            alt="Team collaborating in a modern workplace"
            width={1400}
            height={1050}
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
    </section>
  );
}
