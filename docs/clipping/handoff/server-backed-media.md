# Server-backed editor media

`ServerBackedMediaDescriptorV1` stores stable identity and safe media facts:
kind, MIME type, display name, byte size, duration, dimensions, provider and
access mode. It deliberately stores no access URL or storage location and sets
`requiresBrowserPersistence` to `false`.

The descriptor lives in the existing user- and project-scoped media metadata
database. `serverAssetId` makes `shouldPersistMediaFileInBrowser` return false,
so no source copy is written to OPFS or the IndexedDB file fallback. Existing
local/desktop assets keep their current file-persistence behavior.

When the editor loads an attached asset, the existing media registry asks the
authenticated resolver for access, downloads into memory, and gives current
renderers a process-local blob URL and `File`. Neither the signed URL nor the
bytes are persisted. Preview therefore works through the existing file-backed
path. Current browser/backend export paths still assume a browser `File`; a
future trusted export resolver is required before claiming durable remote
export support.

