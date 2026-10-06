import { createFileRoute } from "@tanstack/react-router";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function proxied(url: string) {
  return `/api/public/proxy?url=${encodeURIComponent(url)}`;
}

function rewritePlaylist(text: string, base: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        return line.replace(/URI="([^"]+)"/g, (_, uri: string) => `URI="${proxied(new URL(uri, base).href)}"`);
      }
      return proxied(new URL(trimmed, base).href);
    })
    .join("\n");
}

export const Route = createFileRoute("/api/public/proxy")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async ({ request }) => {
        const target = new URL(request.url).searchParams.get("url") ?? "";
        let url: URL;
        try {
          url = new URL(target);
        } catch {
          return new Response("URL inválida", { status: 400, headers: CORS });
        }
        if (!["http:", "https:"].includes(url.protocol) || target.length > 2048) {
          return new Response("URL inválida", { status: 400, headers: CORS });
        }

        let upstream: Response;
        try {
          upstream = await fetch(url.href, {
            headers: { "User-Agent": "Mozilla/5.0", Accept: "*/*" },
            redirect: "follow",
          });
        } catch {
          return new Response("Origem indisponível", { status: 502, headers: CORS });
        }
        if (!upstream.ok) {
          return new Response(`Origem respondeu ${upstream.status}`, { status: upstream.status, headers: CORS });
        }

        const finalUrl = upstream.url || url.href;
        const type = upstream.headers.get("content-type") ?? "";
        const isPlaylist = /mpegurl/i.test(type) || /\.m3u8?(\?|$)/i.test(new URL(finalUrl).pathname + new URL(finalUrl).search);

        if (isPlaylist) {
          const text = await upstream.text();
          if (text.trimStart().startsWith("#EXTM3U")) {
            return new Response(rewritePlaylist(text, finalUrl), {
              headers: { ...CORS, "Content-Type": "application/vnd.apple.mpegurl", "Cache-Control": "no-store" },
            });
          }
          return new Response(text, { headers: { ...CORS, "Content-Type": type || "text/plain" } });
        }

        return new Response(upstream.body, {
          headers: { ...CORS, "Content-Type": type || "application/octet-stream", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
