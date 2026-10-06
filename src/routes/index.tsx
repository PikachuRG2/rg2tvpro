import { createFileRoute } from "@tanstack/react-router";
import { Radio, Search, Tv, Wifi, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type Hls from "hls.js";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Channel = { name: string; url: string; group: string; logo: string };

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "RG2 TV — Canais ao vivo" },
      { name: "description", content: "Assista aos seus canais ao vivo na RG2 TV." },
      { property: "og:title", content: "RG2 TV — Canais ao vivo" },
      { property: "og:description", content: "Assista aos seus canais ao vivo na RG2 TV." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function getAttribute(line: string, name: string) {
  return line.match(new RegExp(`${name}="([^"]*)"`, "i"))?.[1] ?? "";
}

function parseM3U(text: string): Channel[] {
  const lines = text.split(/\r?\n/);
  const result: Channel[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const info = lines[index];
    if (!info.startsWith("#EXTINF")) continue;

    let url = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor].trim();
      if (!candidate || candidate.startsWith("#")) continue;
      url = candidate;
      index = cursor;
      break;
    }
    if (!url) continue;

    const comma = info.indexOf(",");
    result.push({
      name: comma >= 0 ? info.slice(comma + 1).trim() : "Canal",
      url,
      group: getAttribute(info, "group-title") || "Outros",
      logo: getAttribute(info, "tvg-logo"),
    });
  }

  return result;
}

function Index() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [activeGroup, setActiveGroup] = useState("Todos");
  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("Carregando sua lista de canais…");
  const [loading, setLoading] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/canais.m3u", { cache: "no-store", signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((text) => {
        const parsed = parseM3U(text);
        setChannels(parsed);
        setStatus(`${parsed.length} canais disponíveis`);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setStatus("Não foi possível carregar a lista de canais.");
      })
      .finally(() => setLoading(false));

    return () => {
      controller.abort();
      hlsRef.current?.destroy();
    };
  }, []);

  const groups = useMemo(
    () => ["Todos", ...new Set(channels.map((channel) => channel.group).filter(Boolean))],
    [channels],
  );
  const filteredChannels = useMemo(() => {
    const normalizedQuery = query.toLocaleLowerCase("pt-BR").trim();
    return channels.filter(
      (channel) =>
        (activeGroup === "Todos" || channel.group === activeGroup) &&
        (!normalizedQuery || channel.name.toLocaleLowerCase("pt-BR").includes(normalizedQuery)),
    );
  }, [activeGroup, channels, query]);

  async function play(channel: Channel) {
    const video = videoRef.current;
    if (!video) return;

    setActiveChannel(channel);
    setStatus("Conectando ao canal…");
    hlsRef.current?.destroy();
    hlsRef.current = null;
    video.pause();
    video.removeAttribute("src");
    video.load();

    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = channel.url;
      video.addEventListener(
        "loadedmetadata",
        () => {
          setStatus("Ao vivo");
          void video.play().catch(() => undefined);
        },
        { once: true },
      );
      return;
    }

    const { default: HlsPlayer } = await import("hls.js");
    if (!HlsPlayer.isSupported()) {
      setStatus("Este navegador não oferece suporte à transmissão.");
      return;
    }

    const player = new HlsPlayer({ enableWorker: true, maxBufferLength: 30 });
    hlsRef.current = player;
    player.loadSource(channel.url);
    player.attachMedia(video);
    player.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
      setStatus("Ao vivo");
      void video.play().catch(() => undefined);
    });
    player.on(HlsPlayer.Events.ERROR, (_, data) => {
      if (data.fatal) setStatus("O canal está indisponível no momento.");
    });
  }

  return (
    <div className="tv-app">
      <header className="app-header">
        <div className="brand" aria-label="RG2 TV">
          <span>RG2</span> TV
          <span className="live-dot" aria-hidden="true" />
        </div>
        <label className="search-box">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Pesquisar canal"
            aria-label="Pesquisar canal"
            autoComplete="off"
          />
        </label>
        <div className="connection-label"><Wifi className="size-4" /> Online</div>
      </header>

      <div className="tv-layout">
        <aside className="channel-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">Navegar</span>
              <h1>Canais</h1>
            </div>
            <span className="channel-count">{filteredChannels.length}</span>
          </div>

          <div className="group-scroller" aria-label="Categorias de canais">
            {groups.map((group) => (
              <Button
                key={group}
                type="button"
                size="chip"
                variant={group === activeGroup ? "primary" : "secondary"}
                onClick={() => setActiveGroup(group)}
                aria-pressed={group === activeGroup}
              >
                {group}
              </Button>
            ))}
          </div>

          <div className="channel-list">
            {loading ? (
              <EmptyState icon={<Radio />} text="Carregando canais…" />
            ) : filteredChannels.length === 0 ? (
              <EmptyState icon={<WifiOff />} text={channels.length ? "Nenhum canal encontrado" : "Lista de canais indisponível"} />
            ) : (
              filteredChannels.map((channel) => (
                <button
                  type="button"
                  key={`${channel.group}-${channel.name}-${channel.url}`}
                  className={cn("channel-row", activeChannel?.url === channel.url && "is-active")}
                  onClick={() => void play(channel)}
                >
                  <span className="channel-logo">
                    {channel.logo ? (
                      <img src={channel.logo} alt="" loading="lazy" />
                    ) : (
                      <Tv className="size-5" aria-hidden="true" />
                    )}
                  </span>
                  <span className="min-w-0 text-left">
                    <strong>{channel.name}</strong>
                    <small>{channel.group}</small>
                  </span>
                  <span className="play-indicator" aria-hidden="true" />
                </button>
              ))
            )}
          </div>
        </aside>

        <main className="player-panel">
          <div className="player-stage">
            <video ref={videoRef} controls playsInline aria-label="Reprodutor RG2 TV" />
            {!activeChannel && (
              <div className="player-placeholder">
                <span className="placeholder-icon"><Tv /></span>
                <strong>Escolha um canal</strong>
                <p>Selecione um canal da lista para começar a assistir.</p>
              </div>
            )}
          </div>
          <div className="now-playing" aria-live="polite">
            <div className="min-w-0">
              <span className="eyebrow">Agora assistindo</span>
              <h2>{activeChannel?.name ?? "Nenhum canal selecionado"}</h2>
            </div>
            <div className={cn("status-badge", status === "Ao vivo" && "is-live")}>
              <span /> {status}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="empty-state">
      {icon}
      <span>{text}</span>
    </div>
  );
}
