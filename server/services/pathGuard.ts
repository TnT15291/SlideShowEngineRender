import path from "node:path"

// True when `child` resolves to `parent` itself or somewhere beneath it. Every
// path read out of a project manifest goes through this before it is opened,
// so a manifest cannot point the server at a file outside its own project.
// Compare against `..` + separator rather than a bare `..` prefix: a file
// named "..notes" is inside. On Windows a different drive comes back from
// path.relative as an absolute path, which is why that is rejected too.
export function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}
