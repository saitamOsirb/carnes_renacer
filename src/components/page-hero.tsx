import Image from "next/image";

export function PageHero({ eyebrow, title, subtitle, image }: { eyebrow: string; title: string; subtitle: string; image: string }) {
  return (
    <section className="page-hero">
      <div className="container page-hero-grid">
        <div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></div>
        <div className="page-hero-image"><Image src={image} alt="" fill priority sizes="(max-width: 900px) 100vw, 48vw" /></div>
      </div>
    </section>
  );
}
