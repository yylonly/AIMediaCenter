// Meta types shared across the metadata pipeline (ported from MoviePilot's MetaBase).

export type MediaType = 'movie' | 'tv' | 'unknown';

export interface MetaInfo {
  /** Original raw input filename */
  original: string;
  /** Detected Chinese title (if any) */
  cnName?: string;
  /** Detected English/Latin title (if any) */
  enName?: string;
  /** Preferred display title */
  title: string;
  year?: string;
  type: MediaType;
  seasonBegin?: number;
  seasonEnd?: number;
  episodeBegin?: number;
  episodeEnd?: number;
  part?: string;
  /** e.g. 1080p / 2160p / 4K */
  resourcePix?: string;
  /** BluRay / WEB-DL / HDTV / Remux */
  resourceType?: string;
  /** DV / HDR / Atmos / 3D — accumulated */
  resourceEffect?: string[];
  /** e.g. H264 / H.265 / x265 */
  videoEncode?: string;
  /** e.g. DTS-HDMA / Atmos / DDP5.1 */
  audioEncode?: string;
  /** Release group after the trailing "-" */
  resourceTeam?: string;
  /** Any extension we didn't consume */
  fileExt?: string;
}
