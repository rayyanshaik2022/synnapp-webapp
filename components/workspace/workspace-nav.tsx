"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
};

type WorkspaceNavProps = {
  items: NavItem[];
  workspaceSlug: string;
  mobile?: boolean;
};

function cx(...parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function WorkspaceNav({ items, workspaceSlug, mobile = false }: WorkspaceNavProps) {
  const pathname = usePathname();

  return (
    <>
      {items.map((item) => {
        const target = `/${workspaceSlug}/${item.href}`;
        const isActive = pathname === target || pathname.startsWith(`${target}/`);

        return (
          <Link
            key={item.href}
            href={target}
            aria-current={isActive ? "page" : undefined}
            className={
              mobile
                ? cx(
                    "rounded-md border px-3 py-1.5 text-sm font-medium transition",
                    isActive
                      ? "border-slate-400 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:text-slate-900",
                  )
                : cx(
                    "block rounded-lg px-3 py-2 text-sm font-medium transition",
                    isActive
                      ? "bg-slate-900 text-white shadow-sm"
                      : "text-slate-700 hover:bg-slate-100 hover:text-slate-900",
                  )
            }
          >
            {item.label}
          </Link>
        );
      })}
    </>
  );
}
