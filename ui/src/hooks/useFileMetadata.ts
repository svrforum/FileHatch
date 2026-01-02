import { useState, useCallback, useEffect } from 'react'
import { getFileMetadata, updateFileMetadata, getUserTags, FileMetadata, FileInfo } from '../api/files'

interface UseFileMetadataOptions {
  selectedFile: FileInfo | null
  onSuccess?: (message: string) => void
  onError?: (message: string) => void
}

interface UseFileMetadataReturn {
  metadata: FileMetadata | null
  isLoading: boolean
  // Description editing
  editingDescription: boolean
  descriptionInput: string
  setEditingDescription: (editing: boolean) => void
  setDescriptionInput: (value: string) => void
  saveDescription: () => Promise<void>
  // Tag management
  tagInput: string
  setTagInput: (value: string) => void
  tagSuggestions: string[]
  allUserTags: string[]
  addTag: (tag: string) => Promise<void>
  removeTag: (tag: string) => Promise<void>
}

/**
 * Hook for managing file metadata (description and tags)
 */
export function useFileMetadata({
  selectedFile,
  onSuccess,
  onError,
}: UseFileMetadataOptions): UseFileMetadataReturn {
  const [metadata, setMetadata] = useState<FileMetadata | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [descriptionInput, setDescriptionInput] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [allUserTags, setAllUserTags] = useState<string[]>([])
  const [tagSuggestions, setTagSuggestions] = useState<string[]>([])

  // Load metadata when file is selected
  useEffect(() => {
    if (!selectedFile) {
      setMetadata(null)
      setEditingDescription(false)
      return
    }

    setIsLoading(true)
    getFileMetadata(selectedFile.path)
      .then(meta => {
        setMetadata(meta)
        setDescriptionInput(meta.description || '')
      })
      .catch(() => setMetadata(null))
      .finally(() => setIsLoading(false))
  }, [selectedFile])

  // Load all user tags for autocomplete
  useEffect(() => {
    getUserTags()
      .then(({ tags }) => setAllUserTags(tags))
      .catch(() => setAllUserTags([]))
  }, [])

  // Filter tag suggestions based on input
  useEffect(() => {
    if (!tagInput.trim()) {
      setTagSuggestions([])
      return
    }
    const query = tagInput.toLowerCase()
    const currentTags = metadata?.tags || []
    const suggestions = allUserTags
      .filter(tag => tag.toLowerCase().includes(query) && !currentTags.includes(tag))
      .slice(0, 5)
    setTagSuggestions(suggestions)
  }, [tagInput, allUserTags, metadata?.tags])

  const saveDescription = useCallback(async () => {
    if (!selectedFile) return
    try {
      const updated = await updateFileMetadata(selectedFile.path, {
        description: descriptionInput,
        tags: metadata?.tags || []
      })
      setMetadata(updated)
      setEditingDescription(false)
      onSuccess?.('설명이 저장되었습니다.')
    } catch {
      onError?.('설명 저장에 실패했습니다.')
    }
  }, [selectedFile, descriptionInput, metadata?.tags, onSuccess, onError])

  const addTag = useCallback(async (tag: string) => {
    if (!selectedFile || !tag.trim()) return
    const newTag = tag.trim().toLowerCase()
    const currentTags = metadata?.tags || []
    if (currentTags.includes(newTag)) {
      setTagInput('')
      return
    }
    try {
      const updated = await updateFileMetadata(selectedFile.path, {
        description: metadata?.description || '',
        tags: [...currentTags, newTag]
      })
      setMetadata(updated)
      setTagInput('')
      if (!allUserTags.includes(newTag)) {
        setAllUserTags(prev => [...prev, newTag].sort())
      }
    } catch {
      onError?.('태그 추가에 실패했습니다.')
    }
  }, [selectedFile, metadata, allUserTags, onError])

  const removeTag = useCallback(async (tagToRemove: string) => {
    if (!selectedFile || !metadata) return
    const newTags = metadata.tags.filter(t => t !== tagToRemove)
    try {
      const updated = await updateFileMetadata(selectedFile.path, {
        description: metadata.description,
        tags: newTags
      })
      setMetadata(updated)
    } catch {
      onError?.('태그 삭제에 실패했습니다.')
    }
  }, [selectedFile, metadata, onError])

  return {
    metadata,
    isLoading,
    editingDescription,
    descriptionInput,
    setEditingDescription,
    setDescriptionInput,
    saveDescription,
    tagInput,
    setTagInput,
    tagSuggestions,
    allUserTags,
    addTag,
    removeTag,
  }
}

export default useFileMetadata
