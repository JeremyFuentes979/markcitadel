/**
 * After `vite build`, write indexable HTML for each curated
 * "Is [name] trademarked?" URL. The SPA still boots from the same bundle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLEARANCE_EXAMPLES,
  nameToSlug,
  pageCopy,
  relatedExamples,
} from "../src/data/clearanceSeo.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist/public");
const origin = "https://markcitadel.com";

const shell = fs.readFileSync(path.join(dist, "index.html"), "utf8");

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

function render(name, kind, slug) {
  const copy = pageCopy(name, kind);
  const related = relatedExamples(slug, 4);
  const url = `${origin}/is/${slug}`;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: copy.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  }).replace(/</g, "\\u003c");

  const article = `<article>
    <h1>${esc(copy.title)}</h1>
    <p>${esc(copy.description)}</p>
    ${copy.faqs.map((f) => `<section><h2>${esc(f.q)}</h2><p>${esc(f.a)}</p></section>`).join("")}
    <p><a href="/namecheck?name=${encodeURIComponent(name)}">Check ${esc(name)} free</a></p>
    <ul>${related.map((r) => `<li><a href="/is/${r.slug}">Is ${esc(r.name)} trademarked?</a></li>`).join("")}</ul>
  </article>`;

  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(copy.title)} | MarkCitadel</title>`)
    .replace(
      /<meta name="description" content="[^"]*" \/>/,
      `<meta name="description" content="${esc(copy.description)}" />`,
    )
    .replace(
      "</head>",
      `<link rel="canonical" href="${url}" />
    <meta property="og:title" content="${esc(copy.title)}" />
    <meta property="og:description" content="${esc(copy.description)}" />
    <meta property="og:url" content="${url}" />
    <script type="application/ld+json">${jsonLd}</script>
  </head>`,
    )
    .replace('<div id="root"></div>', `<div id="root">${article}</div>`);
}

const urls = [`${origin}/`, `${origin}/namecheck`, `${origin}/pricing`];

for (const ex of CLEARANCE_EXAMPLES) {
  const slug = nameToSlug(ex.name);
  const dir = path.join(dist, "is", slug);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.html"), render(ex.name, ex.kind, slug));
  urls.push(`${origin}/is/${slug}`);
}

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
fs.writeFileSync(path.join(dist, "sitemap.xml"), sitemap);
fs.writeFileSync(
  path.join(dist, "robots.txt"),
  `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`,
);

console.log(`prerendered ${CLEARANCE_EXAMPLES.length} name pages`);
