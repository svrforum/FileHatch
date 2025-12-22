import { useState, useEffect, useRef, useCallback } from 'react'
import Editor, { OnMount } from '@monaco-editor/react'
import { readFileContent, saveFileContent } from '../api/files'
import './TextEditor.css'

interface TextEditorProps {
  filePath: string
  fileName: string
  onClose: () => void
  onSaved?: () => void
}

// Get language from file extension
function getLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() || ''
  const languageMap: Record<string, string> = {
    'js': 'javascript',
    'jsx': 'javascript',
    'ts': 'typescript',
    'tsx': 'typescript',
    'json': 'json',
    'html': 'html',
    'htm': 'html',
    'css': 'css',
    'scss': 'scss',
    'less': 'less',
    'md': 'markdown',
    'markdown': 'markdown',
    'py': 'python',
    'go': 'go',
    'rs': 'rust',
    'java': 'java',
    'c': 'c',
    'cpp': 'cpp',
    'h': 'c',
    'hpp': 'cpp',
    'cs': 'csharp',
    'php': 'php',
    'rb': 'ruby',
    'sh': 'shell',
    'bash': 'shell',
    'zsh': 'shell',
    'yaml': 'yaml',
    'yml': 'yaml',
    'xml': 'xml',
    'sql': 'sql',
    'dockerfile': 'dockerfile',
    'makefile': 'makefile',
    'txt': 'plaintext',
    'log': 'plaintext',
    'ini': 'ini',
    'toml': 'toml',
    'conf': 'ini',
    'cfg': 'ini',
    'env': 'plaintext',
  }
  return languageMap[ext] || 'plaintext'
}

function TextEditor({ filePath, fileName, onClose, onSaved }: TextEditorProps) {
  const [content, setContent] = useState<string>('')
  const [originalContent, setOriginalContent] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [theme, setTheme] = useState<'vs-dark' | 'light'>('vs-dark')
  const editorRef = useRef<any>(null)

  useEffect(() => {
    loadContent()
  }, [filePath])

  const loadContent = async () => {
    setLoading(true)
    setError(null)
    try {
      const text = await readFileContent(filePath)
      setContent(text)
      setOriginalContent(text)
      setIsDirty(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file')
    } finally {
      setLoading(false)
    }
  }

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.focus()
  }

  const handleContentChange = useCallback((value: string | undefined) => {
    const newValue = value || ''
    setContent(newValue)
    setIsDirty(newValue !== originalContent)
  }, [originalContent])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      await saveFileContent(filePath, content)
      setOriginalContent(content)
      setIsDirty(false)
      onSaved?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ctrl/Cmd + S to save
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault()
      if (isDirty && !saving) {
        handleSave()
      }
    }
    // Escape to close (with confirmation if dirty)
    if (e.key === 'Escape') {
      handleClose()
    }
  }, [isDirty, saving, content])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  const handleClose = () => {
    if (isDirty) {
      if (confirm('저장하지 않은 변경 사항이 있습니다. 정말 닫으시겠습니까?')) {
        onClose()
      }
    } else {
      onClose()
    }
  }

  const toggleTheme = () => {
    setTheme(t => t === 'vs-dark' ? 'light' : 'vs-dark')
  }

  return (
    <div className="text-editor-overlay">
      <div className="text-editor-container">
        <div className="text-editor-header">
          <div className="text-editor-title">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <path d="M14 2H6C4.9 2 4 2.9 4 4V20C4 21.1 4.9 22 6 22H18C19.1 22 20 21.1 20 20V8L14 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M14 2V8H20" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="file-name">{fileName}</span>
            {isDirty && <span className="dirty-indicator">*</span>}
          </div>
          <div className="text-editor-actions">
            <button
              className="editor-btn theme-btn"
              onClick={toggleTheme}
              title={theme === 'vs-dark' ? '라이트 모드' : '다크 모드'}
            >
              {theme === 'vs-dark' ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="5" stroke="currentColor" strokeWidth="2"/>
                  <path d="M12 1V3M12 21V23M4.22 4.22L5.64 5.64M18.36 18.36L19.78 19.78M1 12H3M21 12H23M4.22 19.78L5.64 18.36M18.36 5.64L19.78 4.22" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
            <button
              className="editor-btn save-btn"
              onClick={handleSave}
              disabled={!isDirty || saving}
              title="저장 (Ctrl+S)"
            >
              {saving ? (
                <span className="saving-spinner" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M19 21H5C3.9 21 3 20.1 3 19V5C3 3.9 3.9 3 5 3H16L21 8V19C21 20.1 20.1 21 19 21Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 21V13H7V21" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M7 3V8H15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
              저장
            </button>
            <button
              className="editor-btn close-btn"
              onClick={handleClose}
              title="닫기 (Esc)"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>

        <div className="text-editor-content">
          {loading ? (
            <div className="editor-loading">
              <div className="spinner" />
              <p>파일 로딩 중...</p>
            </div>
          ) : error ? (
            <div className="editor-error">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2"/>
                <path d="M12 8V12M12 16H12.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
              <p>{error}</p>
              <button onClick={loadContent}>다시 시도</button>
            </div>
          ) : (
            <Editor
              height="100%"
              language={getLanguage(fileName)}
              value={content}
              theme={theme}
              onChange={handleContentChange}
              onMount={handleEditorMount}
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                lineNumbers: 'on',
                wordWrap: 'on',
                automaticLayout: true,
                scrollBeyondLastLine: false,
                tabSize: 2,
                formatOnPaste: true,
                formatOnType: true,
              }}
            />
          )}
        </div>

        <div className="text-editor-footer">
          <div className="footer-left">
            <span className="language-badge">{getLanguage(fileName).toUpperCase()}</span>
          </div>
          <div className="footer-right">
            <span className="shortcut-hint">Ctrl+S 저장 | Esc 닫기</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default TextEditor
