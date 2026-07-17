import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

async function loadStats() {
  const [subs, dls, xf, sites] = await Promise.all([
    prisma.subscribe.count(),
    prisma.downloadHistory.count(),
    prisma.transferHistory.count({ where: { status: true } }),
    prisma.site.count({ where: { isActive: true } })
  ]);
  return { subs, dls, xf, sites };
}

export default async function Dashboard() {
  const stats = await loadStats();
  const items = [
    { label: '活跃订阅', value: stats.subs },
    { label: '下载历史', value: stats.dls },
    { label: '已整理入库', value: stats.xf },
    { label: '启用站点', value: stats.sites }
  ];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">概览</h1>
        <p className="text-sm text-muted-foreground">影视自动化管道运行状态一览</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {items.map((it) => (
          <Card key={it.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{it.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-bold">{it.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader>
          <CardTitle>快速开始</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. 在 <b>设置</b> 中填入 TMDB API Key、qBittorrent 与 Jellyfin 地址。</p>
          <p>2. 在 <b>搜索</b> 中输入关键词，直接下载单个种子。</p>
          <p>3. 或在 <b>订阅</b> 中添加影视条目，系统会定时自动追更。</p>
          <p>4. 下载完成后会自动整理到媒体库并刷新 Jellyfin。</p>
        </CardContent>
      </Card>
    </div>
  );
}
