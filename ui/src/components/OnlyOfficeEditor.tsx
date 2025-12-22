import { useEffect, useRef, useState } from 'react'
import { OnlyOfficeConfig } from '../api/files'
import './OnlyOfficeEditor.css'

// Declare the DocsAPI type for OnlyOffice Document Server API
declare global {
  interface Window {
    DocsAPI?: {
      DocEditor: new (elementId: string, config: OnlyOfficeEditorConfig) => OnlyOfficeDocEditor
    }
  }
}

interface OnlyOfficeDocEditor {
  destroyEditor: () => void
}

interface OnlyOfficeEditorConfig {
  documentType: string
  document: {
    fileType: string
    key: string
    title: string
    url: string
  }
  editorConfig: {
    callbackUrl: string
    user: {
      id: string
      name: string
    }
    lang: string
    mode?: string
    customization: {
      autosave: boolean
      forcesave: boolean
      compactHeader?: boolean
      toolbarNoTabs?: boolean
    }
  }
  events?: {
    onDocumentReady?: () => void
    onError?: (event: { data: { errorDescription: string } }) => void
    onRequestClose?: () => void
  }
  width?: string
  height?: string
}

interface OnlyOfficeEditorProps {
  config: OnlyOfficeConfig
  onClose: () => void
  onError?: (error: string) => void
}

function OnlyOfficeEditor({ config, onClose, onError }: OnlyOfficeEditorProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const editorRef = useRef<OnlyOfficeDocEditor | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Load OnlyOffice Document Server API script
    const scriptId = 'onlyoffice-api-script'
    let script = document.getElementById(scriptId) as HTMLScriptElement | null

    const initEditor = () => {
      if (!window.DocsAPI) {
        setError('OnlyOffice Document Server API not loaded')
        setIsLoading(false)
        return
      }

      try {
        const editorConfig: OnlyOfficeEditorConfig = {
          documentType: config.documentType,
          document: config.document,
          editorConfig: {
            ...config.editorConfig,
            mode: 'edit',
            customization: {
              ...config.editorConfig.customization,
              compactHeader: true,
              toolbarNoTabs: false,
            },
          },
          events: {
            onDocumentReady: () => {
              setIsLoading(false)
            },
            onError: (event) => {
              const errMsg = event.data?.errorDescription || 'Unknown error'
              setError(errMsg)
              onError?.(errMsg)
              setIsLoading(false)
            },
            onRequestClose: () => {
              onClose()
            },
          },
          width: '100%',
          height: '100%',
        }

        editorRef.current = new window.DocsAPI.DocEditor('onlyoffice-editor', editorConfig)
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Failed to initialize editor'
        setError(errMsg)
        onError?.(errMsg)
        setIsLoading(false)
      }
    }

    if (!script) {
      script = document.createElement('script')
      script.id = scriptId
      script.src = '/onlyoffice/web-apps/apps/api/documents/api.js'
      script.async = true
      script.onload = initEditor
      script.onerror = () => {
        setError('OnlyOffice\uac00 \uc124\uce58\ub418\uc5b4 \uc788\uc9c0 \uc54a\uc2b5\ub2c8\ub2e4. docker compose --profile office up -d \ub85c \uc2dc\uc791\ud558\uc138\uc694.')
        setIsLoading(false)
      }
      document.head.appendChild(script)
    } else if (window.DocsAPI) {
      initEditor()
    } else {
      script.onload = initEditor
    }

    return () => {
      if (editorRef.current) {
        try {
          editorRef.current.destroyEditor()
        } catch {
          // Ignore destroy errors
        }
        editorRef.current = null
      }
    }
  }, [config, onClose, onError])

  return (
    <div className="onlyoffice-overlay">
      <div className="onlyoffice-container" ref={containerRef}>
        <div className="onlyoffice-header">
          <span className="onlyoffice-title">{config.document.title}</span>
          <button className="onlyoffice-close-btn" onClick={onClose}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="onlyoffice-editor-wrapper">
          {isLoading && !error && (
            <div className="onlyoffice-loading">
              <div className="onlyoffice-spinner"></div>
              <p>문서 편집기 로딩 중...</p>
            </div>
          )}
          {error && (
            <div className="onlyoffice-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4M12 16h.01" />
              </svg>
              <p>{error}</p>
              <button className="btn-secondary" onClick={onClose}>닫기</button>
            </div>
          )}
          <div id="onlyoffice-editor" style={{ display: error ? 'none' : 'block' }}></div>
        </div>
      </div>
    </div>
  )
}

export default OnlyOfficeEditor
