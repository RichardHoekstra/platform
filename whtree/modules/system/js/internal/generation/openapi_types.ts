import type { OpenAPIV3, OpenAPIV3_1 } from "openapi-types";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const methods = ["get", "put", "post", "delete", "options", "head", "patch", "trace"] as const;
const parameterLocations = ["query", "header", "path", "cookie"] as const;
type Property = { name: string; type: string; optional?: boolean };

function objectType(properties: Property[]): string {
  return `{ ${properties.map(property => `${JSON.stringify(property.name)}${property.optional ? "?" : ""}: ${property.type};`).join("\n")} }`;
}

function resolved<T extends object>(value: T | OpenAPIV3.ReferenceObject): T {
  if ("$ref" in value)
    throw new Error(`Unresolved OpenAPI container reference: ${value.$ref}`);
  return value;
}

/** Generate schema types with Hey API and assemble WebHare's OpenAPI container types around them.
 *
 * Hey API normally emits named component types plus per-operation types such as XxxData
 * (`body`, `path`, `query`, `headers`, `url`) and XxxResponses/XxxErrors (status code -> payload).
 * WebHare's client and handler type helpers instead index an OpenAPI-shaped tree, retaining
 * parameter locations, request-body optionality, response headers, and individual media types.
 *
 * We do not translate Hey API's operation types: their flattened payloads would lose information
 * WebHare needs. Instead, we pass Hey API an empty paths object and use only its schema generator:
 * - Original components.schemas entries and inline parameter/body/response schemas become
 *   Hey API component definitions, emitted as collision-free WebHareSchemaN type aliases.
 *   Existing schema references remain references to the original component keys in that input.
 * - components["schemas"][originalName] points to the corresponding WebHareSchemaN alias.
 *   Synthetic components for inline schemas are implementation details, not public component keys.
 * - paths[path][method] is assembled from the original operation: parameters are grouped under
 *   query/header/path/cookie, requestBody.content maps media types to schema aliases, and
 *   responses[status] retains both headers and content[mediaType].
 * - Path-level parameters are inherited, with operation-level parameters overriding by location
 *   and name. Missing methods and bodies are optional never; optional bodies remain optional.
 * - operations[operationId] exposes the same operation shape as paths[path][method].
 *   Reusable responses, parameters, requestBodies, headers, pathItems, and webhooks use the
 *   same container builders. $defs is empty because the caller has already resolved those schemas.
 *
 * The caller resolves container references and hoists shared/circular schemas into components.
 * Hey API handles schema semantics (unions, tuples, enums, recursive references, etc.), while
 * this adapter preserves the indexing contract consumed by WebHare's typed clients and requests.
 */
export async function generateOpenAPITypes(parsed: OpenAPIV3.Document): Promise<string> {
  const schemas: Record<string, OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject> = {};
  const names = new Map<string, string>();
  const schemaNames = new Map<object, string>();
  for (const [key, schema] of Object.entries(parsed.components?.schemas ?? {})) {
    if (typeof schema === "boolean")
      continue;
    schemas[key] = schema;
    const name = `WebHareSchema${names.size}`;
    names.set(key, name);
    schemaNames.set(schema, name);
  }

  function schemaType(schema: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | boolean | undefined): string {
    if (schema === false)
      return "never";
    if (schema === true || schema === undefined)
      return "unknown";
    const existing = schemaNames.get(schema);
    if (existing)
      return existing;
    let key = `__webhare_type_${names.size}`;
    while (key in schemas)
      key += "_";
    const name = `WebHareSchema${names.size}`;
    names.set(key, name);
    schemaNames.set(schema, name);
    schemas[key] = schema;
    return name;
  }

  function contentType(content: Record<string, OpenAPIV3.MediaTypeObject>): string {
    return objectType(Object.entries(content).map(([name, media]) => ({ name, type: schemaType(media.schema) })));
  }

  function parameterType(parameter: OpenAPIV3.ParameterObject | OpenAPIV3.HeaderObject): string {
    return parameter.schema !== undefined ? schemaType(parameter.schema) : schemaType(Object.values(parameter.content ?? {})[0]?.schema);
  }

  function parametersType(parameters: OpenAPIV3.ParameterObject[]): string {
    return objectType(parameterLocations.map(location => {
      const group = parameters.filter(parameter => parameter.in === location);
      return {
        name: location,
        optional: !group.some(parameter => parameter.required),
        type: group.length ? objectType(group.map(parameter => ({
          name: parameter.name, type: parameterType(parameter), optional: !parameter.required
        }))) : "never"
      };
    }));
  }

  function bodyType(body: OpenAPIV3.RequestBodyObject): string {
    return objectType([{ name: "content", type: contentType(body.content) }]);
  }

  function responseType(response: OpenAPIV3.ResponseObject): string {
    const headers = objectType(Object.entries(response.headers ?? {}).map(([name, header]) => ({
      name, type: parameterType(resolved(header)), optional: !resolved(header).required
    })));
    return objectType([
      { name: "headers", type: `${headers} & { [name: string]: unknown }` },
      { name: "content", type: response.content ? contentType(response.content) : "never", optional: !response.content }
    ]);
  }

  const operations = new Map<string, string>();
  function pathType(path: OpenAPIV3.PathItemObject): string {
    const parameters = (path.parameters ?? []).map(parameter => resolved(parameter));
    const properties: Property[] = [{ name: "parameters", type: parametersType(parameters) }];
    for (const method of methods) {
      const operation = path[method];
      if (!operation) {
        properties.push({ name: method, type: "never", optional: true });
        continue;
      }
      const overrides = (operation.parameters ?? []).map(parameter => resolved(parameter));
      const inherited = parameters.filter(parameter => !overrides.some(override => override.in === parameter.in && override.name === parameter.name));
      const body = operation.requestBody && resolved(operation.requestBody);
      const type = objectType([
        { name: "parameters", type: parametersType([...inherited, ...overrides]) },
        { name: "requestBody", type: body ? bodyType(body) : "never", optional: !body?.required },
        { name: "responses", type: objectType(Object.entries(operation.responses ?? {}).filter(([name]) => !name.startsWith("x-")).map(([name, response]) => ({ name, type: responseType(resolved(response)) }))) }
      ]);
      properties.push({ name: method, type });
      if (operation.operationId)
        operations.set(operation.operationId, type);
    }
    return objectType(properties);
  }

  const components = parsed.components;
  function componentType<T>(values: Record<string, T> | undefined, convert: (value: T) => string): string {
    return values ? objectType(Object.entries(values).map(([name, value]) => ({ name, type: convert(value) }))) : "never";
  }
  const paths = objectType(Object.entries(parsed.paths ?? {}).filter(([name]) => name.startsWith("/")).map(([name, path]) => ({ name, type: path ? pathType(path) : "never" })));
  const componentTypes = objectType([
    { name: "schemas", type: componentType(components?.schemas, schemaType) },
    { name: "responses", type: componentType(components?.responses, value => responseType(resolved(value))) },
    { name: "parameters", type: componentType(components?.parameters, value => parameterType(resolved(value))) },
    { name: "requestBodies", type: componentType(components?.requestBodies, value => bodyType(resolved(value))) },
    { name: "headers", type: componentType(components?.headers, value => parameterType(resolved(value))) },
    { name: "pathItems", type: componentType((components as OpenAPIV3_1.ComponentsObject | undefined)?.pathItems, value => pathType(resolved(value))) }
  ]);
  const webhooks = componentType((parsed as OpenAPIV3_1.Document).webhooks, value => pathType(resolved(value)));

  const { createClient } = await import("@hey-api/openapi-ts");
  const directory = await fs.mkdtemp(join(tmpdir(), "webhare-openapi-types-"));
  try {
    const contexts = await createClient({
      input: { openapi: parsed.openapi, info: parsed.info, paths: {}, components: { schemas } },
      // Hey API cleans output even in dryRun mode unless explicitly disabled.
      output: { path: directory, clean: false, entryFile: false },
      dryRun: true,
      // Keep one component type, rather than Hey API's separate readable/writable schema variants.
      parser: { transforms: { readWrite: false } },
      logs: { level: "silent", path: directory },
      plugins: [{
        name: "@hey-api/typescript",
        definitions: { case: "preserve", name: name => {
          const mapped = names.get(name);
          if (!mapped)
            throw new Error(`Unexpected OpenAPI schema name: ${name}`);
          return mapped;
        } },
        $resolvers: {
          object: context => {
            const additional = context.schema.additionalProperties;
            const hasPatterns = Object.keys(context.schema.patternProperties ?? {}).length > 0;
            const hasTypedAdditional = additional && typeof additional === "object" && additional.type !== "unknown" && additional.type !== "never";
            if (!context.schema.properties || (!hasPatterns && !hasTypedAdditional))
              return;
            // Hey API's IR stores named fields in properties and dictionary rules in additionalProperties/patternProperties.
            // Its default resolver combines these and adds undefined when a named field is optional. Keep the named-field
            // shape and dictionary index signature as an intersection instead, preserving WebHare's dictionary value type.
            return context.$.type.and(context.nodes.shape(context), context.nodes.base({
              ...context,
              schema: { ...context.schema, properties: undefined, required: undefined }
            }));
          }
        },
        enums: false
      }]
    });
    const files = contexts.flatMap(context => context.gen.render());
    if (files.length !== 1)
      throw new Error(`Expected one OpenAPI types file, got ${files.length}`);
    return `${files[0].content}
export type paths = ${paths};
export type components = ${componentTypes};
export type operations = ${operations.size ? objectType(Array.from(operations, ([name, type]) => ({ name, type }))) : "Record<string, never>"};
export type webhooks = ${webhooks === "never" ? "Record<string, never>" : webhooks};
export type $defs = Record<string, never>;
`;
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
