import { useEffect, useRef, useState } from 'react'
import {
  cancelUserImportJob,
  createUserImportJob,
  downloadUserImportResult,
  downloadUserImportTemplate,
  getUserImportJob,
  UserImportJob,
  UserImportValidation,
  validateUserImport,
} from '../api/auth'
import './UserImportModal.css'

interface UserImportModalProps {
  isOpen: boolean
  onClose: () => void
  onCompleted: () => void
}

const JOB_STORAGE_KEY = 'filehatch-user-import-job'

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function UserImportModal({ isOpen, onClose, onCompleted }: UserImportModalProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [validation, setValidation] = useState<UserImportValidation | null>(null)
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [job, setJob] = useState<UserImportJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const savedJob = localStorage.getItem(JOB_STORAGE_KEY)
    if (!savedJob) return
    void getUserImportJob(savedJob).then(setJob).catch(() => localStorage.removeItem(JOB_STORAGE_KEY))
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !job || !['pending', 'running'].includes(job.status)) return
    const timer = window.setInterval(() => {
      void getUserImportJob(job.id).then((nextJob) => {
        setJob(nextJob)
        if (nextJob.status === 'completed') {
          onCompleted()
          window.clearInterval(timer)
        }
      }).catch((reason) => setError(reason instanceof Error ? reason.message : '작업 상태 확인 실패'))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [isOpen, job, onCompleted])

  const resetAndClose = () => {
    setFile(null)
    setValidation(null)
    setIdempotencyKey('')
    setError(null)
    if (inputRef.current) inputRef.current.value = ''
    onClose()
  }

  const handleValidate = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      setValidation(await validateUserImport(file))
      setIdempotencyKey(crypto.randomUUID())
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'CSV 검증에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  const handleRun = async () => {
    if (!file || !validation || !idempotencyKey) return
    setBusy(true)
    setError(null)
    try {
      const result = await createUserImportJob(file, idempotencyKey, validation)
      localStorage.setItem(JOB_STORAGE_KEY, result.importJobId)
      setJob(await getUserImportJob(result.importJobId))
      setFile(null)
      if (inputRef.current) inputRef.current.value = ''
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '등록 작업을 시작하지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  const handleCancel = async () => {
    if (!job || !confirm('대기 중인 일괄 등록 작업을 취소하시겠습니까?')) return
    setBusy(true)
    try {
      await cancelUserImportJob(job.id)
      setJob(await getUserImportJob(job.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '작업 취소에 실패했습니다')
    } finally {
      setBusy(false)
    }
  }

  const loadResultPage = async (offset: number) => {
    if (!job) return
    setBusy(true)
    try {
      setJob(await getUserImportJob(job.id, offset, job.limit ?? 100))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '결과 페이지를 불러오지 못했습니다')
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen) return null
  const rows = job?.rows ?? validation?.rows ?? []
  const summary = job?.summary ?? validation?.summary

  return (
    <div className="modal-overlay" onClick={resetAndClose}>
      <section className="user-import-modal" role="dialog" aria-modal="true" aria-labelledby="user-import-title" onClick={(event) => event.stopPropagation()}>
        <header className="user-import-header">
          <div>
            <h2 id="user-import-title">CSV 일괄 등록</h2>
            <p>최대 1,000명, UTF-8 CSV 파일을 검증한 뒤 비동기 등록합니다.</p>
          </div>
          <button type="button" className="close-btn" aria-label="CSV 일괄 등록 닫기" onClick={resetAndClose}>×</button>
        </header>
        <div className="user-import-content">
          <div className="user-import-warning">
            CSV에는 평문 비밀번호가 포함됩니다. 관리자 PC에서 안전하게 보관하고 작업 후 완전히 삭제하세요.
          </div>
          <button type="button" className="btn-secondary" onClick={() => void downloadUserImportTemplate().then((blob) => saveBlob(blob, 'filehatch-users-template.csv')).catch((reason) => setError(reason.message))}>
            CSV 양식 다운로드
          </button>
          <label className="user-import-file">
            <span>CSV 파일 선택</span>
            <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setValidation(null); setIdempotencyKey('') }} />
          </label>
          {file && <p>{file.name} · {(file.size / 1024).toFixed(1)} KB</p>}
          {error && <div className="error-banner" role="alert">{error}</div>}
          {summary && (
            <div className="user-import-summary" aria-live="polite">
              <span>전체 {summary.total ?? rows.length}</span>
              <span>생성 {summary.created ?? 0}</span>
              <span>경고 {summary.warnings ?? 0}</span>
              <span>실패 {summary.failed ?? 0}</span>
              <span>건너뜀 {summary.skipped ?? 0}</span>
            </div>
          )}
          {job && <p className="user-import-status" aria-live="polite">작업 상태: {job.status}</p>}
          {rows.length > 0 && (
            <div className="user-import-results">
              <table>
                <thead><tr><th>행</th><th>사용자명</th><th>상태</th><th>결과</th></tr></thead>
                <tbody>{rows.slice(0, 100).map((row) => <tr key={`${row.row}-${row.username}`}><td>{row.row}</td><td>{row.username}</td><td>{row.status}</td><td>{row.message ?? row.code ?? '-'}</td></tr>)}</tbody>
              </table>
              {rows.length > 100 && <p>화면에는 첫 100행만 표시합니다. 전체 결과는 CSV로 내려받으세요.</p>}
              {job && (job.resultTotal ?? 0) > (job.limit ?? 100) && (
                <nav className="user-import-pagination" aria-label="일괄 등록 결과 페이지">
                  <button type="button" disabled={busy || (job.offset ?? 0) === 0} onClick={() => void loadResultPage(Math.max(0, (job.offset ?? 0) - (job.limit ?? 100)))}>이전</button>
                  <span>{Math.floor((job.offset ?? 0) / (job.limit ?? 100)) + 1} / {Math.ceil((job.resultTotal ?? 0) / (job.limit ?? 100))}</span>
                  <button type="button" disabled={busy || (job.offset ?? 0) + (job.limit ?? 100) >= (job.resultTotal ?? 0)} onClick={() => void loadResultPage((job.offset ?? 0) + (job.limit ?? 100))}>다음</button>
                </nav>
              )}
            </div>
          )}
        </div>
        <footer className="user-import-actions">
          {job?.status === 'completed' && <button type="button" className="btn-secondary" onClick={() => void downloadUserImportResult(job.id).then((blob) => saveBlob(blob, 'filehatch-user-import-result.csv')).catch((reason) => setError(reason.message))}>결과 CSV 다운로드</button>}
          {job?.status === 'pending' && <button type="button" className="btn-secondary" disabled={busy} onClick={handleCancel}>대기 작업 취소</button>}
          {!job || !['pending', 'running'].includes(job.status) ? (
            <>
              <button type="button" className="btn-secondary" disabled={!file || busy} onClick={handleValidate}>1. 검증</button>
              <button type="button" className="btn-primary" disabled={!file || !validation || !idempotencyKey || busy} onClick={handleRun}>2. 등록 시작</button>
            </>
          ) : null}
        </footer>
      </section>
    </div>
  )
}

export default UserImportModal
