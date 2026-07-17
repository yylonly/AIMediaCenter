import { prisma } from '@/lib/prisma';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, THead, TBody, Tr, Th, Td } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';

export const dynamic = 'force-dynamic';

export default async function HistoryPage() {
  const items = await prisma.transferHistory.findMany({
    orderBy: { id: 'desc' },
    take: 200
  });
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">整理历史</h1>
        <p className="text-sm text-muted-foreground">下载完成后自动整理到媒体库的记录</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>最近 {items.length} 条</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <THead>
              <Tr>
                <Th>时间</Th>
                <Th>标题</Th>
                <Th>类型</Th>
                <Th>模式</Th>
                <Th>结果</Th>
                <Th>目标路径</Th>
              </Tr>
            </THead>
            <TBody>
              {items.map((r) => (
                <Tr key={r.id}>
                  <Td className="text-xs">{new Date(r.createdAt).toLocaleString()}</Td>
                  <Td>{r.title} <span className="text-muted-foreground">{r.year}</span></Td>
                  <Td><Badge variant="secondary">{r.type}</Badge></Td>
                  <Td><Badge variant="outline">{r.mode}</Badge></Td>
                  <Td>
                    {r.status ? (
                      <Badge variant="success">成功</Badge>
                    ) : (
                      <Badge variant="destructive" title={r.errmsg || ''}>失败</Badge>
                    )}
                  </Td>
                  <Td className="text-xs text-muted-foreground max-w-md truncate" title={r.dest || r.src}>
                    {r.dest || r.src}
                  </Td>
                </Tr>
              ))}
              {items.length === 0 && (
                <Tr>
                  <Td colSpan={6} className="text-center text-muted-foreground">
                    暂无整理记录
                  </Td>
                </Tr>
              )}
            </TBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
