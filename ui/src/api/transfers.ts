// Server-side transfer job API
import { api } from './client'

export interface TransferJob {
  id: string
  userId: string
  type: string          // 'copy', 'move', 'compress', 'delete'
  status: string        // 'pending', 'running', 'completed', 'error', 'cancelled'
  sourcePath: string
  destinationPath: string
  totalBytes: number
  copiedBytes: number
  totalFiles: number
  copiedFiles: number
  currentFile?: string
  bytesPerSec: number
  errorMessage?: string
  mode?: string
  fileConflict?: string
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export interface CreateTransferRequest {
  type: 'copy' | 'move'
  sourcePath: string
  destinationPath: string
  overwrite?: boolean
  mode?: string         // 'merge'
  fileConflict?: string // 'overwrite', 'skip', 'rename'
}

export interface TransferProgressEvent {
  type: 'transfer_progress'
  jobId: string
  status: string
  progress: number
  totalFiles: number
  copiedFiles: number
  totalBytes: number
  copiedBytes: number
  currentFile?: string
  bytesPerSec: number
  errorMessage?: string
  newPath?: string
}

interface ApiDataResponse<T> {
  data: T
}

export async function listTransferJobs(): Promise<TransferJob[]> {
  const res = await api.get<ApiDataResponse<TransferJob[]>>('/transfers')
  return res.data
}

export async function getTransferJob(id: string): Promise<TransferJob> {
  const res = await api.get<ApiDataResponse<TransferJob>>(`/transfers/${id}`)
  return res.data
}

export async function createTransferJob(req: CreateTransferRequest): Promise<{ id: string }> {
  const res = await api.post<ApiDataResponse<{ id: string }>>('/transfers', req)
  return res.data
}

export async function cancelTransferJob(id: string): Promise<void> {
  await api.delete(`/transfers/${id}`)
}
