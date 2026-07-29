import { Link } from "@tanstack/react-router";

/** Splits "Artist/Album" into cumulative crumbs, root first. */
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
    <nav className="crumbs" aria-label="Breadcrumb">
      <Link className="crumbs__item" to="/">
        {rootName}
      </Link>
      {crumbs.map((crumb, index) => (
        <span key={crumb.path} className="crumbs__group">
          <span className="crumbs__sep" aria-hidden="true">
            /
          </span>
          {index === crumbs.length - 1 ? (
            <span
              className="crumbs__item crumbs__item--current"
              aria-current="page"
            >
              {crumb.name}
            </span>
          ) : (
            <Link
              className="crumbs__item"
              to="/browse/$"
              params={{ _splat: crumb.path }}
            >
              {crumb.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
