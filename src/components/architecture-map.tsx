import type { ImportGraph } from '@/lib/repo/graph';

/**
 * Module dependencies rendered as a ranked list rather than a node diagram.
 * A force-directed graph of a real codebase is a hairball; "which module pulls
 * on which, and how hard" is the thing a newcomer actually needs, and it reads
 * fine at 375px.
 */
export function ArchitectureMap({
  graph,
  htmlUrl,
  defaultBranch,
}: {
  graph: ImportGraph;
  htmlUrl: string;
  defaultBranch: string;
}) {
  const heaviest = graph.edges.length > 0 ? graph.edges[0].weight : 1;

  return (
    <section aria-labelledby="architecture">
      <h2 id="architecture" className="text-2xl font-black">
        How the modules depend on each other
      </h2>
      <p className="text-sm font-semibold text-muted">
        Built by parsing imports in a sample of source files. Bar width is the number of imports
        behind each dependency.
      </p>

      {graph.cycles.length > 0 && (
        <div className="nb-card mt-4 bg-warn p-3 text-sm">
          <p className="font-black">
            {graph.cycles.length} import cycle{graph.cycles.length === 1 ? '' : 's'}
          </p>
          <p className="mt-1 font-semibold">
            Modules that import each other in a loop. Expect a small change here to pull in more
            than you planned.
          </p>
          <ul className="mt-2 space-y-1">
            {graph.cycles.map((cycle) => (
              <li key={cycle.join('>')} className="font-mono text-xs font-bold">
                {cycle.join(' → ')} → {cycle[0]}
              </li>
            ))}
          </ul>
        </div>
      )}

      {graph.edges.length === 0 ? (
        <p className="nb-dashed mt-4 p-4 text-sm font-semibold text-muted">
          No cross-module imports were found in the sampled files.
        </p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {graph.edges.slice(0, 12).map((edge) => (
            <li key={`${edge.from}->${edge.to}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-sm">
                <span className="font-mono font-bold">
                  <a
                    href={`${htmlUrl}/tree/${defaultBranch}/${edge.from}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="nb-link"
                  >
                    {edge.from}
                  </a>
                  <span className="text-muted"> → </span>
                  <a
                    href={`${htmlUrl}/tree/${defaultBranch}/${edge.to}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="nb-link"
                  >
                    {edge.to}
                  </a>
                </span>
                <span className="text-xs font-bold text-muted">{edge.weight}</span>
              </div>
              <div className="nb-meter mt-1.5 w-full">
                <span style={{ width: `${Math.max(4, (edge.weight / heaviest) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {graph.externalDependencies.length > 0 && (
        <div className="mt-4">
          <h3 className="text-base font-black">Most-used external packages</h3>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {graph.externalDependencies.map((dependency) => (
              <li
                key={dependency.name}
                className="nb-chip font-mono"
              >
                {dependency.name}
                <span className="ml-1 opacity-70">{dependency.count}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {graph.notes.length > 0 && (
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs font-semibold text-muted">
          {graph.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
