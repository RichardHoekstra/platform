import * as test from "@webhare/test";
import ts from "typescript";
import type { OpenAPIV3_1 } from "openapi-types";
import { createOpenAPITypeDocuments } from "@mod-system/js/internal/generation/gen_openapi";
import { toFSPath } from "@webhare/services";
import { decodeYAML } from "@mod-platform/js/devsupport/validation";
import { mergeIntoBundled } from "@mod-system/js/internal/openapi/merge";

function checkTypes(generated: string, assertions: string) {
  const source = ts.createSourceFile("generated.ts", generated, ts.ScriptTarget.Latest, true);
  const printer = ts.createPrinter();
  const types = source.statements.filter(statement =>
    ts.isTypeAliasDeclaration(statement) &&
    (/^WebHareSchema\d+$/.test(statement.name.text) || ["paths", "components", "operations", "webhooks", "$defs"].includes(statement.name.text))
  ).map(statement => printer.printNode(ts.EmitHint.Unspecified, statement, source)).join("\n");
  const filename = __dirname + "/openapi/generated-type-check.ts";
  const text = `${types}\n${assertions}`;
  const options: ts.CompilerOptions = { strict: true, noEmit: true, skipLibCheck: true, types: [], target: ts.ScriptTarget.ES2022 };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === filename ? ts.createSourceFile(name, text, languageVersion, true) : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile);
  const program = ts.createProgram([filename], options, host);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  test.eq("", ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => __dirname,
    getNewLine: () => "\n"
  }));
}

async function testGeneratedTypes() {
  const specification: OpenAPIV3_1.Document = {
    openapi: "3.1.0",
    info: { title: "Generation regression tests", version: "1" },
    paths: {
      "/items/{id}": {
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "integer" } },
          { name: "filter", in: "query", schema: { type: "string" } }
        ],
        get: {
          operationId: "read-item",
          parameters: [{ name: "filter", in: "query", required: true, schema: { type: "integer" } }],
          responses: {
            "200": {
              description: "Item",
              headers: { "X-Count": { required: true, schema: { type: "integer" } } },
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Node" } },
                "text/plain": { schema: { type: "string" } }
              }
            },
            "204": { description: "No content" },
            "400": { $ref: "#/components/responses/error" }
          }
        },
        post: {
          requestBody: { content: { "application/json": { schema: { $ref: "#/components/schemas/Node" } } } },
          responses: { "201": { description: "Created" } }
        }
      }
    },
    components: {
      schemas: {
        Node: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            next: { $ref: "#/components/schemas/Node" },
            nullable: { type: ["string", "null"] },
            tuple: { type: ["array"], ...{ prefixItems: [{ type: "string" }, { type: "integer" }] }, minItems: 2, maxItems: 2 }
          }
        },
        "a-b": { type: "string", enum: ["dash"] },
        a_b: { type: "string", enum: ["underscore"] },
        tagged: {
          type: "object",
          ...{ "x-webhare-add-format-tags": "test" },
          properties: { field: { type: "object", properties: { value: { type: "string" } } } }
        },
        __webhare_type_0: { type: "boolean" },
        translated: { type: "object", properties: { en: { type: "string" } }, additionalProperties: { type: "string" } },
        patterned: {
          type: "object", properties: { en: { type: "string" } }, additionalProperties: false,
          ...{ patternProperties: { "^[a-z]+$": { type: "string" } } }
        },
        defaulterror: { type: "object", required: ["error"], properties: { error: { type: "string" } } }
      },
      responses: {
        error: { description: "Error", content: { "application/json": { schema: { $ref: "#/components/schemas/defaulterror" } } } }
      }
    }
  };
  const generated = await createOpenAPITypeDocuments(specification, {
    components: { schemas: { merged: { type: "string", enum: ["merged"] } } }
  }, { name: "test", spec: "" }, "test", "test", false);
  checkTypes(generated, `
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Node = components["schemas"]["Node"];
type Get = paths["/items/{id}"]["get"];
type Parameters = Assert<Equal<Get["parameters"]["path"], { id: number }>>;
type Override = Assert<Equal<Get["parameters"]["query"], { filter: number }>>;
type Inherited = Assert<Equal<paths["/items/{id}"]["post"]["parameters"]["query"], { filter?: string } | undefined>>;
type MissingMethod = Assert<Equal<paths["/items/{id}"]["delete"], undefined>>;
type OptionalBody = Assert<Equal<paths["/items/{id}"]["post"]["requestBody"], { content: { "application/json": Node } } | undefined>>;
type Response = Assert<Equal<Get["responses"]["200"]["content"]["application/json"], Node>>;
type TextResponse = Assert<Equal<Get["responses"]["200"]["content"]["text/plain"], string>>;
type Header = Assert<Equal<Get["responses"]["200"]["headers"]["X-Count"], number>>;
type EmptyResponse = Assert<Equal<Get["responses"]["204"]["content"], undefined>>;
type Recursive = Assert<Equal<Node["next"], Node | undefined>>;
type Nullable = Assert<Equal<Node["nullable"], string | null | undefined>>;
type Tuple = Assert<Equal<Node["tuple"], [string, number] | undefined>>;
type Operation = Assert<Equal<operations["read-item"], Get>>;
type Error = Assert<Equal<Get["responses"]["400"]["content"]["application/json"], components["schemas"]["defaulterror"]>>;
type Dash = Assert<Equal<components["schemas"]["a-b"], "dash">>;
type Underscore = Assert<Equal<components["schemas"]["a_b"], "underscore">>;
type Dictionary = Assert<Equal<components["schemas"]["translated"][string], string>>;
type PatternDictionary = Assert<Equal<components["schemas"]["patterned"][string], string>>;
type Merged = Assert<Equal<components["schemas"]["merged"], "merged">>;
type FormatTag = Assert<Equal<NonNullable<components["schemas"]["tagged"]["field"]>["__internal_format_tag"], "openapi-test-field" | undefined>>;
const invalid: Node = {
  // @ts-expect-error name must be a string
  name: 42
};
`);
}

async function testExternalReferences() {
  for (const path of [
    "mod::webhare_testsuite/tests/wh/webserver/remoting/openapi/testservice.yml",
    "mod::platform/openapi/api/api.yml"
  ]) {
    const generated = await createOpenAPITypeDocuments(toFSPath(path), undefined, { name: "test", spec: path }, "test", "test", true);
    checkTypes(generated, path.startsWith("mod::platform/") ? `
type Assert<T extends true> = T;
type SchemaParameter = Assert<components["parameters"]["schema"] extends string ? true : false>;
` : "");
  }
}

async function testOpenAPI31EdgeCases() {
  // openapi-types does not describe boolean schemas or arbitrary specification extensions.
  const specification = decodeYAML(`
openapi: 3.1.0
info: { title: Edge cases, version: "1" }
paths:
  x-note: metadata
  x-object:
    get:
      x-webhare-implementation: invalid.ts#notAnOperation
  /empty:
    get: {}
  /content:
    get:
      parameters:
        - name: text
          in: query
          required: true
          content:
            text/plain:
              schema: { type: string }
        - name: forbidden
          in: query
          schema: false
        - name: forbiddenRef
          in: query
          schema:
            $ref: "#/components/schemas/Forbidden"
      responses:
        x-note: response metadata
        x-object: { anything: metadata }
        "200":
          description: Forbidden response
          headers:
            X-Text:
              content:
                text/plain:
                  schema: { type: string }
            X-Forbidden:
              schema: false
          content:
            application/json:
              schema: false
    post:
      requestBody:
        required: true
        content:
          application/json:
            schema: false
      responses:
        "200":
          description: Anything
          content:
            application/json:
              schema: true
components:
  schemas:
    Forbidden: false
    Anything: true
  parameters:
    encoded:
      in: query
      name: encoded
      content:
        application/json:
          schema: { type: object, properties: { value: { type: string } } }
  pathItems:
    empty:
      get: {}
webhooks:
  empty:
    post: {}
`) as OpenAPIV3_1.Document;
  const generated = await createOpenAPITypeDocuments(specification, undefined, { name: "test", spec: "" }, "test", "test", true);
  test.checkTypes(extractGeneratedTypes(generated), `
type Assert<T extends true> = T;
type Equal<A, B> = [A] extends [B] ? [B] extends [A] ? true : false : false;
type Routes = Assert<Equal<keyof paths, "/empty" | "/content">>;
type Empty = Assert<Equal<keyof paths["/empty"]["get"]["responses"], never>>;
type Responses = Assert<Equal<keyof paths["/content"]["get"]["responses"], "200">>;
type Text = Assert<Equal<NonNullable<paths["/content"]["get"]["parameters"]["query"]>["text"], string>>;
type ForbiddenParameter = Assert<Equal<NonNullable<paths["/content"]["get"]["parameters"]["query"]>["forbidden"], undefined>>;
type ForbiddenReference = Assert<Equal<NonNullable<paths["/content"]["get"]["parameters"]["query"]>["forbiddenRef"], undefined>>;
type Encoded = Assert<Equal<components["parameters"]["encoded"], { value?: string }>>;
type Header = Assert<Equal<paths["/content"]["get"]["responses"]["200"]["headers"]["X-Text"], string | undefined>>;
type ForbiddenHeader = Assert<Equal<paths["/content"]["get"]["responses"]["200"]["headers"]["X-Forbidden"], undefined>>;
type ForbiddenResponse = Assert<Equal<paths["/content"]["get"]["responses"]["200"]["content"]["application/json"], never>>;
type ForbiddenBody = Assert<Equal<paths["/content"]["post"]["requestBody"]["content"]["application/json"], never>>;
type AnythingResponse = Assert<Equal<paths["/content"]["post"]["responses"]["200"]["content"]["application/json"], unknown>>;
type ForbiddenComponent = Assert<Equal<components["schemas"]["Forbidden"], never>>;
type AnythingComponent = Assert<Equal<components["schemas"]["Anything"], unknown>>;
type EmptyPathItem = Assert<Equal<keyof components["pathItems"]["empty"]["get"]["responses"], never>>;
type EmptyWebhook = Assert<Equal<keyof webhooks["empty"]["post"]["responses"], never>>;
`);
  test.assert(!generated.includes("notAnOperation"));
}

function testMergePrototypeGuard() {
  const target: { nested: { kept: boolean; added?: number } } = { nested: { kept: true } };
  mergeIntoBundled(target, JSON.parse('{"__proto__":{"polluted":true},"nested":{"__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"added":42}}'), "");
  test.eq({ nested: { kept: true, added: 42 } }, target);
  test.eq(Object.prototype, Object.getPrototypeOf(target));
  test.eq(Object.prototype, Object.getPrototypeOf(target.nested));
  test.eq(false, Object.hasOwn(Object.prototype, "polluted"));
}

test.runTests([
  testGeneratedTypes,
  testExternalReferences,
  testOpenAPI31EdgeCases,
  testMergePrototypeGuard
]);
