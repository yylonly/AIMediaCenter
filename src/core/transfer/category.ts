// Media category inference from TMDB metadata.
//
// Each PathRule targets a specific MediaCategory; at organise time we infer
// the category from the matched TMDB detail's genres + origin_country +
// original_language, then pick the matching rule's library/download dirs.

export type MediaType = 'movie' | 'tv';

// Movie categories
export type MovieCategory =
  | 'animation-movie'
  | 'chinese-movie'
  | 'foreign-movie';

// TV categories
export type TvCategory =
  | 'cn-drama'
  | 'asian-drama'
  | 'us-drama'
  | 'cn-anime'
  | 'jp-anime';

export type MediaCategory = MovieCategory | TvCategory;

/** Chinese display labels for each category. */
export const CATEGORY_LABELS: Record<MediaCategory, string> = {
  'animation-movie': '动画电影',
  'chinese-movie': '华语电影',
  'foreign-movie': '外语电影',
  'cn-drama': '国产剧',
  'asian-drama': '日韩剧',
  'us-drama': '欧美剧',
  'cn-anime': '国漫',
  'jp-anime': '日漫'
};

/** Categories grouped by media type, for the settings UI dropdowns. */
export const CATEGORIES_BY_TYPE: Record<MediaType, MediaCategory[]> = {
  movie: ['animation-movie', 'chinese-movie', 'foreign-movie'],
  tv: ['cn-drama', 'asian-drama', 'us-drama', 'cn-anime', 'jp-anime']
};

/** Which media type a category belongs to. */
export function categoryType(c: MediaCategory): MediaType {
  return c === 'animation-movie' || c === 'chinese-movie' || c === 'foreign-movie'
    ? 'movie'
    : 'tv';
}

// TMDB genre id 16 = Animation (same id for movies and tv).
const GENRE_ANIMATION = 16;
// Country codes considered "Chinese-speaking" for movie categorisation.
const CN_COUNTRIES = new Set(['CN', 'HK', 'TW']);
// Asian (non-CN) countries for the asian-drama bucket.
const ASIAN_COUNTRIES = new Set(['KR', 'JP', 'TH', 'TW']);

/**
 * Infer a media category from TMDB metadata. Rules are applied in priority
 * order: animation (genre 16) is checked first because an animated Chinese
 * or Japanese work should land in the anime buckets, not the live-action
 * country buckets.
 *
 *   movie + genre 16                      -> animation-movie
 *   tv + genre 16 + original_language=ja -> jp-anime
 *   tv + genre 16 + origin_country CN     -> cn-anime
 *   tv + genre 16 (other)                 -> jp-anime (anime defaults to JP)
 *   movie + origin_country CN/HK/TW        -> chinese-movie
 *   tv + origin_country CN                -> cn-drama
 *   tv + origin_country KR/JP/TH/TW       -> asian-drama
 *   movie (other)                         -> foreign-movie
 *   tv (other)                            -> us-drama
 */
export function inferMediaCategory(
  type: MediaType,
  genres: number[] = [],
  originCountry: string[] = [],
  originalLanguage?: string
): MediaCategory {
  const isAnimation = genres.includes(GENRE_ANIMATION);
  const hasCN = originCountry.some((c) => CN_COUNTRIES.has(c));

  if (isAnimation) {
    if (type === 'movie') return 'animation-movie';
    // tv + animation
    if (originalLanguage === 'ja') return 'jp-anime';
    if (hasCN) return 'cn-anime';
    return 'jp-anime'; // anime defaults to Japanese
  }

  if (type === 'movie') {
    if (hasCN) return 'chinese-movie';
    return 'foreign-movie';
  }

  // tv, non-animation
  if (hasCN) return 'cn-drama';
  if (originCountry.some((c) => ASIAN_COUNTRIES.has(c))) return 'asian-drama';
  return 'us-drama';
}
