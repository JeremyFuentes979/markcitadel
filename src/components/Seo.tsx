import { useEffect } from "react";

const DEFAULT_TITLE = "MarkCitadel — Check a business name before you commit";

function upsertMeta(name: string, content: string) {
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", "canonical");
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
}

/** Per-route title, description, canonical, and optional FAQ schema. */
export function Seo({
  title,
  description,
  path,
  faqs,
}: {
  title: string;
  description: string;
  path: string;
  faqs?: { q: string; a: string }[];
}) {
  const faqKey = JSON.stringify(faqs ?? []);

  useEffect(() => {
    document.title = `${title} | MarkCitadel`;
    upsertMeta("description", description);
    const origin = window.location.origin;
    upsertCanonical(`${origin}${path}`);

    const id = "seo-jsonld";
    document.getElementById(id)?.remove();
    const parsed = JSON.parse(faqKey) as { q: string; a: string }[];
    if (parsed.length) {
      const script = document.createElement("script");
      script.id = id;
      script.type = "application/ld+json";
      script.text = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: parsed.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      });
      document.head.appendChild(script);
    }

    return () => {
      document.title = DEFAULT_TITLE;
      document.getElementById(id)?.remove();
    };
  }, [title, description, path, faqKey]);

  return null;
}
