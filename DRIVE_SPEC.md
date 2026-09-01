# SDKWork Drive Standard

- Version: 1.0
- Scope: SDKWork Drive, Drive Uploader, file storage, object storage providers, spaces, nodes, upload sessions, download grants, storage metadata, file/media lifecycle, Drive-backed `MediaResource` mapping, client upload services, server-side Rust upload components, generated Drive SDKs, uploader attribution/statistics, database references, RPC storage-control contracts
- Related: `DOMAIN_SPEC.md`, `API_SPEC.md`, `RPC_SPEC.md`, `RUST_RPC_SPEC.md`, `DATABASE_SPEC.md`, `MEDIA_RESOURCE_SPEC.md`, `REGION_SPEC.md`, `SDK_SPEC.md`, `SDK_WORKSPACE_GENERATION_SPEC.md`, `FRONTEND_SPEC.md`, `SECURITY_SPEC.md`, `PRIVACY_SPEC.md`, `CONFIG_SPEC.md`, `DEPLOYMENT_SPEC.md`, `OBSERVABILITY_SPEC.md`, `EVENT_SPEC.md`, `TEST_SPEC.md`
- Canonical location: `specs/DRIVE_SPEC.md`
- Implementation family: `sdkwork-drive`

SDKWork Drive is the platform authority for files and object-storage-backed content. Application domains, including IM, commerce, knowledge base, AI studio, office, approval, and user profile modules, must use Drive for file storage instead of creating their own object storage tables, upload session state, provider registry, presign logic, local file stores, or media asset lifecycle.

`MediaResource` is the cross-domain representation of a usable media/file resource. Drive owns the storage lifecycle behind it. Business modules own only their business relation to a Drive resource and, when useful, a `MediaResource` snapshot for read models and transport.

Drive Uploader is the required upload capability for all SDKWork applications. Client applications such as PC browser/desktop/tablet, H5/Capacitor, Flutter, WeChat Mini Program, iOS, Android, and HarmonyOS clients use the generated `sdkwork-drive-app-sdk` high-level `client.uploader.*` surface. Server-side Rust services that generate, import, transform, or proxy bytes into SDKWork-owned storage use the Drive server-side uploader service, normally from the `sdkwork-drive-uploader-service` crate (`sdkwork_drive_uploader_service` in Rust imports) or an approved Drive server-side uploader facade. These two entry points share one Drive uploader core so tenant, organization, user, anonymous actor, app, resource, profile, retention, and usage statistics remain complete.

## 1. Normative Language

The words `MUST`, `MUST NOT`, `SHOULD`, `SHOULD NOT`, and `MAY` are used with RFC-style meaning.

## 2. Ownership Boundary

Drive owns all platform file-storage responsibilities:

- Storage providers, provider capabilities, endpoint policy, bucket binding, credential references, health, and admin lifecycle.
- Object locators, object keys, versions, etags, checksums, content length, content type, provider metadata, and reconciliation.
- Spaces, folders, files, shortcuts, virtual references, node lifecycle, node versions, and content state.
- Upload sessions, idempotency, multipart upload state, upload grants, completion, abort, expiry, retry safety, and garbage collection.
- Download grants, signed URLs, range reads, CDN handoff, content disposition, and temporary delivery headers.
- File scanning, MIME validation, checksum verification, quarantine, retention, legal hold, lifecycle policy, and deletion.
- Quotas, usage accounting, audit events, operational metrics, traces, and storage provider error normalization.

Business domains own only business meaning:

- Which business aggregate references the file.
- The business role, for example `attachment`, `avatar`, `main_image`, `sku_image`, `invoice_document`, `voice`, `generated_output`, or `message_part`.
- Business ordering, display labels, alt text, moderation state, and domain-specific visibility.
- A stable reference to Drive, normally `drive_space_id`, `drive_node_id`, and `drive_uri`.
- A `MediaResource` snapshot when the domain needs a read-model projection or immutable message payload view.

Business domains `MUST NOT` own object storage lifecycle. They must not store provider credentials, bucket policy, object keys, upload part state, presigned URL state, S3/OSS/MinIO client configuration, or provider-specific deletion rules outside Drive.

## 3. Canonical Drive Model

Drive exposes a resource model above object storage. Consumers should reason about spaces and nodes, not buckets and keys.

| Concept | Owner | Purpose |
| --- | --- | --- |
| `DriveSpace` | Drive | Tenant-scoped storage namespace with owner, type, policy, lifecycle, and quota boundary. |
| `DriveNode` | Drive | File/folder/shortcut/virtual-reference resource addressable inside a space. |
| `DriveStorageProvider` | Drive | Configured object-storage backend such as local filesystem, S3-compatible storage, OSS, Azure Blob, or GCS. |
| `DriveStorageObject` | Drive | Storage fact for a concrete object or object version behind a file node. |
| `DriveUploadSession` | Drive | Idempotent upload lifecycle that reserves a target node/object and grants upload capability. |
| `DriveDownloadGrant` | Drive | Short-lived delivery authorization, usually backed by presigned provider URLs or trusted streaming. |

### 3.1 Space Types

Drive standard space types:

| Space type | Purpose | Standard owner binding |
| --- | --- | --- |
| `personal` | User-owned files and folders. | user subject |
| `team` | Organization/team shared files. | organization or team subject |
| `knowledge_base` | Files managed for knowledge ingestion, indexing, and retrieval. | knowledge-base aggregate |
| `ai_generated` | AI-generated artifacts, model outputs, edited media, and generated documents. | AI task, workspace, or generation scope |
| `app_upload` | Application-owned uploads such as product media, profile avatars, approval documents, app manifests, and other non-IM app files. | app id plus app resource type/id |
| `im` | Instant-messaging files such as chat images, voice messages, videos, documents, and conversation attachments uploaded with `scene = im`. | IM conversation/resource attribution plus actor subject |

Specialized spaces must be represented by a Drive space profile table or equivalent Drive-owned metadata. Application modules must not create a separate storage root to bypass these profiles.

### 3.2 Node Types

Drive standard node types:

| Node type | Meaning |
| --- | --- |
| `file` | A resource with file content, metadata, and one or more storage object versions. |
| `folder` | A container for child nodes. |
| `shortcut` | A pointer to another Drive node without duplicating content. |
| `virtual_reference` | A logical resource projected from another system where Drive owns the reference policy but not necessarily original bytes. |

### 3.3 Upload Session States

Drive upload sessions use these states:

| State | Meaning |
| --- | --- |
| `created` | Session is reserved but no accepted upload progress is recorded. |
| `uploading` | Upload has started or at least one part/grant has been issued. |
| `completed` | Content is committed and the target node points to the resulting storage object/version. |
| `aborted` | Client or server canceled the upload and Drive must release temporary provider state. |
| `expired` | Session exceeded its expiry and cannot be completed. |

State transitions must be idempotent for the same `Idempotency-Key` and must reject conflicting retries.

### 3.4 Canonical URI

The stable external Drive URI is:

```text
drive://spaces/{spaceId}/nodes/{nodeId}
```

Rules:

- `drive_uri` is a stable reference to the Drive resource, not a delivery URL.
- `drive_uri` must not contain provider bucket names, object keys, credentials, or signed query strings.
- `drive_uri` is the preferred persisted reference when a domain stores only one string reference.
- A future content/object revision URI may be added by Drive, but business modules must still treat Drive as the authority for resolving it.

## 4. Storage Provider Contract

Drive provider adapters implement the `DriveObjectStore` contract. The standard provider kinds are:

- `local_filesystem`
- `s3_compatible`
- `azure_blob`
- `google_cloud_storage`
- `aliyun_oss`
- custom provider kinds owned by Drive provider extensions

The object-store contract includes:

- `put_object`
- `head_object`
- `delete_object`
- `create_multipart_upload`
- `presign_upload_part`
- `complete_multipart_upload`
- `abort_multipart_upload`
- `presign_download`
- `read_object_range`

Provider capabilities must be explicit:

- multipart upload
- presigned upload part
- presigned download
- range read
- server-side copy
- versioning

Rules:

- Provider credentials must be stored by reference and resolved only inside trusted Drive runtime composition.
- Provider-native errors must be normalized to Drive error kinds before crossing Drive service boundaries.
- Business services must not depend on provider-specific SDKs, provider bucket names, provider endpoints, or provider headers.
- Local filesystem storage is a Drive provider adapter for approved standalone
  desktop or server runtime targets. It is not a reason for app modules to
  write files directly.
- Presigned URLs are grants, not identity. They must expire and must never become persisted business state.

## 5. Database Contract

Drive database tables own storage facts. Business database tables own business references.

### 5.1 Drive-Owned Tables

The Drive schema owns these table families:

| Table | Responsibility |
| --- | --- |
| `drive_space` | Space identity, tenant, owner subject, space type, lifecycle, version, audit timestamps. |
| `drive_knowledge_space_profile` | Knowledge-base binding, ingestion policy, indexing policy, and knowledge-specific lifecycle. |
| `drive_ai_generation_space_profile` | AI generation scope, generated artifact retention policy, prompt/output retention policy. |
| `drive_app_upload_space_profile` | App upload binding by tenant, app id, app resource type/id, upload policy. |
| `drive_node` | Node identity, parent, node type, name, lifecycle, content state, version, audit timestamps. |
| `drive_storage_provider` | Provider kind, endpoint, bucket binding, credential reference, capabilities, status. |
| `drive_storage_object` | Concrete object/version facts: provider, bucket, object key, version, etag, checksum, size, content type, lifecycle. |
| `drive_upload_session` | Upload session identity, target space/node/object, idempotency key, state, expiry, policy. |
| `drive_upload_part` | Multipart part numbers, etags, size, checksum, state, and completion order when multipart is used. |
| `drive_download_grant` | Optional persisted audit/control record for signed download grants when policy requires it. |
| `drive_quota_usage` | Optional quota and usage accounting by tenant, space, provider, or policy scope. |
| `dr_drive_upload_item` | Drive Uploader task/content lifecycle fact: tenant, organization, actor, app/resource, profile, content group, size, retention, space/node/session, counters, and cleanup status. |
| `dr_drive_upload_part` | Drive Uploader resumable multipart fact: part number, offset, size, checksum, object target, etag, uploaded state, and idempotent mark-uploaded state. |
| `dr_drive_file_sensitive_operation` | Sensitive file operation ledger for upload completion, soft delete, hard delete, restore, share changes, permission changes, and download grants with required pre-operation snapshots. |

Drive implementation may split tables for performance, but the ownership boundary must not move into application modules.

Uploader statistic facts are Drive-owned. Application domains may keep read-model references or aggregate projections, but they must not create source-of-truth upload statistic tables, upload counter tables, or app-local upload part tables for SDKWork-owned files.

### 5.2 Business Reference Tables

When a domain needs to attach Drive resources to business state, it should use a relation table shaped like this:

```text
<domain>_<entity>_drive_ref
  id
  tenant_id
  organization_id
  owner_type
  owner_id
  owner_version
  drive_role
  drive_space_id
  drive_node_id
  drive_uri
  media_kind
  media_source
  mime_type
  size_bytes
  checksum_algorithm
  checksum_value
  media_resource_snapshot
  resource_hash
  sort_order
  lifecycle_status
  retention_policy_code
  created_at
  updated_at
```

For media-specific domains, `drive_role` may be named `media_role`.

Rules:

- Business tables `MUST NOT` store `bucket`, `object_key`, provider endpoint, provider credential reference, or presigned URL as the source of truth.
- Business tables `MUST` reference Drive by `drive_space_id + drive_node_id` or by `drive_uri`.
- Business tables `MAY` store a `MediaResource` snapshot for read performance, immutable message history, or search projection, but Drive remains the storage authority.
- Business tables `MAY` store a Drive storage object id only when Drive exposes it as a stable public or internal reference. They must not store raw object keys to simulate that id.
- Cross-tenant sharing must be represented by Drive access policy or explicit business authorization. It must not be inferred from a shared URL.

## 6. HTTP API Contract

Drive APIs follow `API_SPEC.md` and use the standard prefixes:

- App API: `/app/v3/api/drive`
- Backend API: `/backend/v3/api/drive`

### 6.1 App API

The app API exposes user/application file workflows:

| Resource | Required operations |
| --- | --- |
| `/drive/spaces` | Create/list spaces allowed for the caller. |
| `/drive/nodes` | Create folders/files, list children, retrieve metadata, update names, move, delete according to policy. |
| `/drive/uploader/uploads` | Prepare or resume a Drive Uploader task and resolve the upload space, attribution, retention, profile, upload session, and already uploaded parts. |
| `/drive/uploader/uploads/{uploadItemId}/parts/{partNo}` | Mark an uploaded Drive Uploader part as accepted; this operation is idempotent for retry and resumable upload recovery. |
| `/drive/upload_sessions` | Create idempotent upload sessions. |
| `/drive/upload_sessions/{sessionId}/parts/{partNo}` | Reserve or retrieve upload part grants when multipart is supported. |
| `/drive/upload_sessions/{sessionId}/complete` | Complete an upload and return the Drive resource plus `MediaResource` mapping when applicable. |
| `/drive/upload_sessions/{sessionId}/abort` | Abort an upload session. |
| `/drive/nodes/{nodeId}/download_grants` | Create a short-lived download grant or delivery URL. |

### 6.2 Backend API

The backend API exposes operator and admin workflows:

| Resource | Required operations |
| --- | --- |
| `/drive/storage_providers` | Register, list, update, disable, and health-check providers. |
| `/drive/spaces` | Admin list, inspect, quota control, policy assignment. |
| `/drive/nodes` | Admin inspect and lifecycle actions. |
| `/drive/storage_objects` | Reconciliation, quarantine, retention, deletion, provider diagnostics. |
| `/drive/upload_sessions` | Inspect, expire, abort, or repair sessions. |
| `/drive/policies` | Upload, download, retention, scanning, and quota policies. |

Rules:

- Upload/file/object-storage APIs belong to Drive. A business API may initiate a domain command that internally calls Drive, but it must not define a parallel upload session or object lifecycle contract.
- API responses that expose application-usable files should return a Drive resource DTO and, when the file is media-like, a `MediaResource` built from the Drive mapping in this spec.
- Presigned URLs may appear only in Drive upload/download grant responses. Business DTOs must not include presigned URLs as persisted identity.
- Provider bucket/object details are allowed only in Drive backend/admin DTOs or internal diagnostic DTOs with proper authorization.
- OperationIds must use SDKWork resource style, for example `spaces.create`, `nodes.children.list`, `uploader.uploads.create`, `uploader.uploads.parts.markUploaded`, `uploadSessions.parts.presign`, `uploadSessions.complete`, and `downloadGrants.create`.

### 6.3 Drive Uploader App API

Drive Uploader App API is the remote application upload adapter over the Drive server-side uploader service. It is required when browser, desktop renderer, H5/Capacitor, Flutter, mini-program, iOS, Android, HarmonyOS, or other non-in-process clients upload user-selected files into SDKWork-owned storage.

Required route contract:

| OperationId | Method and path | Purpose |
| --- | --- | --- |
| `uploader.uploads.create` | `POST /app/v3/api/drive/uploader/uploads` | Create or resume an upload task with verified tenant, organization, actor/operator, and app identity plus client-supplied resource, profile, file metadata, retention, and target-space intent. |
| `uploader.uploads.parts.markUploaded` | `PUT /app/v3/api/drive/uploader/uploads/{uploadItemId}/parts/{partNo}` | Record that a part was uploaded to the Drive-granted provider target. |
| `uploadSessions.parts.presign` | `PUT /app/v3/api/drive/upload_sessions/{uploadSessionId}/parts/{partNo}` | Return or refresh the short-lived upload grant for one part. |
| `uploadSessions.complete` | `POST /app/v3/api/drive/upload_sessions/{uploadSessionId}/complete` | Complete the Drive upload session and return stable Drive resource identity. |

Rules:

- Drive App API handlers `MUST` delegate to the Drive server-side uploader service or equivalent Drive-owned application service. They must not reimplement upload-space resolution, object-key planning, retention cleanup, part validation, or statistic recording in route code.
- The create request `MUST` carry only upload business intent: `appResourceType`, `appResourceId`, optional `scene`, optional `source`, `uploadProfileCode`, content metadata, target policy, and retention. `appId`, tenant, organization, actor, authenticated user, and operator attribution `MUST` come from the verified authenticated runtime and framework-injected `WebRequestContext`; an approved anonymous/share flow `MUST` use its verified anonymous principal and share context. These ambient identity values `MUST NOT` be accepted from client-writable body, query, header, or generated SDK method inputs.
- Raw `shareToken` is allowed only on prepare requests that target an explicit shared Drive folder. Drive must hash or otherwise protect the token before lookup and must not store or return the raw token.
- Business APIs that need an uploaded file `MUST` receive a Drive reference, Drive-backed `MediaResource`, or business relation id. They must not expose `/upload`, `/presign`, `/complete`, or file-part endpoints that duplicate Drive Uploader.
- Server-side Rust code in the same trusted backend should call the Drive server-side uploader service directly instead of calling these App API routes over HTTP.

## 7. RPC Contract

Drive RPC contracts follow `RPC_SPEC.md` and are peer adapters over the same Drive domain services used by HTTP.

Rules:

- Drive storage-control RPC may expose Drive-specific messages such as `DriveReference`, `DriveSpace`, `DriveNode`, `DriveUploadSession`, and `DriveDownloadGrant`.
- Business RPC services must use Drive references or `sdkwork.common.v1.MediaResource` for file/media payloads; they must not expose provider bucket/object identity unless they are Drive backend/internal services.
- Large file transfer should use Drive upload sessions, download grants, or range streaming. Business RPC services must not add ad hoc client streaming uploads unless Drive explicitly owns the stream.
- Drive RPC methods must map to equivalent HTTP operationIds where both surfaces exist.

Recommended common reference:

```proto
message DriveReference {
  string drive_uri = 1;
  string space_id = 2;
  string node_id = 3;
  string node_version = 4;
}
```

## 8. SDK Contract

Drive SDKs are generated from Drive OpenAPI/proto contracts and follow `SDK_SPEC.md`. Drive SDK workspace layout, OpenAPI authority file placement, derived generator inputs, and generated artifact placement follow `SDK_WORKSPACE_GENERATION_SPEC.md` as the subordinate detail standard.

Standard packages:

| Surface | Package |
| --- | --- |
| App HTTP SDK | `sdkwork-drive-app-sdk` / `@sdkwork/drive-app-sdk` |
| Backend HTTP SDK | `@sdkwork/drive-backend-sdk` |
| App RPC SDK | `@sdkwork/drive-app-rpc-sdk` when RPC is enabled |
| Backend RPC SDK | `@sdkwork/drive-backend-rpc-sdk` when RPC is enabled |

Rules:

- Frontend upload services must use the generated Drive app SDK for upload sessions, completion, node metadata, and download grants.
- `backend-admin` consoles must use the generated Drive backend SDK for provider, policy, quota, and diagnostic workflows.
- Business SDKs such as IM, commerce, user profile, or app manifest SDKs should receive Drive references or `MediaResource` payloads. They must not duplicate Drive upload operations.
- Consumers must not patch missing Drive SDK methods with raw HTTP, manual auth headers, direct provider SDK calls, or local generated-client forks. Fix Drive OpenAPI/proto and regenerate.

### 8.1 Drive Uploader SDK Contract

`sdkwork-drive-app-sdk` must expose a high-level composed uploader surface. Generated transport operations remain generated output; composed uploader orchestration may live in the approved SDK composed layer.

Required high-level client methods:

```text
client.uploader.upload()
client.uploader.uploadByProfile()
client.uploader.uploadVideo()
client.uploader.uploadImage()
client.uploader.uploadAudio()
client.uploader.uploadDocument()
client.uploader.uploadArchive()
client.uploader.uploadText()
client.uploader.uploadDataset()
client.uploader.uploadAttachment()
client.uploader.uploadAvatar()
client.uploader.uploadThumbnail()
```

The composed client may internally use generated operations such as `uploader.uploads.create`, `uploader.uploads.parts.markUploaded`, `uploadSessions.parts.presign`, and `uploadSessions.complete`. It may also own local state-store, part-planner, checksum, fingerprint, queue, concurrency, and progress helpers. Feature code outside the Drive SDK must not duplicate that orchestration.

Standard upload profiles:

```text
generic
video
image
audio
document
archive
text
dataset
attachment
avatar
thumbnail
```

Profile selection controls validation, default retention, chunk size, concurrency, checksum rules, content-type grouping, and post-processing hints. It must not create a separate upload implementation. A new profile requires a Drive governance/API/SDK update, not an application-local enum.

Generated SDK output `MUST NOT` be hand-edited. If `client.uploader.*` cannot perform a required upload flow, update Drive OpenAPI, product service, App API adapter, and SDK composed layer, then regenerate and verify the SDK.

## 9. Application Upload Flow

All SDKWork application uploads enter Drive through one of these modes:

| Mode | Required entry point | Owns | Forbidden |
| --- | --- | --- | --- |
| Client upload from browser, desktop renderer, tablet, H5/Capacitor, Flutter, mini-program, iOS, Android, or HarmonyOS | `sdkwork-drive-app-sdk` high-level `client.uploader.*` | file picker integration, transient preview/progress, local resumable state, SDK calls | app-local presign code, raw Drive App API HTTP, provider SDK calls, object-key generation |
| Server-side Rust upload for generated/imported/transformed bytes | `sdkwork-drive-uploader-service` crate or approved Drive server-side uploader facade | server byte source, actor/resource attribution, retention/profile choice, Drive service call | calling `/app/v3/api/drive/uploader/*` over HTTP inside the same Rust backend, direct S3/OSS/MinIO/local file lifecycle |
| Business API command that associates a file with a domain aggregate | application-owned app/backend SDK command accepting Drive reference, Drive-backed `MediaResource`, or relation id | domain relation, business validation, authorization | duplicate `/upload`, `/presign`, `/complete`, upload-session, or file-part endpoints |
| `backend-admin` provider, quota, policy, and diagnostic work | Drive backend SDK or Drive backend service | provider/policy/quota/admin lifecycle | using app upload flow for operator storage management |

Every upload-capable application must declare its canonical `appId` in application identity and runtime contracts so the authenticated runtime and `WebRequestContext` resolve it authoritatively. Its local component spec, architecture spec, or runbook must define canonical `appResourceType`, `appResourceId`, `scene`, `source`, and allowed `uploadProfileCode` values. These names must be stable enough for tenant, user, app, resource, and profile usage reports.

Standard frontend flow:

```text
local File / picker asset
  -> sdkwork-drive-app-sdk client.uploader.* normalizes metadata
  -> Drive App API prepares or resumes uploader task
  -> SDK plans parts and requests Drive upload grants
  -> SDK uploads bytes to the granted provider URL or Drive streaming endpoint
  -> SDK marks each uploaded part through Drive Uploader
  -> Drive app SDK completes upload session
  -> Drive returns Drive resource + optional MediaResource
  -> business service submits Drive reference / MediaResource to business SDK
```

Rules:

- UI-local `File`, object URL previews, retry counters, and progress state are transient.
- Presigned upload/download URLs are service-local grants and must not enter business forms as identity.
- Business form state should carry `driveUri`, `driveSpaceId`, `driveNodeId`, or `MediaResource`, depending on the contract.
- Cache keys for persisted file/media resources should use `drive_uri`, `drive_node_id`, or `MediaResource.id`, not signed delivery URLs.
- Browser code must not construct provider object keys or call S3/OSS/MinIO SDKs directly.
- Feature code must not call raw `fetch`, `axios`, or generic request helpers against `/app/v3/api/drive/uploader/*`, `/app/v3/api/drive/upload_sessions/*`, S3, OSS, MinIO, or local object-storage endpoints. The only expected raw byte upload in browser/mobile code is the Drive SDK composed uploader's internal call to the short-lived provider upload URL returned by Drive.
- Feature service layers, not UI components, `MUST` supply only selected content and upload business intent: `appResourceType`, `appResourceId`, optional `scene`, optional `source`, `uploadProfileCode`, target policy, and retention. They `MUST NOT` pass `appId`, `tenantId`, `organizationId`, current `userId`, actor/operator identifiers, or equivalent ambient identity as generated SDK method inputs or client-writable request fields; the Drive SDK and App API derive those dimensions from the verified authenticated runtime and `WebRequestContext`. UI components may select files and display progress, but they do not invent statistic dimensions.
- The SDK may persist local resumable state such as fingerprint, task id, progress, and completed parts for acceleration. Drive server state remains authoritative and must be queried during prepare/resume.

### 9.1 Server-Side Rust Upload

Rust services that generate, import, transform, or receive trusted server-side bytes use the Drive server-side uploader service directly.

Required service boundary:

```rust
use sdkwork_drive_uploader_service::service::{
    DriveUploaderService, PrepareUploaderUploadCommand, MarkUploaderPartUploadedCommand,
    UploaderActor, UploaderRetention, UploaderTarget,
};
```

Rules:

- Rust upload callers `MUST` build `PrepareUploaderUploadCommand` or an approved facade command with tenant, optional organization, `UploaderActor`, `app_id`, `app_resource_type`, `app_resource_id`, optional `scene`, optional `source`, `upload_profile_code`, file fingerprint, original file name, content type, content length, chunk size, `UploaderTarget`, `UploaderRetention`, operator, and time.
- Use `UploaderActor::System` for background jobs and system imports, `UploaderActor::User` for user-initiated backend processing, and `UploaderActor::Anonymous` only for explicitly allowed anonymous upload flows.
- Use `UploaderTarget::AutoUploadSpace` by default. Explicit target-space uploads require Drive permission validation; anonymous/external explicit target uploads require an active writer share-link token.
- Use `UploaderRetention::LongTerm` for durable business files and `UploaderRetention::Temporary` for temporary imports, transient generated content, or expiring processing artifacts. Cleanup behavior is owned by Drive maintenance jobs.
- Profile helpers such as `prepare_video_upload`, `prepare_image_upload`, or approved `upload_*_bytes` helpers are shortcuts only. They must delegate to the same profile-driven Drive Uploader core.
- Rust services `MUST NOT` build object keys, create Drive upload sessions directly, maintain part facts, call storage providers directly, write app-local files as durable SDKWork content, or call Drive App API over HTTP when they can depend on the Drive server-side uploader service.
- External non-Rust services that cannot link the Drive server-side uploader service may use Drive App API or an approved generated Drive SDK, but they still follow the same attribution, profile, retention, and business-reference rules.

### 9.2 Attribution And Statistics

Every Drive Uploader task must be attributable across these dimensions:

| Dimension | Required meaning |
| --- | --- |
| tenant | Tenant that owns or is charged for the upload. |
| organization | Optional organization/team attribution for analytics and quota. |
| actor | User, anonymous actor, or system/operator identity that initiated the upload. |
| app | Stable `appId` of the application or product module. |
| app resource | Stable `appResourceType` and `appResourceId` for the owning aggregate or draft task. |
| scene/source | Workflow and source labels such as `chat_message`, `catalog_image`, `avatar`, `admin_import`, `ai_generated`, or `migration_job`. |
| profile | Standard `uploadProfileCode`. |
| content | Content type, content type group, size, checksum, original filename, part count, and chunk size. |
| Drive target | Space, node, upload session, storage object, and target policy. |
| retention | Long-term or temporary retention mode, expiry, cleanup action, and hard-delete timing. |

Usage, quota, billing, tenant reports, user reports, and product analytics should aggregate from Drive uploader facts, not app-local counters. Application domains may keep denormalized read models for query performance, but Drive remains the source of truth for upload lifecycle and statistics.

### 9.3 Resumability, Retention, And Cleanup

Resumable upload is a Drive Uploader capability. The SDK may compute `fileFingerprint`, `taskId`, checksum, content type, original filename, `chunkSizeBytes`, and local progress state, but Drive owns task and part facts.

Required resumable sequence:

```text
1. SDK or server caller computes stable file/task metadata.
2. Drive Uploader prepare creates or resumes the task and resolves the Upload space.
3. Caller uploads only missing parts through Drive-granted upload targets.
4. Caller marks each uploaded part through Drive Uploader.
5. Drive validates part facts, checksum, size, target object, and policy.
6. Drive completes the upload session and returns stable Drive identity.
7. Business service persists only Drive reference or MediaResource relation.
```

Retention modes:

```text
long_term
temporary
```

Temporary retention must include TTL and cleanup behavior such as soft delete, hard delete, and optional second-stage hard-delete timing. Maintenance jobs such as `expired_upload_content_sweep` and `abandoned_upload_task_sweep` own cleanup. Automatic soft delete or hard delete must write audit records and `dr_drive_file_sensitive_operation` snapshots.

### 9.4 Upload Space Ownership

Drive Uploader uses the business display name `Upload`; the persisted Drive space type remains `app_upload` for generic application uploads. When the normalized upload `scene` is `im`, Drive Uploader must use the business display name `IM` and persisted Drive space type `im`.

Default space ownership:

- Anonymous uploads use an app-owned Upload space with owner subject similar to `app:{appId}:anonymous`.
- Logged-in user uploads use the user's Upload space.
- System uploads use an app-owned system Upload space with owner subject similar to `app:{appId}:system`.
- IM uploads use `scene = im`, source labels such as `chat_message`, and an `im` space. The same actor ownership rules apply: logged-in user IM uploads are user-owned, anonymous IM uploads are app-owned anonymous spaces, and system IM uploads are app-owned system spaces.
- Organization attribution is stored on uploader metadata and reporting facts. It does not require every user upload to be placed in an organization-owned space.

Explicit target-space uploads are allowed only when Drive validates the active target space and writer/owner permission for the caller. Anonymous or external explicit target uploads require an active writer share-link token accepted only by the prepare request; raw share tokens must not be stored or returned.

## 10. Drive-Backed MediaResource Profile

`MEDIA_RESOURCE_SPEC.md` defines the `MediaResource` shape. This section defines the Drive-backed mapping.

Required mapping for SDKWork-owned object-storage resources:

| `MediaResource` field | Drive-backed value |
| --- | --- |
| `id` | Stable Drive node id, or a Drive media projection id if Drive exposes one. |
| `kind` | Derived from Drive content type, domain role, or explicit caller metadata. |
| `source` | `drive`. |
| `uri` | `drive://spaces/{spaceId}/nodes/{nodeId}`. |
| `objectBlobId` | Stable Drive storage object/version id when Drive exposes one; otherwise omit and rely on `uri` plus Drive metadata. |
| `fileName` | Drive node display name or original filename policy result. |
| `mimeType` | Drive content type after validation/sniffing. |
| `sizeBytes` | Drive content length as a JSON string. |
| `checksum` | Drive checksum, preferably SHA-256. |
| `url` | Optional short-lived delivery hint from Drive download grant. |
| `access` | Visibility and expiry derived from Drive policy and business authorization. |
| `metadata.drive` | Drive metadata such as `spaceId`, `nodeId`, `spaceType`, `nodeVersion`, and policy codes. |

Drive-backed example:

```json
{
  "id": "node_01HR6P7ZJQ4A7M2CKA9F0P6R7S",
  "kind": "image",
  "source": "drive",
  "uri": "drive://spaces/space_app_upload_01/nodes/node_01HR6P7ZJQ4A7M2CKA9F0P6R7S",
  "fileName": "demo.png",
  "mimeType": "image/png",
  "sizeBytes": "424242",
  "checksum": {
    "algorithm": "sha256",
    "value": "3f786850e387550fdab836ed7e6dc881de23001b000000000000000000000000"
  },
  "access": {
    "visibility": "tenant"
  },
  "metadata": {
    "drive": {
      "spaceId": "space_app_upload_01",
      "nodeId": "node_01HR6P7ZJQ4A7M2CKA9F0P6R7S",
      "spaceType": "app_upload",
      "nodeVersion": "1"
    }
  }
}
```

Rules:

- Business APIs must not require `bucketId` or `objectKey` in a Drive-backed `MediaResource`.
- Drive internal/admin APIs may expose bucket/object fields for operations and diagnostics, but those fields must not be copied into business state.
- `url` in a Drive-backed `MediaResource` is optional and temporary. Clients must use Drive download grants when a fresh URL is needed.
- AI-generated or edited media must include `ai` provenance in addition to Drive metadata.

## 11. Special Space Profiles

### 11.1 Knowledge Base

Knowledge-base files use `knowledge_base` spaces. Ingestion, parsing, chunking, embedding, index status, source document identity, and reindex policy must be attached to the Drive space profile or a knowledge-domain relation that references Drive. The knowledge domain must not store duplicate file bytes or object keys.

### 11.2 AI Generated

Generated images, audio, video, documents, model artifacts, and edited media use `ai_generated` spaces unless a application-specific app upload policy is explicitly selected. AI provenance belongs in `MediaResource.ai` and/or Drive-linked generation records. Provider URLs that expire must be imported into Drive or represented as provider assets with explicit refresh rules before becoming SDKWork-owned business state.

### 11.3 App Upload

Application uploads use `app_upload` spaces bound by `app_id`, `app_resource_type`, and `app_resource_id`. Examples include product catalog media, user avatars, approval documents, app manifest screenshots, and exported reports.

### 11.4 IM

Instant-messaging uploads use `im` spaces when the Drive Uploader request has `scene = im`. IM business modules must still use Drive Uploader and persist only Drive references or Drive-backed `MediaResource` snapshots; they must not create IM-owned upload-session, object-blob, presign, bucket, or object-key storage.

## 12. Security And Privacy

Rules:

- Every Drive resource must be tenant-scoped.
- Authorization must be evaluated by Drive policy and the calling business context. A valid Drive node id alone is not authorization.
- Upload policy must define allowed MIME types, size limits, extension policy, checksum requirements, scanning rules, and retention.
- Drive must verify content length, checksum where supplied, and content type. File extension alone is not enough.
- Signed upload/download grants must be short-lived and auditable.
- Logs must not contain credentials, signed URL query strings, private headers, provider secrets, or raw user file content.
- File metadata may contain personal or sensitive data and must follow `PRIVACY_SPEC.md`.
- Public files still need owner, tenant, checksum, size, MIME type, lifecycle, and deletion policy.

## 13. Events And Observability

Drive events follow `EVENT_SPEC.md`. Standard event names should use the `drive.` prefix, for example:

- `drive.space.created`
- `drive.node.created`
- `drive.node.deleted`
- `drive.upload_session.created`
- `drive.upload_session.completed`
- `drive.uploader.upload_prepared`
- `drive.uploader.part_uploaded`
- `drive.uploader.upload_completed`
- `drive.uploader.content_expired`
- `drive.object.quarantined`
- `drive.download_grant.created`

Observability follows `OBSERVABILITY_SPEC.md`:

- Trace Drive upload/session/download operations across SDK, API, Drive service, and provider adapter.
- Record provider latency, error kind, retry count, object size, grant expiry, upload completion time, upload profile, content type group, part count, tenant, actor type, app id, app resource type, and source/scene where safe.
- Do not emit high-cardinality object keys or signed URLs as metric labels.

## 14. Forbidden Technical Debt

New SDKWork code `MUST NOT` introduce:

- App-owned object blob tables such as `<application_code>_object_blob`, `<domain>_media_asset`, or `<domain>_upload_session` when the purpose is file storage lifecycle.
- App-owned storage provider registries or provider credential tables.
- App-owned presign services, direct S3/OSS/MinIO browser SDK flows, or hidden raw HTTP upload endpoints.
- Long-term `url`, `file_url`, `image_url`, `thumbnail_url`, `asset_url`, or `download_url` columns for SDKWork-owned files/media.
- Bucket/object key storage in arbitrary business JSON.
- Dual-write compatibility mirrors between old media tables and Drive for new unpublished applications.
- Business APIs that return provider bucket/object identity as normal application DTOs.
- Frontend services that bypass Drive SDK because a generated method is missing.
- App-local uploader widgets, service facades, upload queues, resumable-state tables, or upload statistic counters that bypass `sdkwork-drive-app-sdk client.uploader.*`.
- Server-side Rust services that upload SDKWork-owned files by calling S3/OSS/MinIO/local filesystem provider APIs directly instead of `DriveUploaderService` or an approved Drive server-side uploader facade.
- Rust services in the same trusted backend that call `/app/v3/api/drive/uploader/*` over HTTP instead of using the Drive server-side uploader service.
- Business APIs that expose duplicate file upload, presign, upload-session, file-part, object-key, or completion endpoints for SDKWork-owned files.
- Application-local upload profile enums that diverge from Drive standard profiles.

If a capability is missing in Drive, the standard fix is to add it to `sdkwork-drive`, update the Drive API/RPC contract, regenerate the Drive SDK, and then consume it from the business module.

## 15. Adoption Rules

New SDKWork applications and unpublished modules must adopt Drive directly with no compatibility layer.

When removing a legacy app-local storage implementation:

1. Delete app-local storage provider, upload session, media asset, and presign lifecycle ownership.
2. Create or reuse a Drive `app_upload`, `im`, `knowledge_base`, or `ai_generated` space.
3. Upload/import files into Drive and resolve `drive_space_id`, `drive_node_id`, and `drive_uri`.
4. Store only business relation rows and optional `MediaResource` snapshots in the business domain.
5. Update API/RPC/SDK/frontend contracts to use Drive references and `MediaResource`.
6. Delete bare URL and raw object-key fields from business persistence and DTOs.

Legacy compatibility is allowed only for already published external contracts with a documented governance exception. It is not allowed as a convenience for new SDKWork-owned work.

## 16. Review Checklist

- [ ] File/upload/object-storage lifecycle is owned by Drive.
- [ ] Business schemas store `drive_space_id`, `drive_node_id`, `drive_uri`, or `MediaResource` snapshots, not provider object keys.
- [ ] Client upload services use `sdkwork-drive-app-sdk client.uploader.*` and keep `File`, object URLs, local progress, local resumable state, and presigned URLs transient.
- [ ] Server-side Rust uploads use `DriveUploaderService`, `PrepareUploaderUploadCommand`, or an approved Drive server-side uploader facade rather than HTTP App API calls or provider SDK calls.
- [ ] Upload session preparation, part presign, part mark-uploaded, completion, abort, and download grants use Drive APIs, Drive SDKs, Drive RPC, or Drive server-side components.
- [ ] Every upload derives tenant, organization when applicable, user/anonymous/system actor, operator, and `appId` from verified request/runtime context; callers supply only app-resource, scene/source, profile, content, target, and retention intent, with no ambient identity accepted as client-writable input.
- [ ] Upload profiles use Drive standard codes and do not fork application-local upload implementations.
- [ ] Usage/stat dashboards and quota reports aggregate from Drive uploader facts, not app-local counters.
- [ ] Drive-backed `MediaResource` values use `uri = drive://spaces/{spaceId}/nodes/{nodeId}`.
- [ ] Provider credentials, bucket names, object keys, and signed URLs do not leak into business DTOs or persisted business state.
- [ ] AI-generated media and knowledge-base files use the correct Drive special space profile.
- [ ] Security review covers tenant isolation, authorization, MIME/size/checksum validation, scanning, retention, signed URL expiry, and logging.
- [ ] Observability records provider and upload lifecycle metrics without exposing secrets or high-cardinality signed URLs.
- [ ] Missing Drive capabilities are fixed in Drive contracts and generated SDKs, not patched with app-local storage code.

## 17. Website Content Local Delivery Cache

Drive-backed published websites (drive website roots) are served by
`sdkwork-webserver` from storage-provider objects. Because published node
content is **immutable per version**, the webserver `MAY` keep a local disk
cache of the byte payloads so repeat requests avoid provider round trips.

### 17.1 Cache Identity And Immutability

- The cache key `MUST` be `SHA-256(tenant_scope_hash ‖ website_root_uuid ‖ logical_node_version_id)`.
  The key binds the logical content identity, so a new published version is a
  new key and stale entries become unreachable garbage, not a correctness risk.
- Cached entries `MUST` be treated as immutable. Writers `MUST NOT` modify an
  already-published entry in place; conflicting publishes of the same key are
  dropped (first writer wins).
- Authorization, conditional requests, and version pinning remain the
  responsibility of metadata resolution (`resolve_resource`), which runs on
  every request. Only the byte payload is cached.

### 17.2 Storage Layout And Atomic Publish

- Entries live under the environment-segmented root
  `<cache_root>/<environment>/<2-hex-shard>/<key>` where `<cache_root>`
  defaults to `/opt/deploy/drive/website-cache` (see
  `SDKWORK_WEBSERVER_SPEC.md` §17.5 for the host mount).
- The environment path segment `MUST` be sanitized to `[a-z0-9_-]+` to prevent
  path traversal from environment-derived configuration.
- Writes go to a process-unique staging path and publish by atomic rename.
  On Windows (developer environments) a rename onto an existing path fails;
  the implementation `MUST` treat that as first-writer-wins and discard its
  staging file.
- Content is addressed by the key above; deduplication across tenants is not
  required and `MUST NOT` be assumed when the cache root is shared.

### 17.3 LRU Bounds And Multi-Instance Races

- The cache `MUST` enforce a total-byte budget and an entry-count budget
  (defaults are deployment inputs, see §17.5 configuration variables).
- An in-process index of live entries is `MUST`; it is rebuilt from the disk
  layout at startup, so caches survive restarts and instances see each
  other's published entries on the shared mount.
- Eviction removes least-recently-touched entries until both budgets hold.
  Access-time tracking is in-process best effort; cross-instance access does
  not refresh another instance's recency. This is acceptable: eviction only
  affects hit rate, never correctness.
- Multi-instance races on a shared host mount `MUST` be benign:
  - concurrent publishes of the same key → one file wins, the loser discards;
  - an entry evicted between index hit and file open → the open `MUST` be
    treated as a miss and the request re-fetched from upstream.

### 17.4 Failure-Safe Degradation

- Cache open/write failures `MUST NOT` fail the request: staging write
  failures downgrade to pass-through streaming, open failures are misses.
- Only full (non-Range) requests `MUST` populate the cache. Range requests
  are served by slicing an already-cached full object; a Range miss streams
  upstream without backfilling.
- Upstream stream failure after staging started `MUST` discard the staging
  file and never publish a partial entry.

### 17.5 Configuration And Deployment Inputs

- `SDKWORK_DRIVE_WEBSITE_CACHE_ENABLED` (default `true` in the container image).
- `SDKWORK_DRIVE_WEBSITE_CACHE_ROOT` (default `/opt/deploy/drive/website-cache`).
- `SDKWORK_DRIVE_WEBSITE_CACHE_ENVIRONMENT` (deployment environment segment; defaults from the lifecycle environment).
- `SDKWORK_DRIVE_WEBSITE_CACHE_MAX_TOTAL_BYTES` (default `8589934592` = 8 GiB).
- `SDKWORK_DRIVE_WEBSITE_CACHE_MAX_ENTRIES` (default `100000`).

### 17.6 Open-Source Alternatives Evaluation (Normative Rationale)

Implementations `MUST` evaluate existing open-source local-cache libraries
before extending the in-process cache. The evaluation below is the recorded
baseline (2026-09) and `MUST` be re-run if the delivery requirements change.

| Candidate | Fit assessment |
| --- | --- |
| `cacache` (Rust) | Content-addressable store with atomic writes, integrity verification, dedup, and multi-process safety. **Not adopted**: no size-budget LRU eviction, and its public `Reader` has no seek, so HTTP Range serving of large files would require undocumented content-path derivation or O(offset) skip reads. |
| `foyer` (RisingWave) | Hybrid memory+disk block cache. **Not adopted**: entries are serialized into its own block-file format and read back into memory — no file-handle serving, no Range slicing, not multi-process. |
| `lru-disk-cache` (sccache lineage) | Size-budget LRU. **Not adopted**: unmaintained, no integrity guarantees, no entry-count budget, no multi-instance story. |
| `nginx proxy_cache` / Varnish / ATS | Industry-standard HTTP cache proxies. **Not applicable**: the standalone profile forbids stock nginx on the public edge (`NGINX_SPEC.md` §0, `SDKWORK_WEBSERVER_SPEC.md` §17.4) and drive content requires per-request authorization and version pinning inside the Rust data plane. |
| `moka` / `stretto` / `cached` | In-memory caches (the `cached` disk store wraps `cacache`). **Not adopted** for the disk layer. |

Decision: the standard implementation is the thin in-process adapter in
`sdkwork-webserver-drive-provider` (`DriveContentCache`). Its public API is
the replacement seam: `open_cached` / `open_cached_range` / `fill_stream`
hide the storage engine, so adopting a library later (for example `cacache`
for on-read integrity verification, accepting content-path derivation for
Range) is a contained change that does not touch routing or the provider
adapter.

### 17.7 Review Checklist

- [ ] Cache keys bind the logical node version identity, never a mutable path.
- [ ] The environment path segment is sanitized; no traversal from config.
- [ ] Publish is atomic; partial upstream streams never become cache entries.
- [ ] Both budgets (bytes and entries) are enforced and survive restarts.
- [ ] Multi-instance races degrade to misses, never to errors or torn reads.
- [ ] Cache failures downgrade to upstream streaming; logs do not spam.
