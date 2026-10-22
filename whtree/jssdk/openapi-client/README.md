# @webhare/openapi-client
Typed OpenAPI client

WebHare generates `wh:openapi/*` definitions during `wh apply config`, using
`@hey-api/openapi-ts` with only the `@hey-api/typescript` plugin. WebHare preserves
the `paths`, `components`, and `operations` type layout, including media types,
parameter locations, and response status codes. Hey API fetch clients and SDK
wrappers are not generated; requests continue to use WebHare's typed client.

Generation runs in a dedicated temporary directory with output cleaning explicitly
disabled, including in dry-run mode.
