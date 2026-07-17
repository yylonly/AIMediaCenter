declare module 'parse-torrent' {
  interface ParsedTorrent {
    infoHash: string;
    name?: string;
    files?: Array<{ name: string; path: string; length: number }>;
    length?: number;
  }
  function parseTorrent(
    input: Buffer | string | Uint8Array
  ): Promise<ParsedTorrent> | ParsedTorrent;
  export default parseTorrent;
}
