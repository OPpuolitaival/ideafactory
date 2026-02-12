import { useSessionStore } from '../store/index.js';

interface ModelSelectorProps {
  role: string;
  value: string;
  onChange: (modelId: string) => void;
  disabled?: boolean;
}

export function ModelSelector({ role, value, onChange, disabled }: ModelSelectorProps) {
  const modelOptions = useSessionStore((s) => s.modelOptions);

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-gray-300 min-w-[80px]">{role}</span>
      <div className="flex gap-1.5">
        {modelOptions.map((opt) => {
          const selected = value === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => !disabled && onChange(opt.id)}
              disabled={disabled}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all duration-150 ${
                selected
                  ? 'ring-1'
                  : 'bg-bg-1 border border-bg-3 hover:border-gray-500'
              } ${disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer'}`}
              style={
                selected
                  ? {
                      backgroundColor: `${opt.color}15`,
                      borderColor: `${opt.color}60`,
                      color: opt.color,
                      boxShadow: `0 0 0 1px ${opt.color}60`,
                    }
                  : undefined
              }
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: opt.color }}
              />
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
