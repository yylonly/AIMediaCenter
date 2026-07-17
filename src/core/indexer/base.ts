import type { MediaType } from '../meta/types';

export interface TorrentInfo {
  /** Unique key: site + link */
  key: string;
  site: string;
  /** Site domain - used to look up Site config (cookie/passkey) for authed downloads */
  siteDomain?: string;
  siteUrl: string;
  title: string;
  description?: string;
  /** Detail page URL */
  pageUrl?: string;
  /** Actual .torrent or magnet URL */
  enclosure: string;
  size: number;      // bytes
  seeders: number;
  peers: number;
  uploaders?: number;
  /** e.g. movie/tv */
  category?: MediaType;
  /** Volume factors */
  downloadVolumeFactor?: number;
  uploadVolumeFactor?: number;
  publishDate?: string;
  imdbid?: string;
}

export interface SearchQuery {
  keyword: string;
  mtype?: MediaType;
  page?: number; // 1-based
  /** Restrict search to these site domains (empty/undefined = all active sites) */
  sites?: string[];
}

export interface Indexer {
  /** Site domain, matches Site.domain */
  domain: string;
  /** Display name */
  name: string;
  /** Site URL */
  url: string;
  search(q: SearchQuery): Promise<TorrentInfo[]>;
}
