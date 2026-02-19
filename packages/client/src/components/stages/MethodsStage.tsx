import type { Method } from '@ideafactory/shared';
import { useSessionStore } from '../../store/index.js';
import { trpc } from '../../trpc/index.js';
import { useT } from '../../i18n/index.js';
import type { TranslationKey } from '../../i18n/en.js';

export function MethodsStage({ readOnly }: { readOnly?: boolean } = {}) {
  const t = useT();
  const {
    selectedMethods,
    recommendedMethods,
    methodReasoning,
    isLoading,
    sessionId,
    toggleMethod,
    setStage,
    setLoading,
  } = useSessionStore();

  const methodsQuery = trpc.config.getMethods.useQuery();
  const advanceMutation = trpc.session.advance.useMutation();

  const handleAdvance = async () => {
    if (!sessionId || selectedMethods.length < 3) return;
    setLoading(true);
    await advanceMutation.mutateAsync({
      sessionId,
      stage: 'rubric',
      data: { selected: selectedMethods },
    });
    setStage('rubric');
    setLoading(true);
  };

  const methods = methodsQuery.data ?? [];

  const localizedMethod = (method: Method) => {
    if (!method.builtIn) return method;
    const nameKey = `method.${method.id}.name` as TranslationKey;
    const descKey = `method.${method.id}.description` as TranslationKey;
    const goodForKey = `method.${method.id}.goodFor` as TranslationKey;
    return {
      ...method,
      name: t(nameKey),
      description: t(descKey),
      goodFor: t(goodForKey),
    };
  };

  if (isLoading && methods.length === 0) {
    return (
      <div className="max-w-4xl mx-auto">
        <h2 className="text-2xl font-bold mb-2">{t('methods.title')}</h2>
        <p className="text-gray-400 mb-6">{t('methods.loading')}</p>
        <div className="grid grid-cols-2 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton h-32 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold mb-2">{t('methods.title')}</h2>
      <p className="text-gray-400 mb-4">
        {t('methods.description')}
      </p>
      <p className="text-sm text-gray-500 mb-6">
        {t('methods.selectedCount', { count: String(selectedMethods.length) })}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {methods.map((rawMethod: Method) => {
          const method = localizedMethod(rawMethod);
          const isRecommended = recommendedMethods.includes(method.id);
          const isSelected = selectedMethods.includes(method.id);
          const reasoning = methodReasoning[String(method.id)];

          return (
            <div
              key={method.id}
              onClick={readOnly ? undefined : () => toggleMethod(method.id)}
              className={`${readOnly ? '' : 'card-hover'} relative ${
                isSelected ? 'border-accent bg-accent/5' : ''
              } ${readOnly ? 'card cursor-default' : ''}`}
            >
              {isRecommended && (
                <span className="badge-recommended absolute top-3 right-3">{t('methods.recommended')}</span>
              )}
              <div className="flex items-start gap-3">
                <div
                  className={`w-5 h-5 rounded border flex items-center justify-center mt-0.5 ${
                    isSelected
                      ? 'bg-accent border-accent text-white'
                      : 'border-bg-3'
                  }`}
                >
                  {isSelected && '✓'}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h4 className="font-medium">{method.name}</h4>
                    {!method.builtIn && (
                      <span className="badge bg-info/20 text-info">{t('methods.custom')}</span>
                    )}
                  </div>
                  <p className="text-sm text-gray-400 mt-1">{method.description}</p>
                  <p className="text-xs text-gray-500 mt-1">{t('methods.goodFor')}: {method.goodFor}</p>
                  {isRecommended && reasoning && (
                    <p className="text-xs text-warning mt-2 bg-warning/5 px-2 py-1 rounded">
                      {reasoning}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {!readOnly && (
        <div className="flex justify-end">
          <button
            onClick={handleAdvance}
            disabled={selectedMethods.length < 3 || selectedMethods.length > 5 || advanceMutation.isPending}
            className="btn-primary"
          >
            {advanceMutation.isPending ? t('methods.advancing') : t('methods.nextRubric')}
          </button>
        </div>
      )}
    </div>
  );
}
