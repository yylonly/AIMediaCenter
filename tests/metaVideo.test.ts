import { describe, it, expect } from 'vitest';
import { parseFilename } from '../src/core/meta/metaVideo';

describe('parseFilename', () => {
  it('parses a classic movie release', () => {
    const m = parseFilename('The.Matrix.1999.1080p.BluRay.x264-GROUP.mkv');
    expect(m.type).toBe('movie');
    expect(m.year).toBe('1999');
    expect(m.resourcePix).toBe('1080p');
    expect(m.resourceType).toBe('BLURAY');
    expect(m.videoEncode).toBe('X264');
    expect(m.resourceTeam).toBe('GROUP');
    expect(m.enName).toBe('The Matrix');
    expect(m.fileExt).toBe('.mkv');
  });

  it('parses a TV episode with season/episode', () => {
    const m = parseFilename('Breaking.Bad.S01E05.720p.WEB-DL.x264.mkv');
    expect(m.type).toBe('tv');
    expect(m.seasonBegin).toBe(1);
    expect(m.episodeBegin).toBe(5);
    expect(m.resourcePix).toBe('720p');
    expect(m.resourceType).toBe('WEBDL');
    expect(m.enName).toBe('Breaking Bad');
  });

  it('parses a 2160p HDR release', () => {
    const m = parseFilename('Dune.Part.Two.2024.2160p.UHD.BluRay.x265.HDR.DV-TERMINAL.mkv');
    expect(m.year).toBe('2024');
    expect(m.resourcePix).toBe('2160p');
    expect(m.videoEncode).toBe('X265');
    expect(m.resourceEffect).toEqual(expect.arrayContaining(['HDR', 'DV']));
    expect(m.resourceTeam).toBe('TERMINAL');
  });

  it('parses a Chinese title with season/episode', () => {
    const m = parseFilename('庆余年 第二季 第03集 1080p WEB-DL.mkv');
    expect(m.cnName).toContain('庆余年');
    expect(m.seasonBegin).toBe(2);
    expect(m.episodeBegin).toBe(3);
    expect(m.type).toBe('tv');
  });

  it('parses season range', () => {
    const m = parseFilename('Friends.S01-S10.720p.WEB.x264.mkv');
    expect(m.seasonBegin).toBe(1);
    expect(m.seasonEnd).toBe(10);
    expect(m.type).toBe('tv');
  });

  it('parses episode range', () => {
    const m = parseFilename('Show.S02E01-E12.1080p.mkv');
    expect(m.seasonBegin).toBe(2);
    expect(m.episodeBegin).toBe(1);
    expect(m.episodeEnd).toBe(12);
  });

  it('parses anime bracket group', () => {
    const m = parseFilename('[SubsPlease] Frieren - 12 (1080p) [ABC123].mkv');
    expect(m.resourceTeam).toBe('SubsPlease');
    expect(m.resourcePix).toBe('1080p');
  });

  it('recognises movie without release group', () => {
    const m = parseFilename('Interstellar.2014.mkv');
    expect(m.year).toBe('2014');
    expect(m.type).toBe('movie');
    expect(m.enName).toBe('Interstellar');
  });
});
