'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Globe,
  Search,
  Bookmark,
  Download,
  History,
  Settings,
  LogOut,
  Server,
  Film,
  TrendingUp
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const nav = [
  { href: '/dashboard', label: '概览', icon: LayoutDashboard },
  { href: '/trending', label: '推荐榜单', icon: TrendingUp },
  { href: '/search', label: '搜索', icon: Search },
  { href: '/subscribes', label: '订阅', icon: Bookmark },
  { href: '/downloads', label: '下载', icon: Download },
  { href: '/history', label: '整理历史', icon: History },
  { href: '/sites', label: '站点管理', icon: Globe },
  { href: '/mediaserver', label: '媒体库', icon: Server },
  { href: '/settings', label: '设置', icon: Settings }
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await fetch('/api/access-token', { method: 'DELETE' });
    router.replace('/login');
  }

  return (
    <aside className="flex w-56 flex-col border-r bg-muted/20">
      <div className="flex items-center gap-2 border-b p-4">
        <Film className="h-5 w-5" />
        <span className="font-semibold">AIMediaCenter</span>
      </div>
      <nav className="flex flex-1 flex-col gap-1 p-2">
        {nav.map((item) => {
          const Icon = item.icon;
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition',
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="border-t p-2">
        <Button variant="ghost" className="w-full justify-start" size="sm" onClick={logout}>
          <LogOut className="mr-2 h-4 w-4" />
          登出
        </Button>
      </div>
    </aside>
  );
}
