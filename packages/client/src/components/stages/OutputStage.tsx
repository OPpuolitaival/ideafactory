import { useSessionStore } from '../../store/index.js';
import { trpc } from '../../trpc/index.js';

export function OutputStage() {
  const { outputPackage, sessionId, isLoading } = useSessionStore();
  const sessionQuery = trpc.session.get.useQuery(
    { id: sessionId! },
    { enabled: !!sessionId },
  );

  const artifacts = sessionQuery.data?.output?.artifacts ?? [];

  if (isLoading && !outputPackage) {
    return (
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">Stage 5: Output</h2>
        <p className="text-gray-400 mb-6">Packaging final output...</p>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-48 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!outputPackage) return null;

  const handleCopyMarkdown = () => {
    const md = generateMarkdown(outputPackage);
    navigator.clipboard.writeText(md);
  };

  const handleDownloadMarkdown = () => {
    const md = generateMarkdown(outputPackage);
    downloadFile(md, 'ideafactory-output.md', 'text/markdown');
  };

  const handleDownloadJSON = () => {
    const json = JSON.stringify(outputPackage, null, 2);
    downloadFile(json, 'ideafactory-output.json', 'application/json');
  };

  const handleDownloadHTML = () => {
    const htmlArtifact = artifacts.find((a: any) => a.type === 'report_page');
    if (htmlArtifact) {
      downloadFile(htmlArtifact.content, 'ideafactory-report.html', 'text/html');
    }
  };

  const radarChart = artifacts.find((a: any) => a.type === 'radar_chart');
  const conceptSketches = artifacts.filter((a: any) => a.type === 'concept_sketch');

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">Stage 5: Output</h2>
      <p className="text-gray-400 mb-6">Your ideation results, packaged and ready.</p>

      {/* Export buttons */}
      <div className="flex flex-wrap gap-2 mb-8">
        <button onClick={handleCopyMarkdown} className="btn-secondary text-sm">
          Copy as Markdown
        </button>
        <button onClick={handleDownloadMarkdown} className="btn-secondary text-sm">
          Download .md
        </button>
        <button onClick={handleDownloadJSON} className="btn-secondary text-sm">
          Download .json
        </button>
        {artifacts.some((a: any) => a.type === 'report_page') && (
          <button onClick={handleDownloadHTML} className="btn-secondary text-sm">
            Download HTML Report
          </button>
        )}
        <button onClick={() => useSessionStore.getState().reset()} className="btn-primary text-sm ml-auto">
          Start New Session
        </button>
      </div>

      {/* Session Metadata */}
      <div className="card mb-6">
        <h3 className="font-semibold text-sm text-gray-400 mb-2">Session Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Domain</span>
            <p>{outputPackage.sessionMetadata.domain}</p>
          </div>
          <div>
            <span className="text-gray-500">Coordinate</span>
            <p>{outputPackage.sessionMetadata.coordinate}</p>
          </div>
          <div>
            <span className="text-gray-500">Ideas Generated</span>
            <p>{outputPackage.sessionMetadata.totalIdeasGenerated}</p>
          </div>
          <div>
            <span className="text-gray-500">Ideas Survived</span>
            <p>{outputPackage.sessionMetadata.totalIdeasSurvived}</p>
          </div>
        </div>
      </div>

      {/* Radar Chart */}
      {radarChart && (
        <div className="card mb-6">
          <h3 className="font-semibold mb-3">Concept Comparison</h3>
          <div dangerouslySetInnerHTML={{ __html: radarChart.content }} />
        </div>
      )}

      {/* Overall Insights */}
      <div className="card mb-6">
        <h3 className="font-semibold mb-2">Overall Insights</h3>
        <p className="text-sm text-gray-300 whitespace-pre-wrap">{outputPackage.overallInsights}</p>
      </div>

      {/* Concept Cards */}
      <div className="space-y-6 mb-8">
        {outputPackage.concepts.map((concept, i) => {
          const sketch = conceptSketches[i];
          return (
            <div key={concept.rank} className="card border-accent/20">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <span className="flex items-center justify-center w-8 h-8 rounded-full bg-accent text-white font-bold">
                    {concept.rank}
                  </span>
                  <h3 className="text-lg font-semibold">{concept.name}</h3>
                </div>
                <span
                  className={`badge ${
                    concept.qaVerdict === 'strong'
                      ? 'bg-success/20 text-success'
                      : concept.qaVerdict === 'conditional'
                        ? 'bg-warning/20 text-warning'
                        : 'bg-danger/20 text-danger'
                  }`}
                >
                  {concept.qaVerdict}
                </span>
              </div>

              <p className="text-sm text-gray-300 mb-4">{concept.description}</p>

              {sketch && (
                <div className="mb-4 bg-bg-1 rounded-lg p-4">
                  <div dangerouslySetInnerHTML={{ __html: sketch.content }} />
                </div>
              )}

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <h4 className="text-sm font-medium text-success mb-2">Pros</h4>
                  <ul className="space-y-1">
                    {concept.pros.map((pro, j) => (
                      <li key={j} className="text-sm text-gray-300 flex items-start gap-2">
                        <span className="text-success mt-0.5">+</span>
                        {pro}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-danger mb-2">Cons</h4>
                  <ul className="space-y-1">
                    {concept.cons.map((con, j) => (
                      <li key={j} className="text-sm text-gray-300 flex items-start gap-2">
                        <span className="text-danger mt-0.5">-</span>
                        {con}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {concept.openQuestions.length > 0 && (
                <div className="mb-3">
                  <h4 className="text-sm font-medium text-info mb-1">Open Questions</h4>
                  <ul className="text-sm text-gray-400 space-y-1">
                    {concept.openQuestions.map((q, j) => (
                      <li key={j}>? {q}</li>
                    ))}
                  </ul>
                </div>
              )}

              {concept.nextSteps.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-warning mb-1">Next Steps</h4>
                  <ul className="text-sm text-gray-400 space-y-1">
                    {concept.nextSteps.map((step, j) => (
                      <li key={j}>→ {step}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Next Sprint */}
      {outputPackage.suggestedNextSprint.length > 0 && (
        <div className="card mb-8">
          <h3 className="font-semibold mb-2">Suggested Next Sprint</h3>
          <ul className="space-y-1">
            {outputPackage.suggestedNextSprint.map((item, i) => (
              <li key={i} className="text-sm text-gray-300">
                {i + 1}. {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function generateMarkdown(pkg: import('@ideafactory/shared').OutputPackage): string {
  let md = `# Idea Factory Output\n\n`;
  md += `**Domain:** ${pkg.sessionMetadata.domain}\n`;
  md += `**Coordinate:** ${pkg.sessionMetadata.coordinate}\n`;
  md += `**Methods:** ${pkg.sessionMetadata.methods.join(', ')}\n`;
  md += `**Ideas Generated:** ${pkg.sessionMetadata.totalIdeasGenerated}\n`;
  md += `**Ideas Survived:** ${pkg.sessionMetadata.totalIdeasSurvived}\n\n`;

  md += `## Insights\n\n${pkg.overallInsights}\n\n`;

  md += `## Concepts\n\n`;
  for (const concept of pkg.concepts) {
    md += `### ${concept.rank}. ${concept.name} [${concept.qaVerdict}]\n\n`;
    md += `${concept.description}\n\n`;
    md += `**Pros:**\n${concept.pros.map((p) => `- ${p}`).join('\n')}\n\n`;
    md += `**Cons:**\n${concept.cons.map((c) => `- ${c}`).join('\n')}\n\n`;
    if (concept.openQuestions.length > 0) {
      md += `**Open Questions:**\n${concept.openQuestions.map((q) => `- ${q}`).join('\n')}\n\n`;
    }
    if (concept.nextSteps.length > 0) {
      md += `**Next Steps:**\n${concept.nextSteps.map((s) => `- ${s}`).join('\n')}\n\n`;
    }
  }

  md += `## Suggested Next Sprint\n\n`;
  md += pkg.suggestedNextSprint.map((s, i) => `${i + 1}. ${s}`).join('\n');

  return md;
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
