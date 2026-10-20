import schema from '../../src/config/github-projects-schema.json';

interface Reference {
  kind: string;
  name: string | null;
  ofType?: Reference | null;
}
interface InputType {
  kind: string;
  inputFields: { name: string; defaultValue: string | null; type: Reference }[] | null;
  enumValues: { name: string; isDeprecated: boolean }[] | null;
}
const types = schema.types as Record<string, InputType>;
const own = (object: object, key: string) => Object.prototype.hasOwnProperty.call(object, key);
const invalid = () => {
  throw new Error('The request does not match the supported GitHub Projects schema.');
};

/** Offline structural validation. Live permission and membership checks remain required. */
export function validateProjectMutation(operation: string, input: unknown) {
  const mutation = schema.mutations.find((value) => value.name === operation);
  const reference = mutation?.args.find((arg) => arg.name === 'input')?.type;
  if (!reference || mutation?.isDeprecated) return invalid();
  let nodes = 0;
  const validate = (type: Reference, value: unknown, depth: number): void => {
    if (++nodes > 10000 || depth > 20) return invalid();
    if (type.kind === 'NON_NULL') {
      if (value === undefined || value === null || !type.ofType) return invalid();
      return validate(type.ofType, value, depth + 1);
    }
    if (value === null || value === undefined) return;
    if (type.kind === 'LIST') {
      if (!Array.isArray(value) || value.length > 1000 || !type.ofType) return invalid();
      for (const item of value) validate(type.ofType, item, depth + 1);
      return;
    }
    if (type.kind === 'INPUT_OBJECT') {
      const definition = types[type.name!];
      if (!definition?.inputFields || typeof value !== 'object' || Array.isArray(value))
        return invalid();
      const fields = definition.inputFields;
      if (Object.keys(value).some((key) => !fields.some((field) => field.name === key)))
        return invalid();
      for (const field of fields) {
        const item = own(value, field.name)
          ? (value as Record<string, unknown>)[field.name]
          : undefined;
        if (item === undefined && field.defaultValue !== null) continue;
        validate(field.type, item, depth + 1);
      }
      return;
    }
    if (type.kind === 'ENUM') {
      if (!types[type.name!]?.enumValues?.some((item) => item.name === value && !item.isDeprecated))
        return invalid();
      return;
    }
    if (type.kind !== 'SCALAR') return invalid();
    if (type.name === 'Boolean') {
      if (typeof value !== 'boolean') return invalid();
      return;
    }
    if (type.name === 'Int' || type.name === 'Float') {
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        (type.name === 'Int' &&
          (!Number.isInteger(value) || value < -2147483648 || value > 2147483647))
      )
        return invalid();
      return;
    }
    if (typeof value !== 'string' || value.length > 65536 || value.includes('\0')) return invalid();
    if (type.name === 'ID' && !/^[A-Za-z0-9_=-]{1,200}$/.test(value)) return invalid();
    if (
      type.name === 'Date' &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    )
      return invalid();
    if (
      type.name === 'DateTime' &&
      (!/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value)))
    )
      return invalid();
    if (type.name === 'GitObjectID' && !/^[a-fA-F0-9]{40}$/.test(value)) return invalid();
    if (
      !['ID', 'String', 'Date', 'DateTime', 'URI', 'HTML', 'GitObjectID'].includes(type.name || '')
    )
      return invalid();
  };
  validate(reference, input, 0);
}

export const projectSchemaIdentity = {
  host: schema.host,
  digest: schema.sha256,
  operations: schema.mutations.map((mutation) => mutation.name),
};
