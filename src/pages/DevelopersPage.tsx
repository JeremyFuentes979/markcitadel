import { Link } from "react-router";
import { Bot, Globe, Gauge, Zap } from "lucide-react";
import { Layout } from "@/components/Layout";
import { CodeBlock } from "@/components/CodeBlock";
import { ApiKeysSection } from "@/components/ApiKeysSection";

function ParamTable({
  rows,
}: {
  rows: { name: string; type: string; desc: string }[];
}) {
  return (
    <div className="overflow-x-auto border rounded-xl mt-4">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-slate-50 text-left text-slate-500">
            <th className="px-4 py-2.5 font-medium">Parameter</th>
            <th className="px-4 py-2.5 font-medium">Type</th>
            <th className="px-4 py-2.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-4 py-2.5 font-mono text-navy-700 whitespace-nowrap">
                {r.name}
              </td>
              <td className="px-4 py-2.5 text-slate-500 whitespace-nowrap">
                {r.type}
              </td>
              <td className="px-4 py-2.5 text-slate-600">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function DevelopersPage() {
  const origin =
    typeof window !== "undefined" ? window.location.origin : "https://your-site";

  return (
    <Layout>
      <div className="max-w-4xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold text-slate-900">Connector API</h1>
        <p className="mt-3 text-slate-600 leading-relaxed max-w-2xl">
          MarkCitadel exposes the same live USPTO data used by this
          website as a JSON API. Drop it into a domain checker, an LLC
          formation flow, a naming tool — or hand the OpenAPI spec to an AI
          agent and let it search on its own.
        </p>

        <div className="grid sm:grid-cols-3 gap-4 mt-8">
          {[
            {
              icon: Gauge,
              title: "Free tier",
              desc: "30 requests/min, 1,000/month per key. No credit card.",
            },
            {
              icon: Globe,
              title: "CORS enabled",
              desc: "Callable from any website, backend, or no-code tool.",
            },
            {
              icon: Bot,
              title: "AI-ready",
              desc: "OpenAPI 3.0 + MCP server for agent tool-use.",
            },
          ].map((f) => (
            <div key={f.title} className="border rounded-xl p-4 bg-white">
              <f.icon className="w-5 h-5 text-navy-600 mb-2" />
              <div className="font-medium text-slate-900 text-sm">{f.title}</div>
              <div className="text-xs text-slate-500 mt-1">{f.desc}</div>
            </div>
          ))}
        </div>

        {/* API keys */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">Get an API key</h2>
          <p className="mt-2 text-sm text-slate-600">
            Data endpoints require a free key — send it as{" "}
            <code>Authorization: Bearer pmk_…</code>. Rate and quota info comes
            back in <code>X-RateLimit-*</code> and <code>X-Quota-*</code>{" "}
            headers on every response.
          </p>
          <div className="mt-4">
            <ApiKeysSection origin={origin} />
          </div>
        </section>

        {/* Trademarks */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">
            Search trademarks
          </h2>
          <div className="mt-3 font-mono text-sm bg-navy-50 text-navy-800 rounded-lg px-4 py-3 overflow-x-auto">
            GET {origin}/api/v1/trademarks/search?q=&#123;query&#125;
          </div>
          <ParamTable
            rows={[
              {
                name: "q",
                type: "string (required)",
                desc: "Brand name, owner name, or 6–8 digit serial/registration number. Fielded syntax: wordmark:, ownerName:, attorney:.",
              },
              {
                name: "status",
                type: "all | live | dead",
                desc: "Filter by trademark status. Default: all.",
              },
              {
                name: "page",
                type: "integer",
                desc: "Page number, starting at 1.",
              },
              {
                name: "per_page",
                type: "integer (max 50)",
                desc: "Results per page. Default: 25.",
              },
            ]}
          />
          <CodeBlock
            className="mt-4"
            language="curl"
            code={`curl -H "Authorization: Bearer pmk_YOUR_KEY" \\
  "${origin}/api/v1/trademarks/search?q=acme&status=live&per_page=5"`}
          />
        </section>

        {/* Patents */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">
            Search patents
          </h2>
          <div className="mt-3 font-mono text-sm bg-navy-50 text-navy-800 rounded-lg px-4 py-3 overflow-x-auto">
            GET {origin}/api/v1/patents/search?q=&#123;query&#125;
          </div>
          <ParamTable
            rows={[
              {
                name: "q",
                type: "string (required)",
                desc: "Free text across the USPTO collection. Field codes: .ti. (title), .ab. (abstract), .as. (applicant), .in. (inventor) — e.g. drone.ti.",
              },
              {
                name: "sort",
                type: "relevance | newest | oldest",
                desc: "Result ordering. Default: newest.",
              },
              {
                name: "page",
                type: "integer",
                desc: "Page number, starting at 1.",
              },
              {
                name: "per_page",
                type: "integer (max 50)",
                desc: "Results per page. Default: 25.",
              },
            ]}
          />
          <CodeBlock
            className="mt-4"
            language="curl"
            code={`curl -H "Authorization: Bearer pmk_YOUR_KEY" \\
  "${origin}/api/v1/patents/search?q=autonomous%20vehicle&sort=relevance"`}
          />
        </section>

        {/* Image search */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">
            Search trademarks by image
          </h2>
          <div className="mt-3 font-mono text-sm bg-navy-50 text-navy-800 rounded-lg px-4 py-3 overflow-x-auto">
            POST {origin}/api/v1/trademarks/image-search
          </div>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Upload a logo or design (multipart form, max 5 MB) and get
            visually similar marks enriched with the full USPTO record —
            thumbnails, owners, filing dates, classes, and live/dead status.
            Optionally combine the image with a keyword, restrict by status
            (<code>live</code>/<code>dead</code>) or Nice classes
            (<code>classes=9,25</code>). Either <code>file</code>,{" "}
            <code>image_url</code>, or <code>text</code> is required — or use
            them together for hybrid search.
          </p>
          <CodeBlock
            className="mt-4"
            language="curl"
            code={`# Image only
curl -X POST -H "Authorization: Bearer pmk_YOUR_KEY" \\
  -F "file=@logo.png" \\
  "${origin}/api/v1/trademarks/image-search"

# Hybrid: logo + keyword, live marks only
curl -X POST -H "Authorization: Bearer pmk_YOUR_KEY" \\
  -F "file=@logo.png" \\
  -F "text=coffee" \\
  -F "status=live" \\
  -F "classes=30,43" \\
  "${origin}/api/v1/trademarks/image-search"`}
          />
        </section>

        {/* AI assistants */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">
            Use it inside Claude &amp; ChatGPT
          </h2>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            This site is also a live MCP (Model Context Protocol) server — the
            open standard both Anthropic and OpenAI use for connectors. Once
            connected, the assistant can search USPTO data mid-conversation.
          </p>

          <div className="grid md:grid-cols-2 gap-5 mt-5">
            <div className="border rounded-2xl p-5 bg-white">
              <div className="font-semibold text-slate-900">
                Anthropic Claude
              </div>
              <ol className="mt-3 text-sm text-slate-600 space-y-2 list-decimal pl-5">
                <li>
                  In Claude, open{" "}
                  <span className="font-medium">
                    Customize → Connectors → + → Add custom connector
                  </span>
                </li>
                <li>
                  Paste the MCP URL below, and add your API key as an{" "}
                  <code>Authorization: Bearer pmk_…</code> header
                </li>
                <li>
                  Enable the connector in a chat and ask things like{" "}
                  <em>“Is the name Acme Robotics trademarked?”</em>
                </li>
              </ol>
              <CodeBlock
                className="mt-4"
                language="MCP server URL"
                code={`${origin}/api/mcp`}
              />
            </div>
            <div className="border rounded-2xl p-5 bg-white">
              <div className="font-semibold text-slate-900">
                OpenAI ChatGPT
              </div>
              <ol className="mt-3 text-sm text-slate-600 space-y-2 list-decimal pl-5">
                <li>
                  <span className="font-medium">Deep research / connectors:</span>{" "}
                  add the same MCP URL — the required <code>search</code> and{" "}
                  <code>fetch</code> tools are built in
                </li>
                <li>
                  <span className="font-medium">Custom GPTs:</span> create a GPT
                  Action from the OpenAPI spec below
                </li>
                <li>
                  <span className="font-medium">Responses / Agents API:</span>{" "}
                  pass the MCP URL as a remote MCP server tool
                </li>
              </ol>
              <CodeBlock
                className="mt-4"
                language="OpenAPI spec"
                code={`${origin}/api/v1/openapi.json`}
              />
            </div>
          </div>

          <CodeBlock
            className="mt-5"
            language="Raw MCP protocol (what the AI sends)"
            code={`# List available tools (no key needed for discovery)
curl -X POST "${origin}/api/mcp" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call the trademark search tool (API key required)
curl -X POST "${origin}/api/mcp" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer pmk_YOUR_KEY" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_trademarks","arguments":{"query":"acme","status":"live"}}}'`}
          />
        </section>

        {/* AI integration */}
        <section className="mt-12">
          <h2 className="text-xl font-semibold text-slate-900">
            Connect your own app or agent
          </h2>
          <p className="mt-3 text-sm text-slate-600 leading-relaxed">
            Any agent framework that can call HTTP endpoints or ingest OpenAPI
            specs can use this connector. Point it at the machine-readable spec:
          </p>
          <CodeBlock
            className="mt-4"
            language="text"
            code={`${origin}/api/v1/openapi.json`}
          />
          <CodeBlock
            className="mt-4"
            language="JavaScript"
            code={`// Check a business name before forming an LLC
const res = await fetch(
  "${origin}/api/v1/trademarks/search?q=" + encodeURIComponent(name) + "&status=live",
  { headers: { Authorization: "Bearer pmk_YOUR_KEY" } }
);
const data = await res.json();

if (data.total > 0) {
  console.log(\`⚠️ \${data.total} live marks found — top hit: \${data.results[0].wordmark} (\${data.results[0].owner})\`);
} else {
  console.log("✅ No live federal marks found for", name);
}`}
          />
          <CodeBlock
            className="mt-4"
            language="Python"
            code={`import requests

resp = requests.get(
    "${origin}/api/v1/patents/search",
    params={"q": "machine learning", "sort": "relevance", "per_page": 10},
    headers={"Authorization": "Bearer pmk_YOUR_KEY"},
)
for p in resp.json()["results"]:
    print(p["documentId"], "-", p["title"])`}
          />
        </section>

        {/* Notes */}
        <section className="mt-12 bg-amber-50 border border-amber-200 rounded-2xl p-6">
          <div className="flex items-center gap-2 font-medium text-amber-900">
            <Zap className="w-4 h-4" /> Fair use &amp; data notes
          </div>
          <ul className="mt-3 text-sm text-amber-800 space-y-1.5 list-disc pl-5">
            <li>
              Data is served live from official USPTO systems (Open Data
              Portal, Patent Public Search, Trademark Search) and lightly
              cached (5 minutes) for performance.
            </li>
            <li>
              This service is not affiliated with or endorsed by the USPTO.
              API use is subject to the{" "}
              <Link to="/terms" className="underline">
                Terms of Service
              </Link>
              ; if you redistribute the data, attribute the USPTO as the
              source.
            </li>
            <li>
              Patent results are capped at the first 1,000 matches per query by
              the USPTO service.
            </li>
            <li>
              Please keep request rates reasonable — heavy abuse may be
              throttled.
            </li>
            <li>
              This API provides search data only; it is not legal advice and
              does not replace a professional clearance search.
            </li>
          </ul>
        </section>
      </div>
    </Layout>
  );
}
