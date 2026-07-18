import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import path from 'node:path';

// Load .env manually so `pnpm db:seed` works outside Next
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
} catch {
  /* ignore */
}

const prisma = new PrismaClient();

async function main() {
  const superUser = process.env.SUPERUSER || 'admin';
  const superPass = process.env.SUPERUSER_PASSWORD || 'admin';

  const existing = await prisma.user.findUnique({ where: { name: superUser } });
  if (!existing) {
    const hashedPassword = await bcrypt.hash(superPass, 10);
    await prisma.user.create({
      data: {
        name: superUser,
        hashedPassword,
        isSuperuser: true,
        isActive: true
      }
    });
    console.log(`[seed] Created superuser: ${superUser}`);
  } else {
    console.log(`[seed] Superuser ${superUser} already exists`);
  }

  // Preset public sites
  const sites = [
    {
      name: 'YTS',
      domain: 'yts.gg',
      url: 'https://yts.gg',
      pri: 1,
      publicSite: true,
      isActive: true,
      note: 'Public movie site with JSON API'
    },
    {
      name: 'Nyaa',
      domain: 'nyaa.si',
      url: 'https://nyaa.si',
      pri: 2,
      publicSite: true,
      isActive: true,
      note: 'Public anime torrent site'
    },
    {
      name: '1337x',
      domain: '1337xx.to',
      url: 'https://www.1337xx.to',
      pri: 3,
      publicSite: true,
      isActive: true,
      note: 'Public torrent index (HTML)'
    },
    {
      name: 'TorrentGalaxy',
      domain: 'torrentgalaxy.one',
      url: 'https://torrentgalaxy.one',
      pri: 4,
      publicSite: true,
      isActive: true,
      note: 'Public torrent site with magnet links'
    },
    {
      name: 'EZTV',
      domain: 'eztvx.to',
      url: 'https://eztvx.to',
      pri: 5,
      publicSite: true,
      isActive: true,
      note: 'Public TV torrent site with JSON API'
    },
    {
      name: 'MagnetDL',
      domain: 'magnetdl.com',
      url: 'https://www.magnetdl.com',
      pri: 6,
      publicSite: true,
      isActive: true,
      note: 'Public torrent index with direct magnet links'
    },
    {
      name: 'DMHY',
      domain: 'share.dmhy.org',
      url: 'https://share.dmhy.org',
      pri: 7,
      publicSite: true,
      isActive: true,
      note: '动漫花园 - Chinese anime torrent site'
    },
    {
      name: 'Mikan',
      domain: 'mikanani.me',
      url: 'https://mikanani.me',
      pri: 8,
      publicSite: true,
      isActive: true,
      note: '蜜柑计划 - anime RSS torrent site'
    }
  ];
  for (const s of sites) {
    await prisma.site.upsert({
      where: { domain: s.domain },
      update: {},
      create: s
    });
  }
  console.log(`[seed] Preset ${sites.length} public sites`);

  // Default system config
  const defaults: Record<string, unknown> = {
    naming: {
      movie:
        process.env.MOVIE_RENAME_FORMAT ||
        "{{title}} ({{year}})/{{title}} ({{year}}){{ ' - ' + resourcePix if resourcePix }}{{fileExt}}",
      tv:
        process.env.TV_RENAME_FORMAT ||
        '{{title}} ({{year}})/Season {{season}}/{{title}} - S{{season | pad2}}E{{episode | pad2}}{{fileExt}}'
    },
    paths: {
      download: process.env.DOWNLOAD_DIR || '/downloads',
      movie: process.env.LIBRARY_DIR_MOVIE || '/media/movies',
      tv: process.env.LIBRARY_DIR_TV || '/media/tv',
      transferType: process.env.TRANSFER_TYPE || 'link',
      qbSavePath: process.env.QB_SAVE_PATH || ''
    },
    qb: {
      url: process.env.QB_URL || 'http://127.0.0.1:8080',
      username: process.env.QB_USERNAME || 'admin',
      password: process.env.QB_PASSWORD || 'adminadmin',
      categoryMovie: process.env.QB_CATEGORY_MOVIE || 'movies',
      categoryTv: process.env.QB_CATEGORY_TV || 'tv'
    },
    jellyfin: {
      url: process.env.JELLYFIN_URL || 'http://127.0.0.1:8096',
      apiKey: process.env.JELLYFIN_API_KEY || ''
    },
    tmdb: {
      apiKey: process.env.TMDB_API_KEY || ''
    }
  };
  for (const [key, value] of Object.entries(defaults)) {
    await prisma.systemConfig.upsert({
      where: { key },
      update: {},
      create: { key, value: JSON.stringify(value) }
    });
  }
  console.log(`[seed] Preset ${Object.keys(defaults).length} system configs`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
