export function BrandBand() {
  return (
    <section className="section">
      <div className="container duts-brandband">
        <div>
          <p className="eyebrow">Company</p>
          <h2 className="section-title section-title--wide">
            Built for ambitious businesses everywhere.
          </h2>
          <p className="section-copy">
            DUTS AI helps companies use practical artificial intelligence to attract customers,
            automate repetitive work, improve service and grow — with products for speed and custom
            solutions for complex workflows.
          </p>
          <p className="duts-markets" style={{ textAlign: "left", marginTop: "1.25rem" }}>
            <strong>United States</strong> · South Africa · Zimbabwe
          </p>
        </div>
        <div className="duts-brandband__photo">
          <img
            src="/brand/duts-office.jpg"
            alt="DUTS AI brand presence in a modern workspace"
            width={1200}
            height={900}
            loading="lazy"
          />
        </div>
      </div>
    </section>
  );
}
