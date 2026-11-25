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
