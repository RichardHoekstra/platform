# Code structure and API boundaries

This repository contains the WebHare Platform, its built-in modules, and its
tests. A file being accessible does not make it a supported public API.

## Repository layout

- `whtree/` contains the WebHare installation tree and is the only path included in the final WebHare container image.
  - `jssdk/<package>/` contains the TypeScript SDK, imported as
    `@webhare/<package>`.
  - `modules/<module>/` contains the built-in modules, such as `system`,
    `platform`, `publisher`, `wrd`, `consilio`, and `tollium`, as well as the
    `webhare_testsuite` test module.
  - `node_modules/` contains the Node.js dependencies shipped with WebHare.
- `harescript/` contains the HareScript engine.
- `ap/` contains native application and server code.
- `blex/` contains shared native support code.
- `builder/` contains build infrastructure.
- `addons/` contains supporting tools and integrations, including the VS Code
  extension and container build tooling.
- `doc/` documents platform internals and development processes.

The `webhare_testsuite` module does not ship with the WebHare container images. Continuous integration tests
will install the test module into `/opt/whdata/installedmodules/` so relative imports/paths should be careful

Use `wh dirs` to get a list of critical paths. The environment variable `WEBHARE_DIR` always points to the `whtree/`
directory - `WEBHARE_CHECKEDOUT_TO` points to the root of the whole platform project if checked out from source.

## Modules and resource paths

A module is a directory containing `moduledefinition.xml` and/or
`moduledefinition.yml`. Modules contain their own code, resources, configuration,
and tests. Common subdirectories include `js/` for JavaScript and TypeScript,
`lib/` for HareScript libraries, `scripts/` for executable scripts, and `tests/`
for tests.

Module resources are addressed as `mod::<module>/<path>`, independently of their
physical location. TypeScript code can refer to module files using
`@mod-<module>/<path>`.

Additional modules are typically installed under the WebHare data directory's
`installedmodules/` tree, rather than inside the platform installation. The
testsuite can also live there, for example in CI. Do not assume that a module is
physically located in `whtree/modules/`.

## Public and internal APIs

Internal APIs are implementation details. They may change or disappear without
notice or a deprecation period. Use public APIs for application and third-party
module development; platform code and tests may need internal access, but must
account for its instability.

### HareScript

HareScript libraries and scripts use the `.whlib` and `.whscr` extensions.

- Paths such as `wh::internal/...` identify internal, unstable APIs. The same
  applies to module implementation paths such as
  `mod::system/lib/internal/...`.
- Identifiers starting with an underscore, including functions and object
  members, indicate internal, unstable APIs, even if they can be accessed from
  outside their implementation.

Prefer documented public library entry points. Neither the ability to load a
library nor the absence of an `internal` path component guarantees a public API.
New code should generally prefer TypeScript; HareScript is deprecated.

### TypeScript

Top-level SDK libraries such as `@webhare/std` and `@webhare/services` are the
explicit public API. Import from those entry points rather than reaching into
their implementations.

The following are internal, unstable interfaces:

- Imports into any core module using `@mod-<module>/...`, for example
  `@mod-system/js/internal/generation/gen_openapi`. This applies even when the
  imported path does not contain a directory named `internal`.
- SDK implementation imports such as `@webhare/std/src/...`. A public package
  entry point does not make every file beneath it public. Explicitly documented
  SDK subpath entry points are separate from these implementation paths.
- Imports through `wh-internal:/...`, for example `wh-internal:/typescript`.
  This alias accesses the `node_modules/` shipped with the WebHare installation,
  independently of the importing module's location. It exposes platform
  dependencies as implementation details: their presence, versions, and APIs
  are not a supported WebHare API contract.

The `wh-internal:/` alias is available to all modules, but availability does not
imply stability. Modules needing a third-party package as their own dependency
should declare and manage that dependency rather than relying on WebHare's copy.

See [the JS SDK documentation](jssdk.md) for more detail about SDK entry points
and supported subpath imports.
