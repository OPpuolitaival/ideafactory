import { useSessionStore } from '../../store/index.js';
import { trpc } from '../../trpc/index.js';
import { useT } from '../../i18n/index.js';

export function RubricStage({ readOnly }: { readOnly?: boolean } = {}) {
  const { rubric, isLoading, sessionId, setRubric, setStage, setLoading } = useSessionStore();
  const t = useT();
  const advanceMutation = trpc.session.advance.useMutation();
  const updateRubricMutation = trpc.session.updateRubric.useMutation();

  const handleAdvance = async () => {
    if (!sessionId || !rubric) return;
    // Save the (possibly edited) rubric
    await updateRubricMutation.mutateAsync({ sessionId, rubric });
    setLoading(true);
    await advanceMutation.mutateAsync({
      sessionId,
      stage: 'factory',
      data: { rubric },
    });
    setStage('factory');
  };

  const updateGateText = (index: number, text: string) => {
    if (!rubric) return;
    const updated = { ...rubric, gates: rubric.gates.map((g, i) => (i === index ? { ...g, text } : g)) };
    setRubric(updated);
  };

  const deleteGate = (index: number) => {
    if (!rubric) return;
    setRubric({ ...rubric, gates: rubric.gates.filter((_, i) => i !== index) });
  };

  const addGate = () => {
    if (!rubric) return;
    setRubric({
      ...rubric,
      gates: [...rubric.gates, { id: `g${rubric.gates.length + 1}`, text: '' }],
    });
  };

  const updateCriterion = (index: number, field: string, value: string | number) => {
    if (!rubric) return;
    const updated = {
      ...rubric,
      criteria: rubric.criteria.map((c, i) => (i === index ? { ...c, [field]: value } : c)),
    };
    setRubric(updated);
  };

  const deleteCriterion = (index: number) => {
    if (!rubric) return;
    setRubric({ ...rubric, criteria: rubric.criteria.filter((_, i) => i !== index) });
  };

  const addCriterion = () => {
    if (!rubric) return;
    setRubric({
      ...rubric,
      criteria: [
        ...rubric.criteria,
        { id: `c${rubric.criteria.length + 1}`, text: '', weight: 3, description: '' },
      ],
    });
  };

  if (isLoading && !rubric) {
    return (
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">{t('rubric.title')}</h2>
        <p className="text-gray-400 mb-6">{t('rubric.loading')}</p>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton h-40 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (!rubric) return null;

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">{t('rubric.title')}</h2>
      <p className="text-gray-400 mb-6">
        {t('rubric.description')}
      </p>

      {/* Hard Gates */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-danger">{t('rubric.hardGates')}</h3>
        <div className="space-y-2">
          {rubric.gates.map((gate, i) => (
            <div key={gate.id} className="flex items-center gap-2">
              {readOnly ? (
                <span className="flex-1 text-sm text-gray-300">{gate.text}</span>
              ) : (
                <>
                  <input
                    type="text"
                    value={gate.text}
                    onChange={(e) => updateGateText(i, e.target.value)}
                    className="input flex-1"
                  />
                  <button onClick={() => deleteGate(i)} className="btn-ghost text-danger text-sm">
                    ✕
                  </button>
                </>
              )}
            </div>
          ))}
          {!readOnly && (
            <button onClick={addGate} className="btn-ghost text-sm">
              {t('rubric.addGate')}
            </button>
          )}
        </div>
      </section>

      {/* Scored Criteria */}
      <section className="mb-8">
        <h3 className="text-lg font-semibold mb-3 text-accent">{t('rubric.scoredCriteria')}</h3>
        <div className="space-y-4">
          {rubric.criteria.map((criterion, i) => (
            <div key={criterion.id} className="card">
              <div className="flex items-start gap-3">
                <div className="flex-1 space-y-2">
                  {readOnly ? (
                    <>
                      <span className="block font-medium text-sm">{criterion.text}</span>
                      <span className="block text-sm text-gray-400">{criterion.description}</span>
                      <span className="text-xs text-gray-500">Weight: {criterion.weight}</span>
                    </>
                  ) : (
                    <>
                      <input
                        type="text"
                        value={criterion.text}
                        onChange={(e) => updateCriterion(i, 'text', e.target.value)}
                        className="input w-full font-medium"
                        placeholder={t('rubric.criterionPlaceholder')}
                      />
                      <input
                        type="text"
                        value={criterion.description}
                        onChange={(e) => updateCriterion(i, 'description', e.target.value)}
                        className="input w-full text-sm"
                        placeholder={t('rubric.descriptionPlaceholder')}
                      />
                      <div className="flex items-center gap-3">
                        <label className="text-xs text-gray-500">{t('rubric.weight')}:</label>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          value={criterion.weight}
                          onChange={(e) => updateCriterion(i, 'weight', Number(e.target.value))}
                          className="flex-1 accent-accent"
                        />
                        <span className="text-sm font-mono w-4 text-center">{criterion.weight}</span>
                      </div>
                    </>
                  )}
                </div>
                {!readOnly && (
                  <button onClick={() => deleteCriterion(i)} className="btn-ghost text-danger text-sm">
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
          {!readOnly && (
            <button onClick={addCriterion} className="btn-ghost text-sm">
              {t('rubric.addCriterion')}
            </button>
          )}
        </div>
      </section>

      {!readOnly && (
        <div className="flex justify-end">
          <button
            onClick={handleAdvance}
            disabled={advanceMutation.isPending}
            className="btn-primary"
          >
            {advanceMutation.isPending ? t('rubric.startingFactory') : t('rubric.nextFactory')}
          </button>
        </div>
      )}
    </div>
  );
}
