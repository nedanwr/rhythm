import { Link } from "@tanstack/react-router";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator
} from "~/components/ui/breadcrumb";

export function crumbsFor(path: string): { name: string; path: string }[] {
  const segments = path.split("/").filter(Boolean);
  let prefix = "";
  return segments.map((segment) => {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    return { name: segment, path: prefix };
  });
}

export function Breadcrumbs({
  rootName,
  path
}: {
  rootName: string;
  path: string;
}) {
  const crumbs = crumbsFor(path);
  return (
    <Breadcrumb aria-label="Breadcrumb" className="min-w-0">
      <BreadcrumbList className="flex-nowrap gap-1 overflow-x-auto text-xs">
        <BreadcrumbItem className="shrink-0">
          <BreadcrumbLink
            className="hover:text-foreground rounded px-1 py-0.5 hover:underline"
            render={<Link to="/" />}
          >
            {rootName}
          </BreadcrumbLink>
        </BreadcrumbItem>
        {crumbs.map((crumb, index) => (
          <BreadcrumbItem key={crumb.path} className="shrink-0">
            <BreadcrumbSeparator className="text-faint [&>svg]:size-3" />
            {index === crumbs.length - 1 ? (
              <BreadcrumbPage className="px-1 py-0.5">
                {crumb.name}
              </BreadcrumbPage>
            ) : (
              <BreadcrumbLink
                className="hover:text-foreground rounded px-1 py-0.5 hover:underline"
                render={<Link to="/browse/$" params={{ _splat: crumb.path }} />}
              >
                {crumb.name}
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
