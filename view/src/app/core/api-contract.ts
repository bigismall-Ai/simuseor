// 后端契约类型别名：来自 backend/openapi.json，禁止手写同名字段。
// 生成：cd tests && npm run api:types
import type { components } from './api-types';

export type ApiSchemas = components['schemas'];

export type HealthResponse = ApiSchemas['HealthResponse'];
export type FolderOption = ApiSchemas['FolderOption'];
export type GpuInfo = ApiSchemas['GpuInfo'];
export type TaskFile = ApiSchemas['TaskFile'];
export type TaskItem = ApiSchemas['TaskItem'];
export type WorkflowLocalList = ApiSchemas['WorkflowLocalList'];
export type NodeInstalledList = ApiSchemas['NodeInstalledList'];
export type SearchResponse = ApiSchemas['SearchResponse'];
export type LibraryItem = ApiSchemas['LibraryItem'];
export type ProbeResponse = ApiSchemas['ProbeResponse'];
export type DeviceInfo = ApiSchemas['DeviceInfo'];

/** 后端 `ApiError` 的稳定错误码；没有 code 的旧端点只看 detail。 */
export type ApiErrorCode =
  | 'invalid_source'
  | 'invalid_request'
  | 'not_found'
  | 'conflict'
  | 'forbidden'
  | 'source_unavailable'
  | 'filesystem_error';

export interface ApiErrorBody {
  detail: string;
  code?: ApiErrorCode;
}
