/** The kinds of value a page's param takes (the editor shows a field of that kind). */
export const PARAM_TYPES = ['text', 'color', 'number', 'image', 'bool', 'select'] as const;
export type ParamType = (typeof PARAM_TYPES)[number];

/** A param a page declares, with its default. */
export interface ParamDeclaration {
  name: string;
  label: string;
  type: ParamType;
  default: string | number | boolean | null;
  /** A `select`'s choices. */
  options?: string[];
  /** A `number`'s range. */
  min?: number;
  max?: number;
}

const DECLARATION = /<script\b[^>]*\bid\s*=\s*["']cuttle-params["'][^>]*>([\s\S]*?)<\/script>/i;
const NAME = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

/**
 * The params a page declares in `<script type="application/json" id="cuttle-params">[…]</script>`:
 * `[{ "name", "label", "type", "default", "options", "min", "max" }]`. A page without one declares
 * none. Each problem is named; the params that are right are kept.
 */
export function declaredParams(html: string): { params: ParamDeclaration[]; issues: string[] } {
  const block = DECLARATION.exec(html)?.[1];
  if (block === undefined) return { params: [], issues: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(block);
  } catch (error) {
    return { params: [], issues: [`cuttle-params is not JSON: ${(error as Error).message}`] };
  }
  if (!Array.isArray(raw)) return { params: [], issues: ['cuttle-params must be a list of params'] };
  const params: ParamDeclaration[] = [];
  const issues: string[] = [];
  raw.forEach((entry: unknown, index) => {
    const where = `cuttle-params[${index}]`;
    if (typeof entry !== 'object' || entry === null) return void issues.push(`${where} is not an object`);
    const { name, label, type, options, min, max } = entry as Record<string, unknown>;
    const value = (entry as Record<string, unknown>).default;
    if (typeof name !== 'string' || !NAME.test(name)) return void issues.push(`${where}.name must be a name of letters, digits, - or _`);
    if (params.some((param) => param.name === name)) return void issues.push(`${where}.name "${name}" is declared twice`);
    if (!(PARAM_TYPES as readonly unknown[]).includes(type)) return void issues.push(`${where}.type must be one of ${PARAM_TYPES.join(', ')}`);
    const kind = type as ParamType;
    const fits =
      value === null ||
      (kind === 'number' ? typeof value === 'number' && Number.isFinite(value) : kind === 'bool' ? typeof value === 'boolean' : typeof value === 'string');
    if (value !== undefined && !fits) return void issues.push(`${where}.default does not fit its type ${kind}`);
    if (kind === 'select' && !(Array.isArray(options) && options.length > 0 && options.every((option) => typeof option === 'string'))) {
      return void issues.push(`${where}.options must list the choices of a select`);
    }
    params.push({
      name,
      label: typeof label === 'string' && label.trim() ? label : name,
      type: kind,
      default: (value as ParamDeclaration['default'] | undefined) ?? null,
      ...(kind === 'select' && { options: options as string[] }),
      ...(typeof min === 'number' && { min }),
      ...(typeof max === 'number' && { max }),
    });
  });
  return { params, issues };
}

/** The defaults of declared params, by name. */
export function paramDefaults(params: readonly ParamDeclaration[]): Record<string, ParamDeclaration['default']> {
  return Object.fromEntries(params.map((param) => [param.name, param.default]));
}
